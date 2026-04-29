const http = require('http');
const promClient = require('prom-client');
const { Server } = require('socket.io');

/**
 * Metrics store for tracking operational statistics.
 * Combines task execution metrics with gas monitoring metrics.
 */
class Metrics {
  constructor() {
    this.counters = {
      tasksCheckedTotal: 0,
      tasksDueTotal: 0,
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      throttledRequestsTotal: 0,
      tasksSkippedIdempotencyTotal: 0,

      // SLO counters
      pollFreshnessSloSuccess: 0,
      pollFreshnessSloFailure: 0,
      executionTimelinessSloSuccess: 0,
      executionTimelinessSloFailure: 0,
      retriesExhausted: 0,
      retryAttemptsTotal: { success: 0, failure: 0, duplicate: 0 },

      // Retry-related counters
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
    };

    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      rpcCircuitState: 0, // 0 = CLOSED, 1 = HALF_OPEN, 2 = OPEN

      // SLO gauges
      pollFreshnessSeconds: 0,
      oldestTaskAgeSeconds: 0,
      retryQueueSize: 0,
      pollFreshnessSloRate: 0,
      executionTimelinessSloRate: 0,
    };

    this.feeSamples = [];
    this.maxFeeSamples = 100;

    this.startTime = Date.now();
    this.lastPollAt = null;
    this.lastPollCompletedAt = null;
    this.rpcConnected = false;

    // SLO thresholds (configurable, defaults set in constructor)
    this.sloThresholds = {
      pollFreshnessMs: 60000, // Poll should complete within 60s
      executionTimelinessMs: 0, // Will be set from config
    };

