const http = require('http');
const promClient = require('prom-client');
const { Server } = require('socket.io');
const { requireAdminAuth } = require('./auth');
const { URL } = require('url');
const { createLogger } = require('./logger');

const SAMPLE_BUFFER_MAX = 1000;

/**
 * Circular buffer that retains the last `maxSamples` (default 1000) numeric samples
 * along with per-sample wall-clock timestamps.
 *
 * Fields:
 *   samples    {Float64Array}  — circular buffer of sample values
 *   timestamps {Float64Array}  — wall-clock ms for each sample (same index as samples)
 *   head       {number}        — next write index (wraps around at maxSamples)
 *   count      {number}        — number of valid entries (capped at maxSamples)
 */
class SampleBuffer {
  /**
   * @param {number} [maxSamples=1000]
   */
  constructor(maxSamples = SAMPLE_BUFFER_MAX) {
    this.maxSamples = maxSamples;
    this.samples = new Float64Array(maxSamples);
    this.timestamps = new Float64Array(maxSamples);
    this.head = 0;
    this.count = 0;
  }

  /**
   * Push a new sample into the buffer.  When the buffer is full the oldest
   * entry is overwritten (circular / ring-buffer semantics).
   *
   * @param {number} value       — the sample value
   * @param {number} timestampMs — wall-clock time in milliseconds
   */
  push(value, timestampMs) {
    this.samples[this.head] = value;
    this.timestamps[this.head] = timestampMs;
    this.head = (this.head + 1) % this.maxSamples;
    if (this.count < this.maxSamples) {
      this.count += 1;
    }
  }

  /**
   * Return all sample values whose timestamp falls within the rolling window
   * `[nowMs - windowMs, nowMs]`.
   *
   * @param {number} windowMs — window width in milliseconds
   * @param {number} nowMs    — current wall-clock time in milliseconds
   * @returns {number[]}      — array of values within the window (may be empty)
   */
  getWindowSamples(windowMs, nowMs) {
    const cutoff = nowMs - windowMs;
    const result = [];
    for (let i = 0; i < this.count; i++) {
      // Walk backwards from the most-recently-written slot so that we visit
      // entries in reverse-insertion order, but the returned array preserves
      // insertion order (oldest first).
      const idx = (this.head - 1 - i + this.maxSamples) % this.maxSamples;
      if (this.timestamps[idx] >= cutoff && this.timestamps[idx] <= nowMs) {
        result.unshift(this.samples[idx]);
      }
    }
    return result;
  }
}

const MEASUREMENT_WINDOW_MS = 300000; // 5 minutes
const indicatorLogger = createLogger('indicator-registry');

/**
 * Registry that stores rolling-window SLI samples and computes derived values
 * (percentiles, success rates, poll freshness) for the keeper's SLO observability.
 *
 * All `recordXxx()` methods clamp negative inputs to 0 and emit a debug log.
 * All percentile/rate methods return safe defaults when no data is available.
 */
class IndicatorRegistry {
  constructor() {
    // Poll tracking
    this.lastSuccessfulPollMs = null;
    this.totalPolls = 0;
    this.successfulPolls = 0;
    this.windowPolls = new SampleBuffer(); // 1 = success, 0 = failure

    // Execution lateness — separate buffers per outcome
    this.executionLatenessSuccess = new SampleBuffer();
    this.executionLatenessFailure = new SampleBuffer();

    // Retry delay
    this.retryDelayBuffer = new SampleBuffer();
  }

  /**
   * Record the result of a poll attempt.
   *
   * @param {boolean} success       — true if the poll completed successfully
   * @param {number}  [timestampMs] — wall-clock time in ms (defaults to Date.now())
   */
  recordPollResult(success, timestampMs) {
    const ts = (timestampMs !== undefined && timestampMs !== null) ? timestampMs : Date.now();
    this.totalPolls += 1;
    if (success) {
      this.successfulPolls += 1;
      this.lastSuccessfulPollMs = ts;
    }
    this.windowPolls.push(success ? 1 : 0, ts);
  }

  /**
   * Compute Poll_Freshness as seconds since the last successful poll.
   *
   * @param {number} [nowMs] — current wall-clock time in ms (defaults to Date.now())
   * @returns {number|null}  — null before first success; otherwise elapsed seconds (≥ 0)
   */
  getPollFreshness(nowMs) {
    if (this.lastSuccessfulPollMs === null) {
      return null;
    }
    const now = (nowMs !== undefined && nowMs !== null) ? nowMs : Date.now();
    const freshness = (now - this.lastSuccessfulPollMs) / 1000;
    if (freshness < 0) {
      indicatorLogger.debug('getPollFreshness: negative freshness clamped to 0', { freshness });
      return 0;
    }
    return freshness;
  }

