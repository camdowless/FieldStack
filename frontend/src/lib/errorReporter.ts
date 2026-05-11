/**
 * Frontend Error Reporter
 *
 * Captures unhandled exceptions and promise rejections, builds structured
 * error reports, and transmits them to a backend Cloud Function endpoint.
 *
 * Key behaviors:
 * - Registers window 'error' and 'unhandledrejection' listeners
 * - Deduplicates identical errors within a 60-second window
 * - Sends reports via navigator.sendBeacon with fetch as fallback
 * - Never throws — fails silently on network errors
 */

export interface ErrorReport {
  message: string;
  stack: string | null;
  url: string;
  userAgent: string;
  timestamp: string; // ISO 8601
  uid?: string; // first 8 chars only
}

export interface ErrorReporterConfig {
  endpoint: string; // URL of reportFrontendError Cloud Function
  getUid: () => string | null; // returns current user UID or null
}

// Deduplication map: key = message + stack, value = timestamp (ms)
const dedupMap = new Map<string, number>();
const DEDUP_TTL_MS = 60_000; // 60 seconds
const DEDUP_MAX_SIZE = 100;

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Evicts expired entries from the dedup map.
 * Also enforces the max size cap by evicting oldest entries first.
 */
function cleanupDedupMap(): void {
  const now = Date.now();
  for (const [key, timestamp] of dedupMap) {
    if (now - timestamp >= DEDUP_TTL_MS) {
      dedupMap.delete(key);
    }
  }
  // Cap at max size — evict oldest first
  if (dedupMap.size > DEDUP_MAX_SIZE) {
    const entries = [...dedupMap.entries()].sort((a, b) => a[1] - b[1]);
    const toEvict = entries.slice(0, dedupMap.size - DEDUP_MAX_SIZE);
    for (const [key] of toEvict) {
      dedupMap.delete(key);
    }
  }
}

/**
 * Returns true if this error should be reported (not a duplicate).
 * Returns false if it was already reported within the TTL window.
 */
function shouldReport(message: string, stack: string | null): boolean {
  const key = `${message}${stack ?? ""}`;
  const now = Date.now();
  const lastReported = dedupMap.get(key);

  if (lastReported !== undefined && now - lastReported < DEDUP_TTL_MS) {
    return false;
  }

  // Enforce max size before adding — evict oldest if at capacity
  if (dedupMap.size >= DEDUP_MAX_SIZE && !dedupMap.has(key)) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, t] of dedupMap) {
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) {
      dedupMap.delete(oldestKey);
    }
  }

  dedupMap.set(key, now);
  return true;
}

/**
 * Builds an ErrorReport payload from an error.
 */
export function buildReport(
  message: string,
  stack: string | null,
  getUid: () => string | null
): ErrorReport {
  const report: ErrorReport = {
    message,
    stack,
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent:
      typeof navigator !== "undefined" ? navigator.userAgent : "",
    timestamp: new Date().toISOString(),
  };

  const uid = getUid();
  if (uid) {
    report.uid = uid.substring(0, 8);
  }

  return report;
}

/**
 * Sends the report payload to the endpoint.
 * Uses navigator.sendBeacon first (survives page unload), falls back to fetch.
 * Never throws.
 */
function sendReport(endpoint: string, report: ErrorReport): void {
  try {
    const payload = JSON.stringify(report);

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      const sent = navigator.sendBeacon(endpoint, blob);
      if (sent) return;
    }

    // Fallback to fetch (fire-and-forget)
    if (typeof fetch !== "undefined") {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // Fail silently
      });
    }
  } catch {
    // Fail silently — never throw from the error reporter
  }
}

/**
 * Reports an error manually. Can be called from ErrorBoundary's componentDidCatch.
 * Requires initErrorReporter to have been called first.
 */
let reporterConfig: ErrorReporterConfig | null = null;

export function reportError(error: Error | string, stack?: string | null): void {
  if (!reporterConfig) return;

  const message = typeof error === "string" ? error : error.message || "Unknown error";
  const errorStack =
    stack !== undefined
      ? stack
      : typeof error === "object" && error !== null
        ? (error as Error).stack ?? null
        : null;

  if (!shouldReport(message, errorStack)) return;

  const report = buildReport(message, errorStack, reporterConfig.getUid);
  sendReport(reporterConfig.endpoint, report);
}

/**
 * Initializes the error reporter by registering global event listeners.
 * Should be called once during app initialization.
 */
export function initErrorReporter(config: ErrorReporterConfig): void {
  reporterConfig = config;

  // Register global error handler
  window.addEventListener("error", (event: ErrorEvent) => {
    const message = event.message || "Unknown error";
    const stack = event.error?.stack ?? null;

    if (!shouldReport(message, stack)) return;

    const report = buildReport(message, stack, config.getUid);
    sendReport(config.endpoint, report);
  });

  // Register unhandled promise rejection handler
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let message: string;
      let stack: string | null = null;

      if (reason instanceof Error) {
        message = reason.message || "Unhandled promise rejection";
        stack = reason.stack ?? null;
      } else if (typeof reason === "string") {
        message = reason;
      } else {
        message = "Unhandled promise rejection";
      }

      if (!shouldReport(message, stack)) return;

      const report = buildReport(message, stack, config.getUid);
      sendReport(config.endpoint, report);
    }
  );

  // Start periodic cleanup of the dedup map
  if (cleanupTimer === null) {
    cleanupTimer = setTimeout(function tick() {
      cleanupDedupMap();
      cleanupTimer = setTimeout(tick, DEDUP_TTL_MS);
    }, DEDUP_TTL_MS);
  }
}

// Export internals for testing
export const _internals = {
  dedupMap,
  shouldReport,
  cleanupDedupMap,
  sendReport,
  DEDUP_TTL_MS,
  DEDUP_MAX_SIZE,
};