    // Domain configuration sources
    this.pollIntervalMs = 30000; // Default, overridden via setPollInterval
  }

  increment(key, amount = 1) {
    if (key === 'pollFreshnessSloSuccess') {
      this.counters.pollFreshnessSloSuccess += amount;
    } else if (key === 'pollFreshnessSloFailure') {
      this.counters.pollFreshnessSloFailure += amount;
    } else if (key === 'executionTimelinessSloSuccess') {
      this.counters.executionTimelinessSloSuccess += amount;
    } else if (key === 'executionTimelinessSloFailure') {
      this.counters.executionTimelinessSloFailure += amount;
    } else if (key === 'retriesExhausted') {
      this.counters.retriesExhausted += amount;
    } else if (key === 'retryAttemptsTotal' && typeof amount === 'object') {
      const outcome = amount.outcome || 'unknown';
      if (this.counters.retryAttemptsTotal[outcome] !== undefined) {
        this.counters.retryAttemptsTotal[outcome] += 1;
      }
    } else if (key in this.counters) {
      this.counters[key] += amount;
    }
  }

  record(key, value) {
    if (key === 'avgFeePaidXlm') {
      this.feeSamples.push(value);
      if (this.feeSamples.length > this.maxFeeSamples) {
        this.feeSamples.shift();
      }
      this.gauges.avgFeePaidXlm =
        this.feeSamples.reduce((sum, v) => sum + v, 0) /
        this.feeSamples.length;
    } else if (key === 'rpcCircuitState') {
      this.gauges.rpcCircuitState = value;
    } else if (key === 'pollFreshnessSeconds') {
      this.gauges.pollFreshnessSeconds = value;
    } else if (key === 'oldestTaskAgeSeconds') {
      this.gauges.oldestTaskAgeSeconds = value;
    } else if (key === 'retryQueueSize') {
      this.gauges.retryQueueSize = value;
    } else if (key === 'pollFreshnessSloRate') {
      this.gauges.pollFreshnessSloRate = value;
    } else if (key === 'executionTimelinessSloRate') {
      this.gauges.executionTimelinessSloRate = value;
    } else if (key in this.gauges) {
      this.gauges[key] = value;
    }
  }

  setPollIntervalMs(ms) {
    this.pollIntervalMs = ms;
  }

  setSloThreshold(key, valueMs) {
    if (key === 'pollFreshness') {
      this.sloThresholds.pollFreshnessMs = valueMs;
    } else if (key === 'executionTimeliness') {
      this.sloThresholds.executionTimelinessMs = valueMs;
    }
  }

  getSloThreshold(key) {
    return this.sloThresholds[key] || null;
  }

  updateHealth(state) {
    if (state.lastPollAt) {
      this.lastPollAt = state.lastPollAt;
    }
    if (state.lastPollCompletedAt) {
      this.lastPollCompletedAt = state.lastPollCompletedAt;
    }
    if (typeof state.rpcConnected === 'boolean') {
      this.rpcConnected = state.rpcConnected;
    }
  }

  snapshot() {
    return {
      ...this.counters,
      ...this.gauges,
      sloThresholds: { ...this.sloThresholds },
    };
  }

  getHealthStatus(staleThreshold) {
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    const isStale =
      this.lastPollAt &&
      now - this.lastPollAt.getTime() > staleThreshold;

    // Compute freshness: time since last completed poll
    let freshnessSeconds = 0;
    if (this.lastPollCompletedAt) {
      freshnessSeconds = Math.floor((now - this.lastPollCompletedAt.getTime()) / 1000);
    }

    return {
      status: isStale ? 'stale' : 'ok',
      uptime: uptimeSeconds,
      lastPollAt: this.lastPollAt ? this.lastPollAt.toISOString() : null,
      lastPollCompletedAt: this.lastPollCompletedAt ? this.lastPollCompletedAt.toISOString() : null,
      pollFreshnessSeconds: freshnessSeconds,
      rpcConnected: this.rpcConnected,
      rpcCircuitState: this.gauges.rpcCircuitState === 2 ? 'OPEN' : (this.gauges.rpcCircuitState === 1 ? 'HALF_OPEN' : 'CLOSED'),
      slo: {
        pollFreshnessRate: this.gauges.pollFreshnessSloRate,
        executionTimelinessRate: this.gauges.executionTimelinessSloRate,
        thresholds: { ...this.sloThresholds },
      },
    };
  }

  reset() {
    this.counters = {
      tasksCheckedTotal: 0,
      tasksDueTotal: 0,
      tasksExecutedTotal: 0,
      tasksFailedTotal: 0,
      throttledRequestsTotal: 0,
      tasksSkippedIdempotencyTotal: 0,
      pollFreshnessSloSuccess: 0,
      pollFreshnessSloFailure: 0,
      executionTimelinessSloSuccess: 0,
      executionTimelinessSloFailure: 0,
      retriesExhausted: 0,
      retriesExecutedTotal: 0,
      retriesFailedTotal: 0,
      retryAttemptsTotal: { success: 0, failure: 0, duplicate: 0 },
    };
    this.gauges = {
      avgFeePaidXlm: 0,
      lastCycleDurationMs: 0,
      rpcCircuitState: 0,
      pollFreshnessSeconds: 0,
      oldestTaskAgeSeconds: 0,
      retryQueueSize: 0,
      pollFreshnessSloRate: 0,
      executionTimelinessSloRate: 0,
    };
    this.feeSamples = [];
  }
}

class MetricsServer {
  constructor(gasMonitor, logger, deadLetterQueue) {
    this.gasMonitor = gasMonitor;
    this.logger = logger;
    this.deadLetterQueue = deadLetterQueue;
    this.port = parseInt(process.env.METRICS_PORT, 10) || 3000;
    this.healthStaleThreshold = parseInt(
      process.env.HEALTH_STALE_THRESHOLD_MS || '60000',
      10,
    );
    this.server = null;
    this.io = null;
    this.registry = null;
    this.metrics = new Metrics();

    // Initialize Prometheus registry and metrics
    this.register = new promClient.Registry();
    this.initPrometheusMetrics();
  }

  setRegistry(registry) {
    this.registry = registry;
  }