  /**
   * Record the lateness of a single execution submission.
   *
   * @param {number} latenessSeconds — elapsed seconds between due time and submission
   * @param {'success'|'failure'} outcome
   */
  recordExecutionLateness(latenessSeconds, outcome) {
    let value = latenessSeconds;
    if (!Number.isFinite(value)) {
      indicatorLogger.debug('recordExecutionLateness: non-finite value rejected', { latenessSeconds });
      return;
    }
    if (value < 0) {
      indicatorLogger.debug('recordExecutionLateness: negative value clamped to 0', { latenessSeconds });
      value = 0;
    }
    const ts = Date.now();
    if (outcome === 'failure') {
      this.executionLatenessFailure.push(value, ts);
    } else {
      // Default to 'success' bucket for any other outcome string
      this.executionLatenessSuccess.push(value, ts);
    }
  }

  /**
   * Compute p50, p95, p99 percentiles over execution lateness samples within
   * the 5-minute measurement window (both success and failure combined).
   *
   * @returns {{ p50: number, p95: number, p99: number }}
   */
  getExecutionLatenessPercentiles() {
    const now = Date.now();
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const combined = successSamples.concat(failureSamples).sort((a, b) => a - b);
    return {
      p50: _percentile(combined, 50),
      p95: _percentile(combined, 95),
      p99: _percentile(combined, 99),
    };
  }

  /**
   * Return the raw sample array for execution lateness.
   *
   * @param {'success'|'failure'} [outcome] — if omitted, returns all samples combined
   * @returns {number[]}
   */
  getExecutionLatenessSamples(outcome) {
    const now = Date.now();
    if (outcome === 'success') {
      return this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    }
    if (outcome === 'failure') {
      return this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    }
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    return successSamples.concat(failureSamples);
  }

  /**
   * Record the delay between failure detection and retry start for a task.
   *
   * @param {string|number} taskId
   * @param {number} delaySeconds — elapsed seconds (must be finite ≥ 0)
   */
  recordRetryDelay(taskId, delaySeconds) {
    let value = delaySeconds;
    if (!Number.isFinite(value)) {
      indicatorLogger.debug('recordRetryDelay: non-finite value rejected', { taskId, delaySeconds });
      return;
    }
    if (value < 0) {
      indicatorLogger.debug('recordRetryDelay: negative value clamped to 0', { taskId, delaySeconds });
      value = 0;
    }
    this.retryDelayBuffer.push(value, Date.now());
  }

  /**
   * Compute p50 and p95 percentiles over retry delay samples within the window.
   *
   * @returns {{ p50: number, p95: number }}
   */
  getRetryDelayPercentiles() {
    const now = Date.now();
    const samples = this.retryDelayBuffer.getWindowSamples(MEASUREMENT_WINDOW_MS, now).sort((a, b) => a - b);
    return {
      p50: _percentile(samples, 50),
      p95: _percentile(samples, 95),
    };
  }

  /**
   * Compute the execution success rate within the measurement window.
   * Returns 1.0 when no data is available (no data = not failing).
   *
   * @returns {number} — ratio in [0.0, 1.0]
   */
  getExecutionSuccessRate() {
    const now = Date.now();
    const successSamples = this.executionLatenessSuccess.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const failureSamples = this.executionLatenessFailure.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    const total = successSamples.length + failureSamples.length;
    if (total === 0) {
      return 1.0;
    }
    return successSamples.length / total;
  }

  /**
   * Compute the poll success rate within the measurement window.
   * Returns 1.0 when no data is available.
   *
   * @returns {number} — ratio in [0.0, 1.0]
   */
  getPollSuccessRate() {
    const now = Date.now();
    const windowSamples = this.windowPolls.getWindowSamples(MEASUREMENT_WINDOW_MS, now);
    if (windowSamples.length === 0) {
      return 1.0;
    }
    const successes = windowSamples.filter((v) => v === 1).length;
    return successes / windowSamples.length;
  }
}

/**
 * Compute the Nth percentile of a pre-sorted array of numbers.
 * Returns 0 for empty arrays.
 *
 * @param {number[]} sorted — array sorted ascending
 * @param {number}   p      — percentile (0–100)
 * @returns {number}
 */
function _percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  // Nearest-rank method
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

class Metrics {
  constructor() {
    this.startTime = Date.now();
    this.maxFeeSamples = 100;
    this.lastPollAt = null;
    this.rpcConnected = false;
    this.adminState = { paused: false, reason: null, changedAt: null };
    this.shardState = {
      shardIndex: 0,
      shardCount: 1,
      shardLabel: 'shard-0',
      ownedTasks: 0,
      skippedTasks: 0,
    };
    this.driftState = {
      warning: 0,
      critical: 0,
      maxDriftSeconds: 0,
      taskId: null,
      severity: 'none',
      observedAt: null,
    };
    this.reset();
  }

