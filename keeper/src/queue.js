const EventEmitter = require('events');
const { createRateLimiter } = require('./concurrency');
const { createLogger } = require('./logger');
const { RetryScheduler } = require('./retryScheduler');
const { acquireLock, releaseLock } = require('./lock');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WRITES_PER_SECOND = 5;
const DEFAULT_PRIORITY = 0;
const PRIORITY_LABELS = {
  low: -1,
  medium: 0,
  high: 1,
  critical: 2,
};

function normalizePriority(priority) {
  if (typeof priority === 'string') {
    const normalized = priority.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, normalized)) {
      return PRIORITY_LABELS[normalized];
    }
    const parsed = Number(priority);
    return Number.isFinite(parsed) ? parsed : DEFAULT_PRIORITY;
  }

  if (typeof priority === 'number' && Number.isFinite(priority)) {
    return priority;
  }

  return DEFAULT_PRIORITY;
}

function getMicrosecondTimestamp() {
  return Number(process.hrtime.bigint() / 1000n);
}

function defaultTaskComparator(a, b) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  if (a.dueAt !== b.dueAt) {
    return a.dueAt - b.dueAt;
  }

  if (a.queuedAt !== b.queuedAt) {
    return a.queuedAt < b.queuedAt ? -1 : 1;
  }

  return 0;
}