   initPrometheusMetrics() {
     // Counter: Total tasks checked
     this.promTasksChecked = new promClient.Counter({
       name: 'keeper_tasks_checked_total',
       help: 'Total number of tasks checked for execution eligibility',
       registers: [this.register],
     });

     // Counter: Total tasks due for execution
     this.promTasksDue = new promClient.Counter({
       name: 'keeper_tasks_due_total',
       help: 'Total number of tasks that were due for execution',
       registers: [this.register],
     });

     // Counter: Total tasks executed successfully
     this.promTasksExecuted = new promClient.Counter({
       name: 'keeper_tasks_executed_total',
       help: 'Total number of tasks executed successfully',
       registers: [this.register],
     });

      // Counter: Total tasks failed
      this.promTasksFailed = new promClient.Counter({
        name: 'keeper_tasks_failed_total',
        help: 'Total number of tasks that failed during execution',
        registers: [this.register],
      });

      // Counter: Total tasks skipped due to idempotency lock
      this.promTasksSkippedIdempotency = new promClient.Counter({
        name: 'keeper_tasks_skipped_idempotency_total',
        help: 'Total number of tasks skipped due to idempotency lock',
        registers: [this.register],
      });

      // Counter: Total retry executions (retried tasks that succeeded)
      this.promRetriesExecuted = new promClient.Counter({
        name: 'keeper_retries_executed_total',
        help: 'Total number of retried tasks that succeeded',
        registers: [this.register],
      });

      // Counter: Total retries that failed
      this.promRetriesFailed = new promClient.Counter({
        name: 'keeper_retries_failed_total',
        help: 'Total number of retried tasks that failed',
        registers: [this.register],
      });

      // Histogram: Task execution lateness (ledger count between scheduled due and actual execution)
      this.promTaskLateness = new promClient.Histogram({
        name: 'keeper_task_execution_lateness_ledgers',
        help: 'Difference in ledger numbers between task scheduled due time and actual execution',
        buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
        registers: [this.register],
      });

     // Gauge: Seconds since last successful poll cycle
     this.promPollFreshnessSeconds = new promClient.Gauge({
       name: 'keeper_poll_freshness_seconds',
       help: 'Seconds since the last successful polling cycle completed',
       registers: [this.register],
     });

     // Histogram: Interval between poll cycle completions
     this.promPollInterval = new promClient.Histogram({
       name: 'keeper_poll_interval_seconds',
       help: 'Seconds between consecutive polling cycle completions',
       buckets: [1, 5, 10, 30, 60, 120, 300, 600],
       registers: [this.register],
     });

     // Gauge: Current age of oldest task in the registry (seconds since last_run)
     this.promOldestTaskAgeSeconds = new promClient.Gauge({
       name: 'keeper_oldest_task_age_seconds',
       help: 'Age of the oldest registered task (seconds since last_run)',
       registers: [this.register],
     });

     // Counter: Total requests throttled by rate limiter
     this.promThrottledRequests = new promClient.Counter({
       name: 'keeper_throttled_requests_total',
       help: 'Total number of requests throttled by the rate limiter',
       labelNames: ['limiter_name'],
       registers: [this.register],
     });

     // Counter: Total tasks skipped due to quarantine
     this.promTasksQuarantinedSkipped = new promClient.Counter({
       name: 'keeper_tasks_quarantined_skipped_total',
       help: 'Total number of tasks skipped because they are quarantined',
       registers: [this.register],
     });

     // Gauge: Number of quarantined tasks
     this.promQuarantinedCount = new promClient.Gauge({
       name: 'keeper_quarantined_tasks_count',
       help: 'Current number of tasks in quarantine',
       registers: [this.register],
     });

     // Counter: Total tasks quarantined
     this.promTotalQuarantined = new promClient.Counter({
       name: 'keeper_tasks_quarantined_total',
       help: 'Total number of tasks that have been quarantined',
       registers: [this.register],
     });

     // Counter: Total tasks recovered from quarantine
     this.promTotalRecovered = new promClient.Counter({
       name: 'keeper_tasks_recovered_total',
       help: 'Total number of tasks recovered from quarantine',
       registers: [this.register],
     });

     // Gauge: Average fee paid in XLM
     this.promAvgFee = new promClient.Gauge({
       name: 'keeper_avg_fee_paid_xlm',
       help: 'Average transaction fee paid in XLM (rolling average)',
       registers: [this.register],
     });

     // Gauge: Last cycle duration
     this.promCycleDuration = new promClient.Gauge({
       name: 'keeper_last_cycle_duration_ms',
       help: 'Duration of the last polling cycle in milliseconds',
       registers: [this.register],
     });

     // Gauge: Low gas count
     this.promLowGasCount = new promClient.Gauge({
       name: 'keeper_low_gas_count',
       help: 'Number of tasks with low gas balance',
       registers: [this.register],
     });

     // Gauge: Keeper uptime
     this.promUptime = new promClient.Gauge({
       name: 'keeper_uptime_seconds',
       help: 'Keeper service uptime in seconds since start',
       registers: [this.register],
     });

     // Gauge: RPC connection status (1 = connected, 0 = disconnected)
     this.promRpcConnected = new promClient.Gauge({
       name: 'keeper_rpc_connected',
       help: 'RPC connection status (1 = connected, 0 = disconnected)',
       registers: [this.register],
     });

     // Gauge: Forecast - underfunded tasks
     this.promUnderfundedTasks = new promClient.Gauge({
       name: 'keeper_forecast_underfunded_tasks',
       help: 'Number of tasks forecasted to be underfunded',
       registers: [this.register],
     });

     // Gauge: Forecast - high confidence forecasts
     this.promHighConfidenceForecasts = new promClient.Gauge({
       name: 'keeper_forecast_high_confidence',
       help: 'Number of tasks with high-confidence gas forecasts',
       registers: [this.register],
     });

     // Gauge: Forecast - low confidence forecasts
     this.promLowConfidenceForecasts = new promClient.Gauge({
       name: 'keeper_forecast_low_confidence',
       help: 'Number of tasks with low-confidence gas forecasts',
       registers: [this.register],
     });

     // Gauge: Forecast - risk level (0=low, 1=medium, 2=high)
     this.promForecastRiskLevel = new promClient.Gauge({
       name: 'keeper_forecast_risk_level',
       help: 'Current forecast risk level (0=low, 1=medium, 2=high)',
       registers: [this.register],
     });

     // === SLO-SPECIFIC METRICS ===

     // Histogram: Retry delay before retry attempt (seconds)
     this.promRetryDelay = new promClient.Histogram({
       name: 'keeper_retry_delay_seconds',
       help: 'Seconds waited before a retry attempt is made',
       buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
       registers: [this.register],
     });

     // Counter: Total retry attempts with outcome label
     this.promRetryAttempts = new promClient.Counter({
       name: 'keeper_retry_attempts_total',
       help: 'Total number of retry attempts made during task execution',
       labelNames: ['outcome'], // 'success', 'failure', 'duplicate'
       registers: [this.register],
     });

     // Counter: Tasks that exceeded max retries
     this.promRetriesExhausted = new promClient.Counter({
       name: 'keeper_retries_exhausted_total',
       help: 'Total number of tasks that exhausted all retry attempts',
       registers: [this.register],
     });

     // Gauge: Current size of retry queue
     this.promRetryQueueSize = new promClient.Gauge({
       name: 'keeper_retry_queue_size',
       help: 'Current number of tasks pending retry',
       registers: [this.register],
     });

     // Histogram: Time spent in retry queue before next attempt
     this.promRetryTimeInQueue = new promClient.Histogram({
       name: 'keeper_retry_time_in_queue_seconds',
       help: 'Seconds a task spent waiting in retry queue before next attempt',
       buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
       registers: [this.register],
     });

     // Counter: Tasks meeting poll freshness SLO
     this.promPollFreshnessSloSuccess = new promClient.Counter({
       name: 'keeper_poll_freshness_slo_success_total',
       help: 'Total polls that met the freshness SLO threshold',
       registers: [this.register],
     });

     // Counter: Tasks missing poll freshness SLO
     this.promPollFreshnessSloFailure = new promClient.Counter({
       name: 'keeper_poll_freshness_slo_failure_total',
       help: 'Total polls that missed the freshness SLO threshold',
       registers: [this.register],
     });

     // Counter: Tasks meeting execution timeliness SLO
     this.promExecutionTimelinessSloSuccess = new promClient.Counter({
       name: 'keeper_execution_timeliness_slo_success_total',
       help: 'Total tasks executed within the timeliness SLO threshold',
       registers: [this.register],
     });

     // Counter: Tasks missing execution timeliness SLO
     this.promExecutionTimelinessSloFailure = new promClient.Counter({
       name: 'keeper_execution_timeliness_slo_failure_total',
       help: 'Total tasks that missed the timeliness SLO threshold',
       registers: [this.register],
     });

     // Gauge: SLO success rates (computed externally, exposed as gauges for alerting)
     this.promPollFreshnessSloRate = new promClient.Gauge({
       name: 'keeper_slo_poll_freshness_rate',
       help: 'Rolling rate of poll freshness SLO success (0-1)',
       registers: [this.register],
     });

     this.promExecutionTimelinessSloRate = new promClient.Gauge({
       name: 'keeper_slo_execution_timeliness_rate',
       help: 'Rolling rate of execution timeliness SLO success (0-1)',
       registers: [this.register],
     });

     // Add default metrics (process CPU, memory, etc.)
     promClient.collectDefaultMetrics({ register: this.register });
   }