  reset() {
    this.counters = {
      tasksCheckedTotal: 0,
      tasksDueTotal: 0,
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      tasksSkippedIdempotencyTotal: 0,
      throttledRequestsTotal: 0,
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
      adminStateChangesTotal: 0,
      webhookAcceptedTotal: 0,
      webhookRejectedTotal: 0,
      webhookReplayRejectedTotal: 0,
    };
    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      lastRetryCycleDurationMs: 0,
      rpcCircuitState: 0,
    };
    this.feeSamples = [];
  }

  increment(key, amount = 1) {
    if (!(key in this.counters)) {
      return;
    }
    if (typeof amount === 'number') {
      this.counters[key] += amount;
      return;
    }
    this.counters[key] += amount && typeof amount.value === 'number' ? amount.value : 1;
  }

  record(key, value) {
    if (key === 'avgFeePaidXlm') {
      this.feeSamples.push(value);
      if (this.feeSamples.length > this.maxFeeSamples) {
        this.feeSamples.shift();
      }
      this.gauges.avgFeePaidXlm =
        this.feeSamples.reduce((sum, sample) => sum + sample, 0) / this.feeSamples.length;
      return;
    }
    if (key in this.gauges) {
      this.gauges[key] = value;
    }
  }

  updateHealth(state = {}) {
    if (state.lastPollAt) {
      this.lastPollAt = state.lastPollAt instanceof Date
        ? state.lastPollAt
        : new Date(state.lastPollAt);
    }
    if (typeof state.rpcConnected === 'boolean') {
      this.rpcConnected = state.rpcConnected;
    }
  }

  updateAdminState(state = {}) {
    this.adminState = {
      paused: Boolean(state.paused),
      reason: state.reason || null,
      changedAt: state.changedAt || new Date().toISOString(),
    };
  }

  updateShardState(state = {}) {
    this.shardState = { ...this.shardState, ...state };
  }

  updateDriftState(state = {}) {
    this.driftState = { ...this.driftState, ...state };
  }

  snapshot() {
    return {
      ...this.counters,
      ...this.gauges,
      admin: { ...this.adminState },
      shard: { ...this.shardState },
      drift: { ...this.driftState },
    };
  }

  getHealthStatus(staleThreshold) {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    const isStale = this.lastPollAt && now - this.lastPollAt.getTime() > staleThreshold;

    return {
      status: isStale ? 'stale' : 'ok',
      uptime: uptimeSeconds,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      rpcConnected: this.rpcConnected,
      rpcCircuitState: this.gauges.rpcCircuitState === 2
        ? 'OPEN'
        : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED'),
      paused: this.adminState.paused,
      pauseReason: this.adminState.reason,
      shard: { ...this.shardState },
    };
  }
}

function createDefaultGasMonitor() {
  return {
    getLowGasCount: () => 0,
    getConfig: () => ({
      gasWarnThreshold: 0,
      alertDebounceMs: 0,
      alertWebhookEnabled: false,
      forecastingEnabled: false,
      forecastSafetyBuffer: 0,
      forecastAggregationWindow: 0,
    }),
    getForecasterState: () => ({
      trackedTasks: 0,
      totalHistoricalSamples: 0,
    }),
  };
}

