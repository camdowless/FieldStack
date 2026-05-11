/**
 * Structured Logger Module
 *
 * Zero-dependency structured logger that wraps console.* to emit single-line
 * JSON compatible with Google Cloud Logging. Supports child loggers with
 * pre-bound context, log-level filtering, and error stack trace extraction.
 *
 * @module logger
 */

import * as crypto from "crypto";

// Log levels ordered by severity
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

// The structured log entry written to stdout/stderr
export interface LogEntry {
  severity: LogLevel;
  message: string;
  timestamp: string;
  function_name?: string;
  correlation_id?: string;
  context?: Record<string, unknown>;
  stack_trace?: string;
}

// Logger configuration (resolved once at module load)
export interface LoggerConfig {
  minLevel: LogLevel;
}

// Public API
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string | Error, context?: Record<string, unknown>): void;
  critical(message: string | Error, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

// Numeric ordering for log levels
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
};

/**
 * Resolve the minimum log level from environment variables.
 * Defaults to INFO in production, DEBUG in development.
 */
function resolveMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();
  if (envLevel) {
    if (envLevel in LOG_LEVEL_ORDER) {
      return envLevel as LogLevel;
    }
    // Unrecognized value — warn and default to INFO
    const warnLine = JSON.stringify({
      severity: "WARNING",
      message: `Invalid LOG_LEVEL "${process.env.LOG_LEVEL}" — defaulting to INFO`,
      timestamp: new Date().toISOString(),
    });
    if (IS_TEST) {
      console.warn(warnLine);
    } else {
      process.stderr.write(warnLine + "\n");
    }
    return "INFO";
  }
  const nodeEnv = process.env.NODE_ENV || "";
  const isProduction =
    nodeEnv === "production" || process.env.K_SERVICE !== undefined;
  return isProduction ? "INFO" : "DEBUG";
}

/**
 * Write a log line to the appropriate stream.
 *
 * Cloud Functions Gen 1 captures console.* as textPayload (unparsed string).
 * Writing directly to process.stdout/stderr causes Cloud Logging to parse the
 * JSON and store it as jsonPayload, making all fields filterable in Log Explorer.
 *
 * ERROR and CRITICAL go to stderr so they appear as errors in the GCP console.
 * Everything else goes to stdout.
 *
 * In test environments (NODE_ENV=test or VITEST=true), we fall back to console.*
 * so that vi.spyOn(console, ...) continues to work in tests.
 */
const IS_TEST = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

function writeLog(level: LogLevel, line: string): void {
  if (IS_TEST) {
    // Use console.* in tests so vi.spyOn works
    switch (level) {
      case "DEBUG":
      case "INFO":
        console.info(line);
        break;
      case "WARNING":
        console.warn(line);
        break;
      case "ERROR":
      case "CRITICAL":
        console.error(line);
        break;
    }
    return;
  }
  // Production / Cloud Functions: write directly to streams so Cloud Logging
  // parses the JSON into jsonPayload (filterable fields in Log Explorer).
  switch (level) {
    case "ERROR":
    case "CRITICAL":
      process.stderr.write(line + "\n");
      break;
    default:
      process.stdout.write(line + "\n");
      break;
  }
}

/** Pattern to detect email-like strings */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pattern to detect secret-like keys */
const SECRET_KEY_PATTERN = /key|secret|token|password/i;

/**
 * Redact sensitive data from a context object.
 * Returns a shallow copy — never mutates the caller's object.
 *
 * Rules (applied in order to each key-value pair):
 * 1. If key matches secret pattern → value becomes "[REDACTED]"
 * 2. If key is "uid" (case-insensitive) and value is string → truncate to first 8 chars + "…"
 * 3. If value is a string matching email pattern → mask to first 2 chars + "***@domain"
 */
export function redact(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);

  for (const [key, value] of Object.entries(context)) {
    // Rule 1: Secret-pattern keys
    if (SECRET_KEY_PATTERN.test(key)) {
      Object.defineProperty(result, key, { value: "[REDACTED]", writable: true, enumerable: true, configurable: true });
      continue;
    }

    // Rule 2: UID truncation
    if (key.toLowerCase() === "uid" && typeof value === "string") {
      const truncated = value.length > 8 ? value.slice(0, 8) + "…" : value + "…";
      Object.defineProperty(result, key, { value: truncated, writable: true, enumerable: true, configurable: true });
      continue;
    }

    // Rule 3: Email masking
    if (typeof value === "string" && EMAIL_PATTERN.test(value)) {
      const atIndex = value.indexOf("@");
      const localPart = value.slice(0, atIndex);
      const domain = value.slice(atIndex + 1);
      const masked = localPart.slice(0, 2) + "***@" + domain;
      Object.defineProperty(result, key, { value: masked, writable: true, enumerable: true, configurable: true });
      continue;
    }

    // No redaction needed
    Object.defineProperty(result, key, { value, writable: true, enumerable: true, configurable: true });
  }

  return result;
}