  syncPrometheusMetrics() {
    // Sync internal metrics to Prometheus metrics
    this.promTasksChecked.inc(0); // Initialize if not set
    this.promTasksDue.inc(0);
    this.promTasksExecuted.inc(0);
    this.promTasksFailed.inc(0);
    this.promThrottledRequests.inc({ limiter_name: 'poller-reads' }, 0);
    this.promThrottledRequests.inc({ limiter_name: 'execution-writes' }, 0);

    // Sync tasks skipped idempotency counter
    this.promTasksSkippedIdempotency.inc(this.metrics.counters.tasksSkippedIdempotencyTotal);

    // SLO: Poll freshness counters
    this.promPollFreshnessSloSuccess.inc(this.metrics.counters.pollFreshnessSloSuccess);
    this.promPollFreshnessSloFailure.inc(this.metrics.counters.pollFreshnessSloFailure);

    // SLO: Execution timeliness counters
    this.promExecutionTimelinessSloSuccess.inc(this.metrics.counters.executionTimelinessSloSuccess);
    this.promExecutionTimelinessSloFailure.inc(this.metrics.counters.executionTimelinessSloFailure);

    // SLO: Retry metrics
    this.promRetryAttempts.inc({ outcome: 'success' }, this.metrics.counters.retryAttemptsTotal.success);
    this.promRetryAttempts.inc({ outcome: 'failure' }, this.metrics.counters.retryAttemptsTotal.failure);
    this.promRetryAttempts.inc({ outcome: 'duplicate' }, this.metrics.counters.retryAttemptsTotal.duplicate);
    this.promRetriesExhausted.inc(this.metrics.counters.retriesExhausted);
    this.promRetriesExecuted.inc(this.metrics.counters.retriesExecutedTotal);
    this.promRetriesFailed.inc(this.metrics.counters.retriesFailedTotal);

    // SLO gauges
    this.promPollFreshnessSeconds.set(this.metrics.gauges.pollFreshnessSeconds);
    this.promOldestTaskAgeSeconds.set(this.metrics.gauges.oldestTaskAgeSeconds);
    this.promRetryQueueSize.set(this.metrics.gauges.retryQueueSize);
    this.promPollFreshnessSloRate.set(this.metrics.gauges.pollFreshnessSloRate);
    this.promExecutionTimelinessSloRate.set(this.metrics.gauges.executionTimelinessSloRate);

    this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    this.promCycleDuration.set(this.metrics.gauges.lastCycleDurationMs);
    this.promLowGasCount.set(this.gasMonitor.getLowGasCount());

    // Sync dead-letter queue metrics
    if (this.deadLetterQueue) {
      const dlqStats = this.deadLetterQueue.getStats();
      this.promQuarantinedCount.set(dlqStats.activeQuarantined);
      this.promTotalQuarantined.inc(0); // Initialize
      this.promTotalRecovered.inc(0); // Initialize
    }

    const uptimeSeconds = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    this.promUptime.set(uptimeSeconds);
    this.promRpcConnected.set(this.metrics.rpcConnected ? 1 : 0);

    // Compute poll freshness dynamically based on last completion time
    const freshnessSeconds = this.metrics.lastPollCompletedAt
      ? Math.floor((Date.now() - this.metrics.lastPollCompletedAt.getTime()) / 1000)
      : 0;
    this.promPollFreshnessSeconds.set(freshnessSeconds);
  }

