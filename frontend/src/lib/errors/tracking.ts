/**
 * Error Tracking Client
 *
 * Provides client-side error tracking, breadcrumbs, and user context.
 * Integrates with Sentry for comprehensive error monitoring.
 */

import * as Sentry from "@/src/lib/errors/sentry";

/**
 * Initialize error tracking with user context
 * Call this when user logs in
 */
export function initializeErrorTracking(userData: {
  id: string;
  walletAddress?: string;
  role?: string;
}) {
  Sentry.setSentryUser({
    id: userData.id,
    walletAddress: userData.walletAddress,
    role: userData.role,
  });

  // Add initial breadcrumb
  Sentry.addSentryBreadcrumb("auth", "User logged in", {
    userId: userData.id,
    role: userData.role,
  });
}

/**
 * Clear user context on logout
 */
export function clearErrorTracking() {
  Sentry.clearSentryUser();
  Sentry.addSentryBreadcrumb("auth", "User logged out");
}

/**
 * Add navigation breadcrumb
 */
export function trackNavigation(to: string, from?: string) {
  Sentry.addSentryBreadcrumb("navigation", `Navigated to ${to}`, {
    to,
    from,
  });
}

/**
 * Add API request breadcrumb
 */
export function trackApiRequest(
  url: string,
  method: string = "GET",
  statusCode?: number
) {
  const level = statusCode && statusCode >= 400 ? "warning" : "info";

  Sentry.addSentryBreadcrumb(
    "http",
    `${method} ${url}${statusCode ? ` (${statusCode})` : ""}`,
    {
      url,
      method,
      statusCode,
    },
    level
  );
}

/**
 * Clear user context on logout
 */
export function clearErrorTracking() {
  Sentry.clearSentryUser();
  Sentry.addSentryBreadcrumb({
    category: "auth",
    message: "User logged out",
  });
}

/**
 * Add navigation breadcrumb
 */
export function trackNavigation(to: string, from?: string) {
  Sentry.addSentryBreadcrumb({
    category: "navigation",
    message: `Navigated to ${to}`,
    data: { to, from },
  });
}

/**
 * Add API request breadcrumb
 */
export function trackApiRequest(
  url: string,
  method: string = "GET",
  statusCode?: number
) {
  const level = statusCode && statusCode >= 400 ? "warning" : "info";

  Sentry.addSentryBreadcrumb({
    category: "http",
    message: `${method} ${url}${statusCode ? ` (${statusCode})` : ""}`,
    data: {
      url,
      method,
      statusCode,
    },
    level,
  });
}

/**
 * Add API error breadcrumb with error details
 */
export function trackApiError(
  url: string,
  method: string,
  error: Error,
  response?: Response
) {
  Sentry.addSentryBreadcrumb(
    "http",
    `API error: ${method} ${url}`,
    {
      url,
      method,
      errorMessage: error.message,
      statusCode: response?.status,
    },
    "error"
  );

  // Capture exception with API context
  Sentry.captureSentryException(error, {
    tags: {
      type: "api_error",
      endpoint: url,
      method,
    },
    extra: {
      url,
      method,
      statusCode: response?.status,
      statusText: response?.statusText,
    },
  });
}

/**
 * Add wallet interaction breadcrumb
 */
export function trackWalletAction(action: string, details?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb("wallet", `Wallet action: ${action}`, details);
}

/**
 * Track wallet connection errors specifically
 */
export function trackWalletError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb(
    "wallet",
    `Wallet error: ${error.message}`,
    context,
    "error"
  );

  Sentry.captureSentryException(error, {
    tags: {
      type: "wallet_error",
    },
    extra: context,
  });
}

/**
 * Add user interaction breadcrumb
 */
export function trackUserAction(
  action: string,
  element: string,
  details?: Record<string, unknown>
) {
  Sentry.addSentryBreadcrumb("ui.action", `User clicked: ${action}`, {
    element,
    ...details,
  });
}

/**
 * Add performance breadcrumb
 */
export function trackPerformance(metric: string, value: number, unit: string = "ms") {
  Sentry.addSentryBreadcrumb("performance", `Performance: ${metric}`, {
    value,
    unit,
  });
}

/**
 * Add socket event breadcrumb
 */
export function trackSocketEvent(
  event: string,
  direction: "sent" | "received" | "subscribed",
  extraData?: Record<string, unknown>
) {
  Sentry.addSentryBreadcrumb("socket", `Socket ${direction}: ${event}`, {
    direction,
    event,
    ...extraData,
  });
}