class MetricsServer {
  constructor(gasMonitor, logger, deadLetterQueue, options = {}) {
    this.gasMonitor = gasMonitor || createDefaultGasMonitor();
    this.logger = logger || createLogger('metrics');
    this.deadLetterQueue = deadLetterQueue || null;
    this.port = options.port || parseInt(process.env.METRICS_PORT, 10) || 3000;
    this.healthStaleThreshold = options.healthStaleThreshold
      || parseInt(process.env.HEALTH_STALE_THRESHOLD_MS || '60000', 10);
    this.server = null;
    this.registry = null;
    this.metrics = new Metrics();
    this.config = options.config || null;
    this.controlStateProvider = options.controlStateProvider || null;
    this.controlActionHandler = options.controlActionHandler || null;
    this.historyManager = options.historyManager || null;
    this.webhookHandler = options.webhookHandler || null;
    this.webhookPath = options.webhookPath || '/webhooks/task-executions';
    this.register = new promClient.Registry();

    // Instantiate IndicatorRegistry for SLO observability.
    // When metrics are disabled (no port configured), recordXxx() calls become no-ops
    // by wrapping the registry in a proxy that silently discards writes.
    const metricsEnabled = Boolean(
      options.port || parseInt(process.env.METRICS_PORT, 10),
    );
    if (metricsEnabled) {
      this.indicatorRegistry = new IndicatorRegistry();
    } else {
      // No-op proxy: all method calls are silently discarded
      this.indicatorRegistry = new Proxy(new IndicatorRegistry(), {
        get(target, prop) {
          const value = target[prop];
          if (typeof value === 'function' && prop.startsWith('record')) {
            return () => {};
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }

    this.initPrometheusMetrics();
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setControlStateProvider(provider) {
    this.controlStateProvider = provider;
  }

  setControlActionHandler(handler) {
    this.controlActionHandler = handler;
  }

  setWebhookHandler(handler, path = this.webhookPath) {
    this.webhookHandler = handler;
    this.webhookPath = path;
  }

  initPrometheusMetrics() {
    this.promTasksChecked = new promClient.Counter({
      name: 'keeper_tasks_checked_total',
      help: 'Total number of tasks checked for execution eligibility',
      registers: [this.register],
    });
    this.promTasksDue = new promClient.Counter({
      name: 'keeper_tasks_due_total',
      help: 'Total number of tasks that were due for execution',
      registers: [this.register],
    });
    this.promTasksExecuted = new promClient.Counter({
      name: 'keeper_tasks_executed_total',
      help: 'Total number of tasks executed successfully',
      registers: [this.register],
    });
    this.promTasksFailed = new promClient.Counter({
      name: 'keeper_tasks_failed_total',
      help: 'Total number of tasks that failed during execution',
      registers: [this.register],
    });

    // Counter: Total requests throttled by rate limiter
    this.promThrottledRequests = new promClient.Counter({
      name: 'keeper_throttled_requests_total',
      help: 'Total number of requests throttled by the rate limiter',
      labelNames: ['limiter_name'],
      registers: [this.register],
    });
    this.promAdminStateChanges = new promClient.Counter({
      name: 'keeper_admin_state_changes_total',
      help: 'Total number of keeper admin state changes',
      registers: [this.register],
    });
    this.promWebhookAccepted = new promClient.Counter({
      name: 'keeper_webhook_accepted_total',
      help: 'Total inbound webhook task execution requests accepted',
      registers: [this.register],
    });
    this.promWebhookRejected = new promClient.Counter({
      name: 'keeper_webhook_rejected_total',
      help: 'Total inbound webhook task execution requests rejected',
      labelNames: ['reason'],
      registers: [this.register],
    });
    this.promWebhookReplayRejected = new promClient.Counter({
      name: 'keeper_webhook_replay_rejected_total',
      help: 'Total inbound webhook requests rejected by replay protection',
      registers: [this.register],
    });
    this.promAvgFee = new promClient.Gauge({
      name: 'keeper_avg_fee_paid_xlm',
      help: 'Average transaction fee paid in XLM (rolling average)',
      registers: [this.register],
    });
    this.promCycleDuration = new promClient.Gauge({
      name: 'keeper_last_cycle_duration_ms',
      help: 'Duration of the last polling cycle in milliseconds',
      registers: [this.register],
    });
    this.promRetryCycleDuration = new promClient.Gauge({
      name: 'keeper_last_retry_cycle_duration_ms',
      help: 'Duration of the last retry cycle in milliseconds',
      registers: [this.register],
    });
    this.promLowGasCount = new promClient.Gauge({
      name: 'keeper_low_gas_count',
      help: 'Number of tasks with low gas balance',
      registers: [this.register],
    });
    this.promUptime = new promClient.Gauge({
      name: 'keeper_uptime_seconds',
      help: 'Keeper service uptime in seconds',
      registers: [this.register],
    });
    this.promRpcConnected = new promClient.Gauge({
      name: 'keeper_rpc_connected',
      help: 'RPC connection status (1 = connected, 0 = disconnected)',
      registers: [this.register],
    });
    this.promRpcCircuitState = new promClient.Gauge({
      name: 'keeper_rpc_circuit_state',
      help: 'RPC circuit breaker state (0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN)',
      registers: [this.register],
    });
    this.promAdminPaused = new promClient.Gauge({
      name: 'keeper_admin_paused',
      help: 'Whether the keeper is administratively paused (1 = paused, 0 = active)',
      registers: [this.register],
    });
    this.promShardOwnedTasks = new promClient.Gauge({
      name: 'keeper_shard_owned_tasks',
      help: 'Number of tasks currently owned by this shard',
      labelNames: ['shard_label', 'shard_index'],
      registers: [this.register],
    });
    this.promShardSkippedTasks = new promClient.Gauge({
      name: 'keeper_shard_skipped_tasks',
      help: 'Number of tasks skipped because they are assigned to another shard',
      labelNames: ['shard_label', 'shard_index'],
      registers: [this.register],
    });
    this.promDriftSeverity = new promClient.Gauge({
      name: 'keeper_recurring_drift_severity',
      help: 'Highest currently observed recurring drift severity (0 = none, 1 = warning, 2 = critical)',
      registers: [this.register],
    });
    this.promDriftTask = new promClient.Gauge({
      name: 'keeper_recurring_drift_task_id',
      help: 'Task id associated with the highest currently observed recurring drift',
      registers: [this.register],
    });
    this.promDriftWarningCount = new promClient.Gauge({
      name: 'keeper_recurring_drift_warning_tasks',
      help: 'Number of tasks currently showing warning-level recurring drift',
      registers: [this.register],
    });
    this.promDriftCriticalCount = new promClient.Gauge({
      name: 'keeper_recurring_drift_critical_tasks',
      help: 'Number of tasks currently showing critical recurring drift',
      registers: [this.register],
    });

    this.promBudgetConsumed = new promClient.Counter({
      name: 'keeper_retry_budget_consumed_total',
      help: 'Total number of retries consumed from budget',
      labelNames: ['scope'],
      registers: [this.register],
    });
    this.promBudgetExhausted = new promClient.Counter({
      name: 'keeper_retry_budget_exhausted_total',
      help: 'Total number of retry budget exhaustion events',
      labelNames: ['scope', 'reason'],
      registers: [this.register],
    });
    this.promBudgetGlobalAvailable = new promClient.Gauge({
      name: 'keeper_retry_budget_global_available',
      help: 'Global retry budget availability (0.0-1.0)',
      registers: [this.register],
    });
    this.promBudgetGlobalUsed = new promClient.Gauge({
      name: 'keeper_retry_budget_global_used',
      help: 'Global retry budget consumed',
      registers: [this.register],
    });
    this.promBudgetCooldown = new promClient.Gauge({
      name: 'keeper_retry_budget_in_cooldown',
      help: 'Whether retry budget is in cooldown (0=active, 1=cooldown)',
      registers: [this.register],
    });
    this.promBudgetCooldownRemaining = new promClient.Gauge({
      name: 'keeper_retry_budget_cooldown_remaining_ms',
      help: 'Remaining cooldown time in milliseconds',
      registers: [this.register],
    });
    this.promBudgetPressureLevel = new promClient.Gauge({
      name: 'keeper_retry_budget_pressure_level',
      help: 'Retry budget pressure level (0=low, 1=medium, 2=high, 3=critical)',
      registers: [this.register],
    });
    this.promBudgetTaskCount = new promClient.Gauge({
      name: 'keeper_retry_budget_task_count',
      help: 'Number of tasks with tracked retry budgets',
      registers: [this.register],
    });

    // SLO / SLI metrics
    this.promPollFreshness = new promClient.Gauge({
      name: 'keeper_poll_freshness_seconds',
      help: 'Seconds since last successful poll. -1 if no poll has completed yet.',
      registers: [this.register],
    });

    this.promExecutionLatenessHistogram = new promClient.Histogram({
      name: 'keeper_execution_lateness_seconds',
      help: 'Seconds between task due time and execution submission.',
      buckets: [0, 1, 5, 10, 30, 60, 120, 300],
      registers: [this.register],
    });

    this.promExecutionLatenessP50 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p50_seconds',
      help: 'p50 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionLatenessP95 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p95_seconds',
      help: 'p95 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionLatenessP99 = new promClient.Gauge({
      name: 'keeper_execution_lateness_p99_seconds',
      help: 'p99 percentile of execution lateness in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promRetryDelayP50 = new promClient.Gauge({
      name: 'keeper_retry_delay_p50_seconds',
      help: 'p50 percentile of retry delay in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promRetryDelayP95 = new promClient.Gauge({
      name: 'keeper_retry_delay_p95_seconds',
      help: 'p95 percentile of retry delay in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promExecutionSuccessRate = new promClient.Gauge({
      name: 'keeper_execution_success_rate',
      help: 'Ratio of successful executions in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promPollSuccessRate = new promClient.Gauge({
      name: 'keeper_poll_success_rate',
      help: 'Ratio of successful polls in the 5-minute measurement window.',
      registers: [this.register],
    });

    this.promSLOBreach = new promClient.Gauge({
      name: 'keeper_slo_breach',
      help: '1 if the current SLI value exceeds the configured threshold, 0 otherwise.',
      labelNames: ['sli'],
      registers: [this.register],
    });

    this.promSLOThreshold = new promClient.Gauge({
      name: 'keeper_slo_threshold',
      help: 'Configured SLO threshold value per SLI.',
      labelNames: ['sli'],
      registers: [this.register],
    });

    this.promBuildInfo = new promClient.Gauge({
      name: 'keeper_build_info',
      help: 'Keeper build information.',
      labelNames: ['version', 'node_env'],
      registers: [this.register],
    });
    // Set build info once at startup (static labels)
    this.promBuildInfo.set(
      {
        version: process.env.npm_package_version || 'unknown',
        node_env: process.env.NODE_ENV || 'production',
      },
      1,
    );

    promClient.collectDefaultMetrics({ register: this.register });
  }

  setRetryBudgetTracker(budgetTracker) {
    this.retryBudgetTracker = budgetTracker;
  }

  syncPrometheusMetrics() {
    this.promTasksChecked.inc(0);
    this.promTasksDue.inc(0);
    this.promTasksExecuted.inc(0);
    this.promTasksFailed.inc(0);
    this.promThrottledRequests.inc({ limiter_name: 'poller-reads' }, 0);
    this.promThrottledRequests.inc({ limiter_name: 'execution-writes' }, 0);
    this.promAdminStateChanges.inc(0);
    this.promWebhookAccepted.inc(0);
    this.promWebhookRejected.inc({ reason: 'none' }, 0);
    this.promWebhookReplayRejected.inc(0);

    this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    this.promCycleDuration.set(this.metrics.gauges.lastCycleDurationMs);
    this.promRetryCycleDuration.set(this.metrics.gauges.lastRetryCycleDurationMs);
    this.promLowGasCount.set(this.gasMonitor.getLowGasCount());
    this.promUptime.set(Math.floor((Date.now() - this.metrics.startTime) / 1000));
    this.promRpcConnected.set(this.metrics.rpcConnected ? 1 : 0);
    this.promRpcCircuitState.set(this.metrics.gauges.rpcCircuitState);
    this.promAdminPaused.set(this.metrics.adminState.paused ? 1 : 0);
    this.promShardOwnedTasks.set(
      {
        shard_label: String(this.metrics.shardState.shardLabel),
        shard_index: String(this.metrics.shardState.shardIndex),
      },
      this.metrics.shardState.ownedTasks,
    );
    this.promShardSkippedTasks.set(
      {
        shard_label: String(this.metrics.shardState.shardLabel),
        shard_index: String(this.metrics.shardState.shardIndex),
      },
      this.metrics.shardState.skippedTasks,
    );
    this.promDriftSeverity.set(
      this.metrics.driftState.severity === 'critical'
        ? 2
        : (this.metrics.driftState.severity === 'warning' ? 1 : 0),
    );
    this.promDriftTask.set(this.metrics.driftState.taskId || 0);
    this.promDriftWarningCount.set(this.metrics.driftState.warning || 0);
    this.promDriftCriticalCount.set(this.metrics.driftState.critical || 0);

    if (this.retryBudgetTracker) {
      const budgetStats = this.retryBudgetTracker.getStats();
      this.promBudgetGlobalAvailable.set(budgetStats.global.available);
      this.promBudgetGlobalUsed.set(budgetStats.global.used);
      this.promBudgetCooldown.set(budgetStats.cooldownActive ? 1 : 0);
      this.promBudgetCooldownRemaining.set(budgetStats.cooldownRemainingMs);
      this.promBudgetTaskCount.set(budgetStats.taskCount);

      const pressureMap = { low: 0, medium: 1, high: 2, critical: 3 };
      this.promBudgetPressureLevel.set(pressureMap[budgetStats.pressure] || 0);
    }

    // SLO / SLI metrics from IndicatorRegistry
    const pollFreshness = this.indicatorRegistry.getPollFreshness();
    this.promPollFreshness.set(pollFreshness === null ? -1 : pollFreshness);

    const latenessPercentiles = this.indicatorRegistry.getExecutionLatenessPercentiles();
    this.promExecutionLatenessP50.set(latenessPercentiles.p50);
    this.promExecutionLatenessP95.set(latenessPercentiles.p95);
    this.promExecutionLatenessP99.set(latenessPercentiles.p99);

    const retryDelayPercentiles = this.indicatorRegistry.getRetryDelayPercentiles();
    this.promRetryDelayP50.set(retryDelayPercentiles.p50);
    this.promRetryDelayP95.set(retryDelayPercentiles.p95);

    const executionSuccessRate = this.indicatorRegistry.getExecutionSuccessRate();
    this.promExecutionSuccessRate.set(executionSuccessRate);

    const pollSuccessRate = this.indicatorRegistry.getPollSuccessRate();
    this.promPollSuccessRate.set(pollSuccessRate);

    // SLO breach and threshold gauges
    const thresholds = (this.config && this.config.sloThresholds) ? this.config.sloThresholds : {
      stalePollSeconds: 30,
      executionLatenessSeconds: 60,
      maxRetryDelaySeconds: 120,
      minExecutionSuccessRate: 0.95,
      minPollSuccessRate: 0.99,
    };

    // poll_freshness: breaches when freshness > stalePollSeconds (null = no data, no breach)
    const pollFreshnessBreach = (pollFreshness !== null && pollFreshness > thresholds.stalePollSeconds) ? 1 : 0;
    this.promSLOBreach.set({ sli: 'poll_freshness' }, pollFreshnessBreach);
    this.promSLOThreshold.set({ sli: 'poll_freshness' }, thresholds.stalePollSeconds);

    // execution_lateness: breaches when p95 > executionLatenessSeconds
    const executionLatenessBreach = latenessPercentiles.p95 > thresholds.executionLatenessSeconds ? 1 : 0;
    this.promSLOBreach.set({ sli: 'execution_lateness' }, executionLatenessBreach);
    this.promSLOThreshold.set({ sli: 'execution_lateness' }, thresholds.executionLatenessSeconds);

    // execution_success_rate: breaches when rate < minExecutionSuccessRate
    const executionSuccessRateBreach = executionSuccessRate < thresholds.minExecutionSuccessRate ? 1 : 0;
    this.promSLOBreach.set({ sli: 'execution_success_rate' }, executionSuccessRateBreach);
    this.promSLOThreshold.set({ sli: 'execution_success_rate' }, thresholds.minExecutionSuccessRate);

    // poll_success_rate: breaches when rate < minPollSuccessRate
    const pollSuccessRateBreach = pollSuccessRate < thresholds.minPollSuccessRate ? 1 : 0;
    this.promSLOBreach.set({ sli: 'poll_success_rate' }, pollSuccessRateBreach);
    this.promSLOThreshold.set({ sli: 'poll_success_rate' }, thresholds.minPollSuccessRate);

    // retry_delay: breaches when p95 > maxRetryDelaySeconds
    const retryDelayBreach = retryDelayPercentiles.p95 > thresholds.maxRetryDelaySeconds ? 1 : 0;
    this.promSLOBreach.set({ sli: 'retry_delay' }, retryDelayBreach);
    this.promSLOThreshold.set({ sli: 'retry_delay' }, thresholds.maxRetryDelaySeconds);
  }

  incrementBudgetConsumed(scope = 'global') {
    if (this.promBudgetConsumed) {
      this.promBudgetConsumed.inc({ scope });
    }
  }

  incrementBudgetExhausted(scope = 'global', reason = 'limit') {
    if (this.promBudgetExhausted) {
      this.promBudgetExhausted.inc({ scope, reason });
    }
  }

  start() {
    if (this.server) {
      return;
    }

    this.server = http.createServer(async (req, res) => {
      const protect = (handler) => {
        return () => requireAdminAuth(req, res, handler);
      };

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${this.port}`);
      if (url.pathname === '/health' || url.pathname === '/health/') {
        this.handleHealth(res);

      } else if (req.url === '/metrics' || req.url === '/metrics/') {
        this.handleMetrics(res);

      } else if (req.url === '/metrics/prometheus' || req.url === '/metrics/prometheus/') {
        this.handlePrometheusMetrics(res);

      } else if (req.url === '/metrics/forecast' || req.url === '/metrics/forecast/') {
        this.handleForecast(res);


        // 🔐 PROTECTED ROUTES START HERE

      } else if (req.url === '/admin/reset' && req.method === 'POST') {
        protect(() => {
          this.metrics.reset();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })();

      } else if (req.url === '/admin/dead-letter') {
        protect(() => this.handleDeadLetter(res))();

      } else if (req.url.startsWith('/admin/dead-letter/')) {
        protect(() => this.handleDeadLetterTask(req, res))();

      } else if (url.pathname === this.webhookPath && this.webhookHandler) {
        // Webhook requests (unauthenticated - auth handled by webhook handler)
        this.webhookHandler.handle(req, res);

        // ❌ NOT FOUND

      } else if (url.pathname === '/metrics' || url.pathname === '/metrics/') {
        this.handleMetrics(res);
      } else if (url.pathname === '/metrics/prometheus' || url.pathname === '/metrics/prometheus/') {
        await this.handlePrometheusMetrics(res);
      } else if (url.pathname === '/metrics/forecast' || url.pathname === '/metrics/forecast/') {
        this.handleForecast(res);
      } else if (url.pathname === '/drift' || url.pathname === '/drift/') {
        this.handleDrift(res);
      } else if (url.pathname === '/admin/keeper' || url.pathname === '/admin/keeper/') {
        this.handleAdminState(req, res);
      } else if (url.pathname === '/admin/keeper/pause' || url.pathname === '/admin/keeper/pause/') {
        await this.handlePauseResume(req, res, true);
      } else if (url.pathname === '/admin/keeper/resume' || url.pathname === '/admin/keeper/resume/') {
        await this.handlePauseResume(req, res, false);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Metrics server running on port ${this.port}`);
    });
  }

  handleHealth(res) {
    const status = this.metrics.getHealthStatus(this.healthStaleThreshold);
    const healthData = {
      ...status,
      p2p: this.getP2PState(),
      ...(this.retryBudgetTracker && {
        retryBudget: this.retryBudgetTracker.getStats(),
      }),
    };
    res.writeHead(status.status === 'stale' ? 503 : 200, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(healthData, null, 2));
  }

  handleMetrics(res) {
    const gasConfig = this.gasMonitor.getConfig();
    const forecasterState = this.gasMonitor.getForecasterState();
    const metricsData = {
      ...this.metrics.snapshot(),
      lowGasCount: this.gasMonitor.getLowGasCount(),
      gasWarnThreshold: gasConfig.gasWarnThreshold,
      alertDebounceMs: gasConfig.alertDebounceMs,
      alertWebhookEnabled: gasConfig.alertWebhookEnabled,
      forecasting: {
        enabled: gasConfig.forecastingEnabled,
        safetyBuffer: gasConfig.forecastSafetyBuffer,
        aggregationWindowSeconds: gasConfig.forecastAggregationWindow,
        trackedTasks: forecasterState.trackedTasks,
        totalHistoricalSamples: forecasterState.totalHistoricalSamples,
      },
      p2p: this.getP2PState(),
      ...(this.retryBudgetTracker && {
        retryBudget: this.retryBudgetTracker.getStats(),
      }),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metricsData, null, 2));
  }

  getP2PState() {
    if (typeof this.p2pStateProvider !== 'function') {
      return { enabled: false };
    }
    try {
      return this.p2pStateProvider();
    } catch (error) {
      this.logger.error('Error reading P2P state', { error: error.message });
      return { enabled: true, status: 'error' };
    }
  }

  handleForecast(res) {
    const forecastData = this.gasMonitor.getForecasterState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(forecastData, null, 2));
  }