function buildTaskItem(task) {
  if (typeof task === 'object' && task !== null) {
    return {
      taskId: task.taskId,
      context: task.context || {},
      priority: normalizePriority(task.priority),
      dueAt: typeof task.dueAt === 'number' ? task.dueAt : Date.now(),
      queuedAt: getMicrosecondTimestamp(),
      payload: task.payload || null,
      meta: task.meta || {},
      originalTask: task,
    };
  }

  return {
    taskId: task,
    context: {},
    priority: DEFAULT_PRIORITY,
    dueAt: Date.now(),
    queuedAt: getMicrosecondTimestamp(),
    payload: null,
    meta: {},
    originalTask: task,
  };
}

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, options = {}) {
    super();

    const legacyRetryScheduler =
      options
      && typeof options === 'object'
      && !Object.prototype.hasOwnProperty.call(options, 'retryScheduler')
      && !Object.prototype.hasOwnProperty.call(options, 'idempotencyGuard')
      && typeof options.scheduleRetry === 'function';

    const normalizedOptions = legacyRetryScheduler
      ? { retryScheduler: options, distributedLockEnabled: false }
      : options;

    this.logger = normalizedOptions.logger || createLogger('queue');
    this.metricsServer = metricsServer;
    this.idempotencyGuard = options.idempotencyGuard || null;

    const schedulerCandidate = options.retryScheduler;
    const hasRetrySchedulerInterface =
      schedulerCandidate &&
      typeof schedulerCandidate.scheduleRetry === 'function' &&
      typeof schedulerCandidate.shutdown === 'function';

    this.retryScheduler = hasRetrySchedulerInterface
      ? schedulerCandidate
      : new RetryScheduler(normalizedOptions.retryScheduler);

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || DEFAULT_CONCURRENCY,
      10,
    );

    this.maxWritesPerSecond = parseInt(
      normalizedOptions.maxWritesPerSecond || process.env.MAX_WRITES_PER_SECOND || DEFAULT_WRITES_PER_SECOND,
      10,
    );

    this.limit = createRateLimiter({
      concurrency: this.concurrencyLimit,
      rps: this.maxWritesPerSecond,
      logger: this.logger,
      name: 'execution-writes',
      onThrottle: (event) => {
        if (this.metricsServer) {
          this.metricsServer.increment('throttledRequestsTotal', { name: event.name });
        }
      },
      compare: options.taskComparator || defaultTaskComparator,
    });

    this.distributedLockEnabled = normalizedOptions.distributedLockEnabled !== false;

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();
    this.retryTaskIds = new Set();
    this.shuttingDown = false;
  }

  async initialize() {
    if (this.retryScheduler && typeof this.retryScheduler.initialize === 'function') {
      await this.retryScheduler.initialize();
    }
  }

  getReadyRetries(limit = parseInt(process.env.MAX_RETRIES_PER_CYCLE || '2', 10)) {
    if (!this.retryScheduler || typeof this.retryScheduler.getReadyRetries !== 'function') {
      return [];
    }

    const ready = this.retryScheduler.getReadyRetries();
    const limited = ready.slice(0, Math.max(limit, 0));
    limited.forEach((retry) => this.retryTaskIds.add(retry.taskId));
    return limited;
  }

  _shouldSkipTask(taskId) {
    if (this.failedTasks.has(taskId) || this.retryTaskIds.has(taskId)) {
      return true;
    }

    if (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function') {
      return !!this.retryScheduler.getRetryMetadata(taskId);
    }

    return false;
  }

  _buildTaskMeta(taskItem) {
    return {
      priority: taskItem.priority,
      dueAt: taskItem.dueAt,
      queuedAt: taskItem.queuedAt,
      taskId: taskItem.taskId,
    };
  }

  async enqueue(tasksToEnqueue, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting new execution batch', {
        taskCount: Array.isArray(tasksToEnqueue) ? tasksToEnqueue.length : 0,
      });
      return;
    }

    this.failedTasks.clear();

    const taskItems = (tasksToEnqueue || [])
      .map(buildTaskItem)
      .filter((taskItem) => taskItem.taskId !== undefined && !this._shouldSkipTask(taskItem.taskId));

    this.depth = taskItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksDueTotal', taskItems.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = taskItems.map((taskItem) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = taskItem.taskId;
        const initialContext = taskItem.context || {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
              pollCorrelationId: attemptContext.pollCorrelationId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        const hasContext = Object.keys(attemptContext).length > 0;
        this.emitTaskEvent('task:started', taskId, hasContext ? attemptContext : null);

        const taskConfig = taskConfigMap[taskId] || null;

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          const result = await executorFn(taskId, attemptContext);

          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext.attemptId,
            });
          }

          this.emit('task:success', taskId, attemptContext, result);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          const retryMetadata = (this.retryScheduler && typeof this.retryScheduler.getRetryMetadata === 'function')
            ? this.retryScheduler.getRetryMetadata(taskId)
            : null;
          const currentAttempt = retryMetadata?.currentAttempt || 0;

          if (this.retryScheduler && typeof this.retryScheduler.scheduleRetry === 'function') {
            await this.retryScheduler.scheduleRetry({
              taskId,
              error,
              currentAttempt,
              taskConfig,
            });
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markFailed(taskId, {
              attemptId: attemptContext.attemptId,
              lastError: error.message,
            });
          }

          this.emit('task:failed', taskId, error, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
        }
      }, this._buildTaskMeta(taskItem));
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Execution cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
      this.retryTaskIds.clear();
      this.failedTasks.clear();
    }
  }

  async enqueueRetries(retryTasks, executorFn, taskConfigMap = {}) {
    if (this.shuttingDown) {
      this.logger.warn('Queue is shutting down, rejecting retry execution batch', {
        taskCount: Array.isArray(retryTasks) ? retryTasks.length : 0,
      });
      return;
    }

    if (!Array.isArray(retryTasks) || retryTasks.length === 0) {
      return;
    }

    this.failedTasks.clear();

    const retryItems = retryTasks
      .filter((task) => task && task.taskId !== undefined)
      .map((task) => ({
        taskId: task.taskId,
        context: task.context || {},
        priority: normalizePriority(task.priority ?? 'high'),
        dueAt: typeof task.nextAttemptTime === 'number' ? task.nextAttemptTime : Date.now(),
        queuedAt: getMicrosecondTimestamp(),
        retryMetadata: task,
      }))
      .filter((taskItem) => !this._shouldSkipTask(taskItem.taskId));

    this.depth = retryItems.length;

    if (this.metricsServer) {
      this.metricsServer.increment('tasksRetriedTotal', retryItems.length);
    }

    const cycleStartTime = Date.now();
    const cyclePromises = retryItems.map((taskItem) => {
      return this.limit(async () => {
        if (this.shuttingDown) {
          return;
        }

        const taskId = taskItem.taskId;
        const initialContext = taskItem.context || {};
        let attemptContext = { ...initialContext };
        let distributedLockToken = null;

        this.retryTaskIds.add(taskId);
        this.emit('retry:started', taskId, taskItem.retryMetadata);

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          attemptContext.attemptId = lockResult.attemptId;

          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment('tasksSkippedIdempotencyTotal', 1);
            }
            this.emit('task:skipped', taskId, {
              reason: 'idempotency_lock',
              attemptId: lockResult.attemptId,
            });
            return;
          }
        }

        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('task:started', taskId, attemptContext);

        const taskConfig = taskConfigMap[taskId] || null;

        try {
          if (this.distributedLockEnabled) {
            const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
            distributedLockToken = await acquireLock(taskId, lockTtl);
            if (!distributedLockToken) {
              this.logger.info('Skipping retry task due to distributed lock contention', { taskId });
              this.emit('task:skipped', taskId, { reason: 'distributed_lock' });
              return;
            }
          }

          await executorFn(taskId, attemptContext);

          this.completed++;

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, true);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

          this.emit('retry:success', taskId, taskItem.retryMetadata);
        } catch (error) {
          this.failedCount++;
          this.failedTasks.add(taskId);

          if (this.retryScheduler && typeof this.retryScheduler.completeRetry === 'function') {
            await this.retryScheduler.completeRetry(taskId, false);
          }

          if (this.metricsServer) {
            this.metricsServer.increment('tasksFailedTotal', 1);
          }

          this.emit('retry:failed', taskId, error, taskItem.retryMetadata, attemptContext);
        } finally {
          if (distributedLockToken) {
            try {
              await releaseLock(taskId, distributedLockToken);
            } catch (err) {
              this.logger.error('Error releasing lock', { taskId, error: err.message });
            }
          }
          this.inFlight--;
        }
      }, this._buildTaskMeta(taskItem));
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (error) {
      this.logger.debug('Retry cycle completed with some task-level failures', {
        error: error.message,
      });
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer && typeof this.metricsServer.record === 'function') {
        this.metricsServer.record('lastCycleDurationMs', cycleDuration);
      }

      this.emit('retry:cycle:complete', {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
      this.retryTaskIds.clear();
      this.failedTasks.clear();
    }
  }

  async gracefulShutdown(options = {}) {
    const drainTimeoutMs = parseInt(
      options.drainTimeoutMs || process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || 30000,
      10
    );
    const onProgress = options.onProgress || (() => {});

    const startTime = Date.now();
    const initialInFlight = this.inFlight;

    this.logger.info('Starting graceful queue shutdown', {
      drainTimeoutMs,
      inFlightTasks: initialInFlight,
      queuedTasks: this.depth,
    });

    this.shuttingDown = true;
    this.limit.clearQueue();
    this.depth = 0;

    onProgress({ phase: 'clearing-queue', remaining: this.inFlight });

    const drained = await Promise.race([
      (async () => {
        if (this.activePromises.length > 0) {
          await Promise.allSettled(this.activePromises);
        }
        while (this.inFlight > 0) {
          await new Promise((r) => setTimeout(r, 50));
          onProgress({ phase: 'draining', remaining: this.inFlight });
        }
        return true;
      })(),
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.logger.warn('Graceful shutdown drain timeout', {
            remainingInFlight: this.inFlight,
            durationMs: Date.now() - startTime,
          });
          resolve(false);
        }, drainTimeoutMs);

        this.once('drain:complete', () => clearTimeout(timeoutId));
      }),
    ]);

    const durationMs = Date.now() - startTime;
    const summary = {
      drained,
      initialInFlight,
      remaining: this.inFlight,
      durationMs,
      completedCount: this.completed,
      failedCount: this.failedCount,
    };

    if (drained) {
      this.logger.info('Queue gracefully drained', summary);
    } else {
      this.logger.warn('Queue drain timeout, forcing shutdown', summary);
    }

    this.emit('drain:complete', summary);
    return summary;
  }

  drain(options = {}) {
    return this.gracefulShutdown(options);
  }

  getInFlightStatus() {
    return {
      inFlight: this.inFlight,
      activePromises: this.activePromises.length,
      depth: this.depth,
      completed: this.completed,
      failed: this.failedCount,
      failedTaskIds: Array.from(this.failedTasks),
      queueDepth: this.limit?.getStats?.().queueDepth || 0,
    };
  }

  async shutdown() {
    this.shuttingDown = true;
    this.logger.info('Shutting down execution queue');

    await this.gracefulShutdown();

    if (this.retryScheduler && typeof this.retryScheduler.shutdown === 'function') {
      await this.retryScheduler.shutdown();
    }

    this.logger.info('Execution queue shutdown complete');
  }

  getRetryStatistics() {
    return (this.retryScheduler && typeof this.retryScheduler.getStatistics === 'function')
      ? this.retryScheduler.getStatistics()
      : { total: 0, pending: 0, overdue: 0 };
  }
}

module.exports = { ExecutionQueue };