  start() {
    this.server = http.createServer((req, res) => {
      // CORS headers for initial development
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/health' || req.url === '/health/') {
        this.handleHealth(res);
      } else if (req.url === '/metrics' || req.url === '/metrics/') {
        this.handleMetrics(res);
      } else if (req.url === '/metrics/prometheus' || req.url === '/metrics/prometheus/') {
        this.handlePrometheusMetrics(res);
      } else if (req.url === '/metrics/forecast' || req.url === '/metrics/forecast/') {
        this.handleForecast(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Metrics server running on port ${this.port}`);
      this.logger.info(
        `Health endpoint: http://localhost:${this.port}/health`,
      );
      this.logger.info(
        `Metrics endpoint: http://localhost:${this.port}/metrics`,
      );
      this.logger.info(
        `Prometheus endpoint: http://localhost:${this.port}/metrics/prometheus`,
      );
      this.logger.info(
        `Forecast endpoint: http://localhost:${this.port}/metrics/forecast`,
      );
    });

    this.io.on('connection', (socket) => {
      this.logger.info('Client connected via WebSocket', { socketId: socket.id });

      // Send initial state
      socket.emit('sync:metrics', this.metrics.snapshot());
      if (this.registry) {
        socket.emit('sync:tasks', this.registry.getTasksWithStats());
      }

      socket.on('disconnect', () => {
        this.logger.info('Client disconnected', { socketId: socket.id });
      });
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Server running on port ${this.port}`);
      this.logger.info(`WebSocket enabled on http://localhost:${this.port}`);
    });
  }

