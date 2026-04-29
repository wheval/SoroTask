const EventEmitter = require("events");
const { createRateLimiter } = require("./concurrency");
const { createLogger } = require("./logger");
const { acquireLock, releaseLock } = require("./lock");
const { RetryScheduler } = require("./retryScheduler");

// Locker logger for lock release operations
const lockerLogger = createLogger('locker');

class ExecutionQueue extends EventEmitter {
  constructor(limit, metricsServer, arg = {}, options = {}) {
    super();

    // Determine logger: can be provided either in options or as third arg if it's an options object
    this.logger = (arg && arg.logger) || (options && options.logger) || createLogger('queue');

    this.concurrencyLimit = parseInt(
      limit || process.env.MAX_CONCURRENT_EXECUTIONS || 3,
      10,
    );

    // Determine maxWritesPerSecond from arg if options style or options
    const mwps = (arg && arg.maxWritesPerSecond) || (options && options.maxWritesPerSecond) || process.env.MAX_WRITES_PER_SECOND || 5;
    this.maxWritesPerSecond = parseInt(mwps, 10);

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
    });
    this.metricsServer = metricsServer;

    // Determine idempotencyGuard and retryScheduler from args
    let idempotencyGuard = null;
    let retryScheduler = null;

    if (arg && typeof arg.scheduleRetry === 'function') {
      // Third argument is a retry scheduler directly (legacy test style)
      retryScheduler = arg;
    } else if (arg) {
      // Third argument is an options object
      idempotencyGuard = arg.idempotencyGuard || null;
      retryScheduler = arg.retryScheduler || null;
    }

    this.idempotencyGuard = idempotencyGuard || (options && options.idempotencyGuard) || null;
    retryScheduler = retryScheduler || (options && options.retryScheduler) || null;

    // If no retryScheduler provided, create a default one
    if (!retryScheduler) {
      retryScheduler = new RetryScheduler();
    }
    this.retryScheduler = retryScheduler;

    // Map to store due ledger for tasks
    this.taskDueInfo = new Map();

    this.depth = 0;
    this.inFlight = 0;
    this.completed = 0;
    this.failedCount = 0;

    this.activePromises = [];
    this.failedTasks = new Set();

    // Retry tracking
    this.retryTaskIds = new Set(); // Tasks being retried in current cycle
  }

  /**
   * Initialize the queue and its retry scheduler.
   */
  async initialize() {
    await this.retryScheduler.initialize();
  }

  /**
   * Get retry tasks ready for execution, optionally limited.
   * @param {number} limit - Maximum number of retries to return
   * @returns {Array} Array of retry task metadata
   */
  getReadyRetries(limit = Infinity) {
    const ready = this.retryScheduler.getReadyRetries();
    // Mark these tasks as being considered for retry
    ready.forEach(r => this.retryTaskIds.add(r.taskId));
    if (limit && limit < ready.length) {
      return ready.slice(0, limit);
    }
    return ready;
  }

  /**
   * Update retry queue size gauge in metrics.
   */
  _updateRetryQueueSize() {
    if (this.metricsServer) {
      const stats = this.retryScheduler.getStatistics();
      this.metricsServer.setRetryQueueSize(stats.total);
    }
  }

  async enqueue(taskIds, executorFn) {
    // Normalize taskIds to objects with taskId and optional dueLedger
    const taskInfos = taskIds.map(entry => {
      if (typeof entry === 'object' && entry !== null && entry.taskId !== undefined) {
        return entry;
      }
      return { taskId: entry, dueLedger: undefined };
    }).filter(info => !this.failedTasks.has(info.taskId));

    this.depth = taskInfos.length;

    // Track tasks due for this cycle
    if (this.metricsServer) {
      this.metricsServer.increment("tasksDueTotal", taskInfos.length);
    }

    const cycleStartTime = Date.now();

    const cyclePromises = taskInfos.map((taskInfo) => {
      return this.limit(async () => {
        const { taskId, dueLedger } = taskInfo;
        // Store due ledger for SLO tracking
        if (dueLedger !== undefined) {
          this.taskDueInfo.set(taskId, dueLedger);
        }

        let attemptContext = null;

        if (this.idempotencyGuard) {
          const lockResult = this.idempotencyGuard.acquire(taskId);
          if (!lockResult.acquired) {
            if (this.metricsServer) {
              this.metricsServer.increment("tasksSkippedIdempotencyTotal", 1);
            }
            // Clean up due info if present
            this.taskDueInfo.delete(taskId);
            this.emit("task:skipped", taskId, {
              reason: "idempotency_lock",
              attemptId: lockResult.attemptId,
            });
            return;
          }
          attemptContext = { attemptId: lockResult.attemptId };
        }

         this.inFlight++;
         this.depth = Math.max(this.depth - 1, 0);

         // Acquire distributed lock before executing
         const lockTtl = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
         const token = await acquireLock(taskId, lockTtl);
         if (!token) {
           // Could not acquire lock; another keeper likely processing this task
           this.taskDueInfo.delete(taskId);
           this.emit('task:skipped', taskId, { reason: 'lock_contention' });
           this.inFlight--; // decrement inFlight since we're skipping
           return;
         }

         try {
           // Emit started event now that lock is acquired
           if (attemptContext) {
             this.emit("task:started", taskId, attemptContext);
           } else {
             this.emit("task:started", taskId);
           }

           // Execute task and capture result
           const result = attemptContext
             ? await executorFn(taskId, attemptContext)
             : await executorFn(taskId);

          this.completed++;

           // Remove from retry queue if it was there
           await this.retryScheduler.completeRetry(taskId, true);
           this._updateRetryQueueSize();

           // Remove from failed set so task can be processed again in future cycles
           this.failedTasks.delete(taskId);

           if (this.metricsServer) {
            this.metricsServer.increment("tasksExecutedTotal", 1);
            // Record execution lateness if due info available
            const dueLedger = this.taskDueInfo.get(taskId);
            if (dueLedger !== undefined && result) {
              const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
              if (execLedger !== null) {
                this.metricsServer.recordTaskExecution({
                  taskId,
                  actualExecutionLedger: execLedger,
                  scheduledDueLedger: dueLedger,
                  success: true,
                });
              }
            }
            // Clean up due info after processing
            this.taskDueInfo.delete(taskId);
          } else {
            // No metrics server - still clean up
            this.taskDueInfo.delete(taskId);
          }

          if (this.idempotencyGuard) {
            this.idempotencyGuard.markCompleted(taskId, {
              attemptId: attemptContext?.attemptId,
            });
          }
          this.emit("task:success", taskId);
         } catch (error) {
           this.failedCount++;
           this.failedTasks.add(taskId);

           // Schedule retry for retryable errors
           const retryMetadata = this.retryScheduler.getRetryMetadata(taskId);
           const currentAttempt = retryMetadata?.currentAttempt || 0;

           const scheduleResult = await this.retryScheduler.scheduleRetry({
             taskId,
             error,
             currentAttempt,
             taskConfig: null,
           });

           if (this.metricsServer) {
             this.metricsServer.increment("tasksFailedTotal", 1);
             // Record retry delay if retry was scheduled
             if (scheduleResult && scheduleResult.scheduled && scheduleResult.nextAttemptTime) {
               const delayMs = scheduleResult.nextAttemptTime - Date.now();
               this.metricsServer.recordRetryDelay(delayMs);
             }
             this._updateRetryQueueSize();
           }

           // If retry not scheduled (max retries exceeded), clean up due info
           if (scheduleResult && !scheduleResult.scheduled) {
             this.taskDueInfo.delete(taskId);
           }

           if (this.idempotencyGuard) {
             this.idempotencyGuard.markFailed(taskId, {
               attemptId: attemptContext?.attemptId,
               lastError: error.message || String(error),
             });
           }
           this.emit("task:failed", taskId, error);
         } finally {
           // Attempt to release the lock if we hold it
           try {
             if (token) {
               const released = await releaseLock(taskId, token);
               if (!released) {
                 lockerLogger.warn('Lock release failed (token mismatch or expired)', { taskId });
               }
             }
           } catch (err) {
             lockerLogger.error('Error releasing lock', { taskId, error: err.message });
           }

           this.inFlight--;
         }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.allSettled(cyclePromises);
    } catch (_) {
      // already handled
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer?.record) {
        this.metricsServer.record("lastCycleDurationMs", cycleDuration);
      }

      this.emit("cycle:complete", {
        depth: this.depth,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;

      // Clear retry task IDs for next cycle
      this.retryTaskIds.clear();
    }
  }

  async enqueueRetries(retryTasks, executorFn) {
    if (retryTasks.length === 0) {
      return;
    }

    this.depth += retryTasks.length;

    const cycleStartTime = Date.now();

    const cyclePromises = retryTasks.map((retryTask) => {
      return this.limit(async () => {
        const { taskId, nextAttemptTime } = retryTask;
        this.inFlight++;
        this.depth = Math.max(this.depth - 1, 0);

        this.emit('retry:started', taskId, retryTask);

        // Record time spent in retry queue
        if (this.metricsServer) {
          const now = Date.now();
          const timeInQueueMs = now - nextAttemptTime;
          if (timeInQueueMs >= 0) {
            this.metricsServer.recordRetryTimeInQueue(timeInQueueMs);
          }
        }

        try {
          const result = await executorFn(taskId);
          this.completed++;

          // Process SLO for successful execution (if due info exists)
          if (this.metricsServer) {
            const dueLedger = this.taskDueInfo.get(taskId);
            if (dueLedger !== undefined && result) {
              const execLedger = result.ledger !== undefined ? result.ledger : (result.executionLedger ?? null);
              if (execLedger !== null) {
                this.metricsServer.recordTaskExecution({
                  taskId,
                  actualExecutionLedger: execLedger,
                  scheduledDueLedger: dueLedger,
                  success: true,
                });
              }
            }
            this.metricsServer.recordRetryAttempt('success');
            this.metricsServer.increment('retriesExecutedTotal', 1);
            this.metricsServer.increment('tasksExecutedTotal', 1);
          }

           // Mark retry as successful
           await this.retryScheduler.completeRetry(taskId, true);
           this._updateRetryQueueSize();

           // Remove from failed set so task can be processed again in future cycles
           this.failedTasks.delete(taskId);

           if (this.metricsServer) {
            this.metricsServer.recordRetryAttempt('failure');
            this.metricsServer.increment('retriesFailedTotal', 1);
          }

          // If retry permanently failed (max retries exceeded), clean up due info
          if (completeResult && completeResult.removed) {
            this.taskDueInfo.delete(taskId);
          }

          this.emit('retry:failed', taskId, error, retryTask, completeResult);
        } finally {
          this.inFlight--;
        }
      });
    });

    this.activePromises.push(...cyclePromises);

    try {
      await Promise.all(cyclePromises);
    } catch (_) {
      // already handled
    } finally {
      const cycleDuration = Date.now() - cycleStartTime;
      if (this.metricsServer?.record) {
        this.metricsServer.record('lastRetryCycleDurationMs', cycleDuration);
      }

      this.emit('retry:cycle:complete', {
        depth: retryTasks.length,
        inFlight: this.inFlight,
        completed: this.completed,
        failed: this.failedCount,
      });

      this.activePromises = [];
      this.completed = 0;
      this.failedCount = 0;
    }
  }

  async drain() {
    this.limit.clearQueue();
    this.depth = 0;

    if (this.activePromises.length > 0) {
      await Promise.allSettled(this.activePromises);
    }

    while (this.inFlight > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * Get retry queue statistics
   */
  getRetryStatistics() {
    return this.retryScheduler.getStatistics();
  }

  /**
   * Shutdown gracefully
   */
  async shutdown() {
    await this.retryScheduler.shutdown();
  }
}

module.exports = { ExecutionQueue };