/**
 * Track socket connection errors
 */
export function trackSocketError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb(
    "socket",
    `Socket error: ${error.message}`,
    context,
    "error"
  );

  Sentry.captureSentryException(error, {
    tags: {
      type: "socket_error",
    },
    extra: context,
  });
}

/**
 * Add wallet interaction breadcrumb
 */
export function trackWalletAction(action: string, details?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb({
    category: "wallet",
    message: `Wallet action: ${action}`,
    data: details,
  });
}

/**
 * Track wallet connection errors specifically
 */
export function trackWalletError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb({
    category: "wallet",
    message: `Wallet error: ${error.message}`,
    level: "error",
    data: context,
  });

  Sentry.captureSentryException(error, {
    tags: {
      type: "wallet_error",
    },
    extra: context,
  });
}

/**
 * Add user interaction breadcrumb
 */
export function trackUserAction(
  action: string,
  element: string,
  details?: Record<string, unknown>
) {
  Sentry.addSentryBreadcrumb({
    category: "ui.action",
    message: `User clicked: ${action}`,
    data: {
      element,
      ...details,
    },
  });
}

/**
 * Add performance breadcrumb
 */
export function trackPerformance(metric: string, value: number, unit: string = "ms") {
  Sentry.addSentryBreadcrumb({
    category: "performance",
    message: `Performance: ${metric}`,
    data: { value, unit },
  });
}

/**
 * Add socket event breadcrumb
 */
export function trackSocketEvent(event: string, direction: "sent" | "received") {
  Sentry.addSentryBreadcrumb({
    category: "socket",
    message: `Socket ${direction}: ${event}`,
    data: { direction, event },
  });
}

/**
 * Track socket connection errors
 */
export function trackSocketError(error: Error, context?: Record<string, unknown>) {
  Sentry.addSentryBreadcrumb({
    category: "socket",
    message: `Socket error: ${error.message}`,
    level: "error",
    data: context,
  });

  Sentry.captureSentryException(error, {
    tags: {
      type: "socket_error",
    },
    extra: context,
  });
}

/**
 * Set task/workspace context for errors
 */
export function setTaskContext(taskId: string | number, taskData?: Record<string, unknown>) {
  Sentry.setSentryContext("task", {
    taskId,
    ...taskData,
  });
}

/**
 * Clear task context
 */
export function clearTaskContext() {
  Sentry.setContext("task", {});
}

/**
 * Set global context for the current session
 */
export function setGlobalContext(context: Record<string, unknown>) {
  Sentry.setSentryContext("session", context);
}

/**
 * Custom error wrapper that automatically reports to Sentry
 */
export class TrackedError extends Error {
  constructor(
    message: string,
    public code?: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TrackedError";

    // Immediately report to Sentry
    Sentry.captureSentryException(this, {
      tags: {
        code: code || "unknown",
      },
      extra: context,
    });
  }
}

/**
 * Safe wrapper for async operations that automatically track errors
 */
export async function trackAsync<T>(
  fn: () => Promise<T>,
  context?: {
    operation: string;
    taskId?: string | number;
    userId?: string;
  }
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();

    // Track performance
    const duration = Date.now() - startTime;
    if (duration > 1000) {
      // Only track slow operations (>1s)
      trackPerformance(context?.operation || "async_operation", duration);
    }

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    Sentry.captureSentryException(err, {
      tags: {
        operation: context?.operation || "unknown",
        ...(context?.taskId && { taskId: String(context.taskId) }),
      },
      extra: {
        ...context,
        duration: Date.now() - startTime,
      },
    });

    throw err;
  }
}

/**
 * Safe wrapper for sync operations
 */
export function trackSync<T>(
  fn: () => T,
  context?: { operation: string; taskId?: string | number }
): T {
  const startTime = Date.now();

  try {
    const result = fn();
    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    Sentry.captureSentryException(err, {
      tags: {
        operation: context?.operation || "unknown",
        ...(context?.taskId && { taskId: String(context.taskId) }),
      },
      extra: {
        ...context,
        duration: Date.now() - startTime,
      },
    });

    throw err;
  }
}

export function captureSentryException(error: Error, context?: Record<string, unknown>) {
  Sentry.captureSentryException(error, context);
}