  handleDrift(res) {
    const payload = {
      summary: this.metrics.driftState,
      tasks: this.historyManager?.getDriftSnapshot
        ? this.historyManager.getDriftSnapshot()
        : [],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload, null, 2));
  }

  async handlePrometheusMetrics(res) {
    try {
      this.syncPrometheusMetrics();
      const metrics = await this.register.metrics();
      res.writeHead(200, { 'Content-Type': this.register.contentType });
      res.end(metrics);
    } catch (error) {
      this.logger.error('Error generating Prometheus metrics', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  isAuthorized(req) {
    const configuredToken = process.env.KEEPER_ADMIN_TOKEN;
    if (!configuredToken) {
      return false;
    }
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    return token === configuredToken;
  }

  handleAdminState(req, res) {
    if (!this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const state = this.controlStateProvider ? this.controlStateProvider() : this.metrics.adminState;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state, null, 2));
  }

  async handlePauseResume(req, res, paused) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }
    if (!this.isAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (typeof this.controlActionHandler !== 'function') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin controls unavailable' }));
      return;
    }

    const body = await this.readJsonBody(req);
    const state = await this.controlActionHandler({
      paused,
      reason: body.reason || null,
      actor: body.actor || 'api',
    });

    this.metrics.updateAdminState(state);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state, null, 2));
  }

  readJsonBody(req) {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        if (!raw) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (_) {
          resolve({});
        }
      });
    });
  }

  updateHealth(state) {
    this.metrics.updateHealth(state);
  }

  increment(key, amount) {
    this.metrics.increment(key, amount);
    if (key === 'tasksCheckedTotal') {
      this.promTasksChecked.inc(amount);
    } else if (key === 'tasksDueTotal') {
      this.promTasksDue.inc(amount);
    } else if (key === 'tasksExecutedTotal') {
      this.promTasksExecuted.inc(amount);
    } else if (key === 'tasksFailedTotal') {
      this.promTasksFailed.inc(amount);
    } else if (key === 'throttledRequestsTotal') {
      this.promThrottledRequests.inc(
        { limiter_name: amount?.name || 'unknown' },
        amount?.value || 1,
      );
    } else if (key === 'adminStateChangesTotal') {
      this.promAdminStateChanges.inc(typeof amount === 'number' ? amount : 1);
    }
  }

  record(key, value) {
    this.metrics.record(key, value);
    if (key === 'avgFeePaidXlm') {
      this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    } else if (key === 'lastCycleDurationMs') {
      this.promCycleDuration.set(value);
    } else if (key === 'lastRetryCycleDurationMs') {
      this.promRetryCycleDuration.set(value);
    } else if (key === 'rpcCircuitState') {
      this.promRpcCircuitState.set(value);
    }
  }

  updateShardState(state) {
    this.metrics.updateShardState(state);
  }

  updateDriftState(state) {
    this.metrics.updateDriftState(state);
  }

  updateAdminState(state) {
    this.metrics.updateAdminState(state);
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.logger.info('Server stopped');
    }
  }
}

module.exports = { Metrics, MetricsServer, SampleBuffer, IndicatorRegistry };