   broadcast(event, data) {
     if (this.io) {
       this.io.emit(event, data);
     }
   }

   // === SLO Metrics Recording Methods ===

    /**
     * Record poll cycle completion for freshness tracking.
     * Call after a poll cycle finishes.
     * @param {number} pollCycleDurationMs - Duration of the poll cycle in ms
     * @param {number} intervalMs - Expected polling interval in ms (used for first cycle)
     */
    recordPollCycle(pollCycleDurationMs, intervalMs = this.metrics.pollIntervalMs) {
      const now = Date.now();
      const previousCompletion = this.metrics.lastPollCompletedAt ? this.metrics.lastPollCompletedAt.getTime() : null;
      this.metrics.lastPollCompletedAt = new Date(now);

      // Determine actual interval between poll completions
      let actualIntervalMs = pollCycleDurationMs;
      if (previousCompletion) {
        actualIntervalMs = now - previousCompletion;
      } else {
        // First cycle: use configured interval as approximation
        actualIntervalMs = intervalMs;
      }

      // Record poll interval histogram (seconds)
      this.promPollInterval.observe(actualIntervalMs / 1000);

      // SLO: Check if poll met freshness threshold (i.e., completed within expected interval)
      if (actualIntervalMs <= this.metrics.sloThresholds.pollFreshnessMs) {
        this.metrics.increment('pollFreshnessSloSuccess');
      } else {
        this.metrics.increment('pollFreshnessSloFailure');
      }

      this._computeSloRates();
      this.broadcast('sync:metrics', this.metrics.snapshot());
    }

    /**
     * Record task execution for timeliness SLO.
     * Call when a task execution completes (success or failure).
     * @param {number} taskId - The task ID
     * @param {number} actualExecutionLedger - Ledger when execution completed
     * @param {number} scheduledDueLedger - Ledger when task was due
     * @param {boolean} success - Whether execution succeeded
     */
    recordTaskExecution({ taskId, actualExecutionLedger, scheduledDueLedger, success }) {
      const latenessLedgers = Math.max(0, actualExecutionLedger - scheduledDueLedger);
      this.promTaskLateness.observe(latenessLedgers);

      // Convert to milliseconds assuming ~5s per ledger on testnet (configurable)
      const avgLedgerTimeMs = parseInt(process.env.LEDGER_TIME_MS || '5000', 10);
      const latenessMs = latenessLedgers * avgLedgerTimeMs;

      // SLO: Check if execution met timeliness threshold
      if (latenessMs <= this.metrics.sloThresholds.executionTimelinessMs) {
        this.metrics.increment('executionTimelinessSloSuccess');
      } else {
        this.metrics.increment('executionTimelinessSloFailure');
      }

      this._computeSloRates();
      this.broadcast('sync:metrics', this.metrics.snapshot());
    }