/**
 * Safely serialize a log entry to JSON. Falls back to a minimal entry
 * if serialization fails (e.g., circular references).
 */
function safeSerialize(entry: LogEntry): string {
  try {
    return JSON.stringify(entry);
  } catch {
    const fallback: LogEntry = {
      severity: entry.severity,
      message: "LOG_SERIALIZATION_FAILED",
      timestamp: entry.timestamp,
      context: { original_message: entry.message },
    };
    return JSON.stringify(fallback);
  }
}

/**
 * Create a structured logger instance.
 *
 * @param config - Logger configuration (min level). Defaults to env-based resolution.
 * @param parentBindings - Pre-bound context fields from a parent logger.
 */
export function createLogger(
  config?: Partial<LoggerConfig>,
  parentBindings?: Record<string, unknown>
): Logger {
  const minLevel: LogLevel = config?.minLevel ?? resolveMinLevel();
  const bindings: Record<string, unknown> = parentBindings ?? {};

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[minLevel];
  }

  function emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    stackTrace?: string
  ): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      severity: level,
      message,
      timestamp: new Date().toISOString(),
    };

    // Include function_name and correlation_id from bindings at top level
    if (bindings.function_name !== undefined) {
      entry.function_name = String(bindings.function_name);
    }
    if (bindings.correlation_id !== undefined) {
      entry.correlation_id = String(bindings.correlation_id);
    }

    // Merge bindings and per-call context (per-call wins on conflict)
    const mergedContext = { ...bindings, ...context };
    // Remove top-level fields that are already on the entry
    delete mergedContext.function_name;
    delete mergedContext.correlation_id;

    if (Object.keys(mergedContext).length > 0) {
      entry.context = redact(mergedContext);
    }

    if (stackTrace) {
      entry.stack_trace = stackTrace;
    }

    const output = safeSerialize(entry);
    writeLog(level, output);
  }

  function handleErrorInput(
    level: LogLevel,
    messageOrError: string | Error,
    context?: Record<string, unknown>
  ): void {
    // Force minimum severity to ERROR when an Error object is passed
    let effectiveLevel = level;
    if (messageOrError instanceof Error) {
      if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER["ERROR"]) {
        effectiveLevel = "ERROR";
      }
      const err = messageOrError;
      emit(effectiveLevel, err.message, context, err.stack);
    } else {
      emit(effectiveLevel, messageOrError, context);
    }
  }

  const logger: Logger = {
    debug(message: string, context?: Record<string, unknown>): void {
      emit("DEBUG", message, context);
    },
    info(message: string, context?: Record<string, unknown>): void {
      emit("INFO", message, context);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      emit("WARNING", message, context);
    },
    error(
      messageOrError: string | Error,
      context?: Record<string, unknown>
    ): void {
      handleErrorInput("ERROR", messageOrError, context);
    },
    critical(
      messageOrError: string | Error,
      context?: Record<string, unknown>
    ): void {
      handleErrorInput("CRITICAL", messageOrError, context);
    },
    child(childBindings: Record<string, unknown>): Logger {
      // Merge parent bindings with child bindings (child wins on conflict)
      const merged = { ...bindings, ...childBindings };
      return createLogger({ minLevel }, merged);
    },
  };

  return logger;
}

/**
 * Create a request-scoped logger with a correlation ID.
 * Uses X-Request-ID header if present, otherwise generates a new UUID.
 */
export function createRequestLogger(
  functionName: string,
  requestHeaders?: Record<string, string | string[] | undefined>
): Logger {
  const headerValue = requestHeaders?.["x-request-id"];
  const correlationId =
    (typeof headerValue === "string" ? headerValue : undefined) ||
    crypto.randomUUID();
  return createLogger(undefined, {
    function_name: functionName,
    correlation_id: correlationId,
  });
}

// Singleton root logger instance
export const logger: Logger = createLogger();
