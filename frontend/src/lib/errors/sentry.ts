/**
 * Sentry Utility Functions
 *
 * This module provides wrapper functions for Sentry operations,
 * with built-in privacy filters and conditional enabling.
 *
 * Note: Sentry is initialized via sentry.client.config.ts and sentry.edge.config.ts.
 * This file only provides helper utilities that assume Sentry is already initialized.
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isEnabled = Boolean(SENTRY_DSN);

/**
 * Filter sensitive data from Sentry events
 */
function filterSensitiveData(event: Sentry.Event): Sentry.Event {
  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "authorization",
    "cookie",
    "x-csrf-token",
    "x-xsrf-token",
    "credit_card",
    "cvv",
    "ssn",
    "social_security",
  ];

  if (event.request?.headers_fields) {
    Object.keys(event.request.headers_fields).forEach((key) => {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        event.request.headers_fields[key] = "[Filtered]";
      }
    });
  }

  if (event.extra) {
    Object.keys(event.extra).forEach((key) => {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        event.extra[key] = "[Filtered]";
      }
    });
  }

  if (event.user) {
    const { ip, email, username, ...safeUser } = event.user;
    event.user = safeUser;
  }

  return event;
}

/**
 * Set user context for Sentry
 */
export function setSentryUser(user: { id: string; walletAddress?: string; role?: string }) {
  if (!isEnabled) return;
  Sentry.setUser({
    id: user.id,
    ...(user.walletAddress && {
      wallet_address: user.walletAddress.slice(0, 10) + "...",
    }),
    ...(user.role && { role: user.role }),
  });
}

/**
 * Clear user context on logout
 */
export function clearSentryUser() {
  if (!isEnabled) return;
  Sentry.setUser(null);
}

/**
 * Add breadcrumb with flexible options
 */
export function addSentryBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: "info" | "warning" | "error" | "fatal" = "info"
) {
  if (!isEnabled) return;
  Sentry.addBreadcrumb({
    category,
    message,
    level,
    data,
    timestamp: new Date(),
  });
}

/**
 * Capture message manually
 */
export function captureSentryMessage(
  message: string,
  context?: Record<string, unknown>,
  level: "info" | "warning" | "error" | "fatal" = "info"
) {
  if (!isEnabled) return;
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Capture exception with extra context
 */
export function captureSentryException(
  error: Error,
  context?: Record<string, unknown>
) {
  if (!isEnabled) return;
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Set global context that applies to all events
 */
export function setSentryContext(key: string, context: Record<string, unknown>) {
  if (!isEnabled) return;
  Sentry.setContext(key, context);
}

export function setContext(key: string, context: Record<string, unknown>) {
  if (!isEnabled) return;
  Sentry.setContext(key, context);
}

export default Sentry;