   /**
    * Record retry attempt.
    * @param {string} outcome - 'success', 'failure', or 'duplicate'
    */
   recordRetryAttempt(outcome) {
     this.metrics.increment('retryAttemptsTotal', { outcome });
   }

   /**
    * Record retry scheduling event.
    * @param {number} delayMs - Delay before retry in milliseconds
    */
   recordRetryDelay(delayMs) {
     this.promRetryDelay.observe(delayMs / 1000);
   }

   /**
    * Record task time spent in retry queue before next attempt.
    * @param {number} timeInQueueMs - Time spent waiting in milliseconds
    */
   recordRetryTimeInQueue(timeInQueueMs) {
     this.promRetryTimeInQueue.observe(timeInQueueMs / 1000);
   }

   /**
    * Update retry queue size gauge.
    * @param {number} size - Current retry queue size
    */
   setRetryQueueSize(size) {
     this.metrics.record('retryQueueSize', size);
   }

   /**
    * Update oldest task age (time since last_run).
    * @param {number} oldestAgeSeconds - Age in seconds of the oldest task
    */
   setOldestTaskAge(oldestAgeSeconds) {
     this.metrics.record('oldestTaskAgeSeconds', oldestAgeSeconds);
   }

   /**
    * Compute rolling SLO success rates.
    * Called internally after each SLO observation.
    */
   _computeSloRates() {
     const totalPoll = this.metrics.counters.pollFreshnessSloSuccess + this.metrics.counters.pollFreshnessSloFailure;
     if (totalPoll > 0) {
       this.metrics.record('pollFreshnessSloRate', this.metrics.counters.pollFreshnessSloSuccess / totalPoll);
     }

     const totalExec = this.metrics.counters.executionTimelinessSloSuccess + this.metrics.counters.executionTimelinessSloFailure;
     if (totalExec > 0) {
       this.metrics.record('executionTimelinessSloRate', this.metrics.counters.executionTimelinessSloSuccess / totalExec);
     }
   }

