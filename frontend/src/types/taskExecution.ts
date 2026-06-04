/**
 * Task Execution Streaming Types
 * 
 * Defines the types for real-time task execution tracking, including
 * execution status, logs, and performance metrics.
 */

export type ExecutionStatus = 
  | 'pending'
  | 'preparing'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'trace';

/**
 * Represents a single log entry during task execution
 */
export interface ExecutionLogEntry {
  id: string;
  taskId: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Represents the overall execution state of a task
 */
export interface TaskExecutionState {
  taskId: string;
  status: ExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  logs: ExecutionLogEntry[];
  currentPhase?: string;
  progress?: {
    current: number;
    total: number;
  };
  error?: {
    code: string;
    message: string;
    stack?: string;
  };
  gasUsed?: number;
  gasEstimated?: number;
  transactionId?: string;
}

/**
 * Real-time update event from the execution stream
 */
export interface TaskExecutionEvent {
  id: string;
  type: 'status_change' | 'log_entry' | 'progress_update' | 'error' | 'completed';
  taskId: string;
  timestamp: string;
  payload: 
    | StatusChangePayload
    | LogEntryPayload
    | ProgressUpdatePayload
    | ErrorPayload
    | CompletionPayload;
}

export interface StatusChangePayload {
  oldStatus: ExecutionStatus;
  newStatus: ExecutionStatus;
  phase?: string;
}

export interface LogEntryPayload extends ExecutionLogEntry {}

export interface ProgressUpdatePayload {
  current: number;
  total: number;
  percentage?: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  stack?: string;
}

export interface CompletionPayload {
  status: 'success' | 'failed';
  gasUsed: number;
  transactionId?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Connection state for the execution stream
 */
export type StreamConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Options for subscribing to task execution events
 */
export interface SubscriptionOptions {
  taskId: string;
  startFrom?: 'beginning' | 'latest' | Date;
  maxLogBufferSize?: number;
  reconnectOnError?: boolean;
}