  handleHealth(res) {
    const healthStatus = this.metrics.getHealthStatus(
      this.healthStaleThreshold,
    );
    const httpStatus = healthStatus.status === 'stale' ? 503 : 200;

    res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthStatus, null, 2));
  }

  handleMetrics(res) {
    const gasConfig = this.gasMonitor.getConfig();
    const taskMetrics = this.metrics.snapshot();
    const forecasterState = this.gasMonitor.getForecasterState();

    const metricsData = {
      // Task execution metrics
      ...taskMetrics,

      // Gas monitoring metrics
      lowGasCount: this.gasMonitor.getLowGasCount(),
      gasWarnThreshold: gasConfig.gasWarnThreshold,
      alertDebounceMs: gasConfig.alertDebounceMs,
      alertWebhookEnabled: gasConfig.alertWebhookEnabled,

      // Forecasting metrics
      forecasting: {
        enabled: gasConfig.forecastingEnabled,
        safetyBuffer: gasConfig.forecastSafetyBuffer,
        aggregationWindowSeconds: gasConfig.forecastAggregationWindow,
        trackedTasks: forecasterState.trackedTasks,
        totalHistoricalSamples: forecasterState.totalHistoricalSamples,
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metricsData, null, 2));
  }

  /**
   * Handle forecast endpoint: GET /metrics/forecast
   * Returns forecaster state and configuration.
   */
  handleForecast(res) {
    const forecastData = this.gasMonitor.getForecasterState();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(forecastData, null, 2));
  }

  async handlePrometheusMetrics(res) {
    try {
      // Sync current metrics to Prometheus
      this.syncPrometheusMetrics();

      // Get Prometheus formatted metrics
      const metrics = await this.register.metrics();

      res.writeHead(200, { 'Content-Type': this.register.contentType });
      res.end(metrics);
    } catch (error) {
      this.logger.error('Error generating Prometheus metrics', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  handleDeadLetter(res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue not enabled' }));
      return;
    }

    try {
      const stats = this.deadLetterQueue.getStats();
      const records = this.deadLetterQueue.getAllRecords({ limit: 100 });

      const response = {
        stats,
        records,
        quarantinedTasks: this.deadLetterQueue.getQuarantinedTasks(),
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response, null, 2));
    } catch (error) {
      this.logger.error('Error fetching dead-letter queue data', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  handleDeadLetterTask(req, res) {
    if (!this.deadLetterQueue) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dead-letter queue not enabled' }));
      return;
    }

    try {
      // Extract task ID from URL: /dead-letter/123
      const taskIdStr = req.url.split('/')[2];
      const taskId = parseInt(taskIdStr, 10);

      if (isNaN(taskId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid task ID' }));
        return;
      }

      const record = this.deadLetterQueue.getRecord(taskId);

      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found in dead-letter queue' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(record, null, 2));
    } catch (error) {
      this.logger.error('Error fetching dead-letter task', { error: error.message });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  updateHealth(state) {
    this.metrics.updateHealth(state);
    this.broadcast('sync:health', this.metrics.getHealthStatus(this.healthStaleThreshold));
  }

  increment(key, amount) {
    this.metrics.increment(key, amount);

    // Update Prometheus counters
    if (key === 'tasksCheckedTotal') {
      this.promTasksChecked.inc(amount);
    } else if (key === 'tasksDueTotal') {
      this.promTasksDue.inc(amount);
    } else if (key === 'tasksExecutedTotal') {
      this.promTasksExecuted.inc(amount);
    } else if (key === 'tasksFailedTotal') {
      this.promTasksFailed.inc(amount);
    } else if (key === 'tasksSkippedIdempotencyTotal') {
      this.promTasksSkippedIdempotency.inc(amount);
    } else if (key === 'throttledRequestsTotal') {
      this.promThrottledRequests.inc({ limiter_name: amount.name || 'unknown' }, amount.value || 1);
    } else if (key === 'pollFreshnessSloSuccess') {
      this.promPollFreshnessSloSuccess.inc(amount);
    } else if (key === 'pollFreshnessSloFailure') {
      this.promPollFreshnessSloFailure.inc(amount);
    } else if (key === 'executionTimelinessSloSuccess') {
      this.promExecutionTimelinessSloSuccess.inc(amount);
    } else if (key === 'executionTimelinessSloFailure') {
      this.promExecutionTimelinessSloFailure.inc(amount);
    } else if (key === 'retriesExhausted') {
      this.promRetriesExhausted.inc(amount);
    } else if (key === 'retriesExecutedTotal') {
      this.promRetriesExecuted.inc(amount);
    } else if (key === 'retriesFailedTotal') {
      this.promRetriesFailed.inc(amount);
    } else if (key === 'retryAttemptsTotal' && typeof amount === 'object') {
      const outcome = amount.outcome || 'unknown';
      this.promRetryAttempts.inc({ outcome }, 1);
    }

    this.broadcast('sync:metrics', this.metrics.snapshot());
  }

  record(key, value) {
    this.metrics.record(key, value);

    // Update Prometheus gauges
    if (key === 'avgFeePaidXlm') {
      this.promAvgFee.set(this.metrics.gauges.avgFeePaidXlm);
    } else if (key === 'lastCycleDurationMs') {
      this.promCycleDuration.set(value);
    } else if (key === 'pollFreshnessSeconds') {
      this.promPollFreshnessSeconds.set(value);
    } else if (key === 'oldestTaskAgeSeconds') {
      this.promOldestTaskAgeSeconds.set(value);
    } else if (key === 'retryQueueSize') {
      this.promRetryQueueSize.set(value);
    } else if (key === 'pollFreshnessSloRate') {
      this.promPollFreshnessSloRate.set(value);
    } else if (key === 'executionTimelinessSloRate') {
      this.promExecutionTimelinessSloRate.set(value);
    }

    this.broadcast('sync:metrics', this.metrics.snapshot());
  }

  stop() {
    if (this.io) {
      this.io.close();
    }
    if (this.server) {
      this.server.close();
      this.logger.info('Server stopped');
    }
  }
}

module.exports = { Metrics, MetricsServer };

