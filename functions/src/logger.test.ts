import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import { createLogger, createRequestLogger, LogLevel, LogEntry, Logger, redact } from "./logger";

/**
 * Helper: Capture console output from a logger call.
 * Returns the parsed LogEntry from the console method output.
 */
function captureLogOutput(fn: (logger: Logger) => void): LogEntry | null {
  let captured: string | null = null;

  const spyInfo = vi.spyOn(console, "info").mockImplementation((msg) => {
    captured = msg;
  });
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((msg) => {
    captured = msg;
  });
  const spyError = vi.spyOn(console, "error").mockImplementation((msg) => {
    captured = msg;
  });

  const logger = createLogger({ minLevel: "DEBUG" });
  fn(logger);

  spyInfo.mockRestore();
  spyWarn.mockRestore();
  spyError.mockRestore();

  if (captured === null) return null;
  return JSON.parse(captured) as LogEntry;
}

/**
 * Helper: Capture output from a specific logger instance.
 */
function captureFromLogger(
  logger: Logger,
  fn: (logger: Logger) => void
): LogEntry | null {
  let captured: string | null = null;

  const spyInfo = vi.spyOn(console, "info").mockImplementation((msg) => {
    captured = msg;
  });
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((msg) => {
    captured = msg;
  });
  const spyError = vi.spyOn(console, "error").mockImplementation((msg) => {
    captured = msg;
  });

  fn(logger);

  spyInfo.mockRestore();
  spyWarn.mockRestore();
  spyError.mockRestore();

  if (captured === null) return null;
  return JSON.parse(captured) as LogEntry;
}

describe("Logger - Unit Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a valid JSON log entry with required fields", () => {
    const entry = captureLogOutput((logger) => logger.info("hello world"));
    expect(entry).not.toBeNull();
    expect(entry!.severity).toBe("INFO");
    expect(entry!.message).toBe("hello world");
    expect(entry!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("maps log levels to correct severity strings", () => {
    const levels: Array<{
      method: keyof Logger;
      expected: LogLevel;
    }> = [
      { method: "debug", expected: "DEBUG" },
      { method: "info", expected: "INFO" },
      { method: "warn", expected: "WARNING" },
      { method: "error", expected: "ERROR" },
      { method: "critical", expected: "CRITICAL" },
    ];

    for (const { method, expected } of levels) {
      const entry = captureLogOutput((logger) => {
        (logger[method] as (msg: string) => void)("test");
      });
      expect(entry!.severity).toBe(expected);
    }
  });

  it("includes context object when provided", () => {
    const entry = captureLogOutput((logger) =>
      logger.info("with context", { userId: "abc", action: "login" })
    );
    expect(entry!.context).toEqual({ userId: "abc", action: "login" });
  });

  it("omits context field when no context is provided", () => {
    const entry = captureLogOutput((logger) => logger.info("no context"));
    expect(entry!.context).toBeUndefined();
  });

  it("uses console.info for DEBUG and INFO levels", () => {
    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ minLevel: "DEBUG" });

    logger.debug("debug msg");
    logger.info("info msg");

    expect(spyInfo).toHaveBeenCalledTimes(2);
    spyInfo.mockRestore();
  });

  it("uses console.warn for WARNING level", () => {
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger({ minLevel: "DEBUG" });

    logger.warn("warn msg");

    expect(spyWarn).toHaveBeenCalledTimes(1);
    spyWarn.mockRestore();
  });

  it("uses console.error for ERROR and CRITICAL levels", () => {
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger({ minLevel: "DEBUG" });

    logger.error("error msg");
    logger.critical("critical msg");

    expect(spyError).toHaveBeenCalledTimes(2);
    spyError.mockRestore();
  });

  it("suppresses log entries below minimum level", () => {
    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ minLevel: "WARNING" });

    logger.debug("should not appear");
    logger.info("should not appear");

    expect(spyInfo).not.toHaveBeenCalled();
    spyInfo.mockRestore();
  });

  it("child logger includes function_name and correlation_id at top level", () => {
    const logger = createLogger({ minLevel: "DEBUG" });
    const child = logger.child({
      function_name: "myFunction",
      correlation_id: "req-123",
    });

    const entry = captureFromLogger(child, (l) => l.info("child log"));
    expect(entry!.function_name).toBe("myFunction");
    expect(entry!.correlation_id).toBe("req-123");
  });

  it("child logger merges bindings with per-call context (per-call wins)", () => {
    const logger = createLogger({ minLevel: "DEBUG" });
    const child = logger.child({ env: "prod", region: "us-east" });

    const entry = captureFromLogger(child, (l) =>
      l.info("merged", { region: "eu-west", extra: true })
    );
    expect(entry!.context).toEqual({
      env: "prod",
      region: "eu-west",
      extra: true,
    });
  });

  it("handles serialization failure gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger({ minLevel: "DEBUG" });

    // Should not throw
    expect(() => logger.info("circular ref", circular)).not.toThrow();

    const output = spyInfo.mock.calls[0][0] as string;
    const entry = JSON.parse(output) as LogEntry;
    expect(entry.message).toBe("LOG_SERIALIZATION_FAILED");
    expect(entry.context?.original_message).toBe("circular ref");

    spyInfo.mockRestore();
  });
});

describe("Logger - Property Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 1: Valid structured log entry
   *
   * For any message string and any context object, calling any logger method
   * produces output that is valid single-line JSON containing at minimum the
   * fields `severity`, `message`, and `timestamp`, and if context is provided,
   * a `context` object.
   *
   * **Validates: Requirements 1.1, 1.2, 1.4**
   */
  it("Property 1: any message and context produces valid structured JSON with required fields", () => {
    const methods: Array<keyof Logger> = [
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ];

    fc.assert(
      fc.property(
        fc.constantFrom(...methods),
        fc.string({ minLength: 1 }),
        fc.option(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }).filter(
              (k) => k !== "function_name" && k !== "correlation_id"
            ),
            fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
          ),
          { nil: undefined }
        ),
        (method, message, context) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation((msg) => {
              captured = msg;
            });

          const logger = createLogger({ minLevel: "DEBUG" });
          (logger[method] as (msg: string, ctx?: Record<string, unknown>) => void)(
            message,
            context
          );

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          // Must have captured output
          expect(captured).not.toBeNull();

          // Must be valid JSON
          const entry = JSON.parse(captured!) as LogEntry;

          // Must be single-line (no newlines in the serialized output)
          expect(captured!).not.toContain("\n");

          // Required fields
          expect(entry.severity).toBeDefined();
          expect(
            ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"].includes(
              entry.severity
            )
          ).toBe(true);
          expect(entry.message).toBe(message);
          expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

          // Context present when provided
          if (context !== undefined && Object.keys(context).length > 0) {
            expect(entry.context).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Child logger field propagation
   *
   * For any set of key-value bindings passed to child(), all log entries
   * produced by that child logger include those bindings in the output,
   * merged with any per-call context.
   *
   * **Validates: Requirements 2.1, 2.2, 7.2**
   */
  it("Property 2: child logger propagates all bindings to output", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 15 }).filter(
            (k) =>
              k !== "function_name" &&
              k !== "correlation_id" &&
              !/key|secret|token|password/i.test(k) &&
              k.toLowerCase() !== "uid"
          ),
          fc.oneof(
            fc.string().filter((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
            fc.integer(),
            fc.boolean()
          ),
          { minKeys: 1, maxKeys: 5 }
        ),
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 15 }).filter(
            (k) =>
              k !== "function_name" &&
              k !== "correlation_id" &&
              !/key|secret|token|password/i.test(k) &&
              k.toLowerCase() !== "uid"
          ),
          fc.oneof(
            fc.string().filter((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
            fc.integer(),
            fc.boolean()
          ),
          { minKeys: 0, maxKeys: 3 }
        ),
        (childBindings, callContext) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          const child = logger.child(childBindings);
          child.info("test", callContext);

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // All child bindings should appear in context (unless overridden by call context)
          const expectedContext = { ...childBindings, ...callContext };
          if (Object.keys(expectedContext).length > 0) {
            expect(entry.context).toBeDefined();
            for (const [key, value] of Object.entries(expectedContext)) {
              expect(entry.context![key]).toEqual(value);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 2b: per-call context wins over child bindings on conflict", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          (k) =>
            k !== "function_name" &&
            k !== "correlation_id" &&
            !/key|secret|token|password/i.test(k) &&
            k.toLowerCase() !== "uid"
        ),
        fc.string({ minLength: 1 }).filter((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
        fc.string({ minLength: 1 }).filter((v) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
        (key, childValue, callValue) => {
          fc.pre(childValue !== callValue);

          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          const child = logger.child({ [key]: childValue });
          child.info("conflict test", { [key]: callValue });

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          const entry = JSON.parse(captured!) as LogEntry;
          expect(entry.context![key]).toBe(callValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Logger - Error Handling Unit Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("error() with string message does NOT include stack_trace", () => {
    const entry = captureLogOutput((logger) => logger.error("simple error message"));
    expect(entry).not.toBeNull();
    expect(entry!.severity).toBe("ERROR");
    expect(entry!.message).toBe("simple error message");
    expect(entry!.stack_trace).toBeUndefined();
  });

  it("error() with Error object includes stack_trace", () => {
    const err = new Error("something broke");
    const entry = captureLogOutput((logger) => logger.error(err));
    expect(entry).not.toBeNull();
    expect(entry!.severity).toBe("ERROR");
    expect(entry!.message).toBe("something broke");
    expect(entry!.stack_trace).toBe(err.stack);
  });

  it("critical() with Error still uses CRITICAL severity (not downgraded to ERROR)", () => {
    const err = new Error("fatal failure");
    const entry = captureLogOutput((logger) => logger.critical(err));
    expect(entry).not.toBeNull();
    expect(entry!.severity).toBe("CRITICAL");
    expect(entry!.message).toBe("fatal failure");
    expect(entry!.stack_trace).toBe(err.stack);
  });

  it("Error without stack property sets stack_trace to undefined", () => {
    const err = new Error("no stack");
    // Manually remove the stack property
    delete (err as { stack?: string }).stack;

    const entry = captureLogOutput((logger) => logger.error(err));
    expect(entry).not.toBeNull();
    expect(entry!.severity).toBe("ERROR");
    expect(entry!.message).toBe("no stack");
    expect(entry!.stack_trace).toBeUndefined();
  });

  it("error() with Error includes correlation_id and function_name from child logger", () => {
    const logger = createLogger({ minLevel: "DEBUG" });
    const child = logger.child({
      function_name: "processPayment",
      correlation_id: "req-abc-123",
    });

    const err = new Error("payment failed");
    const entry = captureFromLogger(child, (l) =>
      l.error(err, { httpMethod: "POST", path: "/pay" })
    );

    expect(entry).not.toBeNull();
    expect(entry!.function_name).toBe("processPayment");
    expect(entry!.correlation_id).toBe("req-abc-123");
    expect(entry!.stack_trace).toBe(err.stack);
    expect(entry!.context).toEqual({ httpMethod: "POST", path: "/pay" });
  });
});

describe("Logger - Property 6: Error entries include stack trace", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 6: Error entries include stack trace
   *
   * For any Error object passed to error() or critical(), the resulting log entry
   * SHALL contain a stack_trace field equal to the Error's stack property,
   * and the severity SHALL be at least ERROR.
   *
   * **Validates: Requirements 5.1, 5.2**
   */
  it("Property 6: Error objects produce entries with stack_trace matching Error.stack and severity >= ERROR", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("error" as const, "critical" as const),
        fc.string({ minLength: 1, maxLength: 200 }),
        (method, errorMessage) => {
          const err = new Error(errorMessage);

          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation(() => {});
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation((msg) => {
              captured = msg;
            });

          const logger = createLogger({ minLevel: "DEBUG" });
          (logger[method] as (msg: Error) => void)(err);

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          // Must have captured output
          expect(captured).not.toBeNull();

          const entry = JSON.parse(captured!) as LogEntry;

          // stack_trace field must match the Error's stack property
          expect(entry.stack_trace).toBe(err.stack);

          // Severity must be at least ERROR (numeric 3)
          const severityOrder: Record<string, number> = {
            DEBUG: 0,
            INFO: 1,
            WARNING: 2,
            ERROR: 3,
            CRITICAL: 4,
          };
          expect(severityOrder[entry.severity]).toBeGreaterThanOrEqual(3);

          // Message should match the error message
          expect(entry.message).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Logger - createRequestLogger Unit Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("createRequestLogger uses X-Request-ID header when present", () => {
    const reqLogger = createRequestLogger("myFunction", {
      "x-request-id": "external-req-id-123",
    });

    const entry = captureFromLogger(reqLogger, (l) => l.info("test"));
    expect(entry).not.toBeNull();
    expect(entry!.correlation_id).toBe("external-req-id-123");
    expect(entry!.function_name).toBe("myFunction");
  });

  it("createRequestLogger generates UUID when no X-Request-ID header present", () => {
    const reqLogger = createRequestLogger("myFunction", {});

    const entry = captureFromLogger(reqLogger, (l) => l.info("test"));
    expect(entry).not.toBeNull();
    // Should be a valid UUID v4 format
    expect(entry!.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(entry!.function_name).toBe("myFunction");
  });

  it("createRequestLogger generates UUID when headers are undefined", () => {
    const reqLogger = createRequestLogger("myFunction");

    const entry = captureFromLogger(reqLogger, (l) => l.info("test"));
    expect(entry).not.toBeNull();
    expect(entry!.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(entry!.function_name).toBe("myFunction");
  });

  it("createRequestLogger includes function_name in output", () => {
    const reqLogger = createRequestLogger("processPayment", {
      "x-request-id": "req-456",
    });

    const entry = captureFromLogger(reqLogger, (l) =>
      l.info("processing", { amount: 100 })
    );
    expect(entry).not.toBeNull();
    expect(entry!.function_name).toBe("processPayment");
    expect(entry!.correlation_id).toBe("req-456");
    expect(entry!.context).toEqual({ amount: 100 });
  });

  it("createRequestLogger correlation_id propagates to child loggers", () => {
    const reqLogger = createRequestLogger("parentFn", {
      "x-request-id": "parent-req-id",
    });
    const child = reqLogger.child({ extra: "data" });

    const entry = captureFromLogger(child, (l) => l.info("child log"));
    expect(entry).not.toBeNull();
    expect(entry!.correlation_id).toBe("parent-req-id");
    expect(entry!.function_name).toBe("parentFn");
    expect(entry!.context).toEqual({ extra: "data" });
  });
});

describe("Logger - Property 3: External correlation ID passthrough", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 3: External correlation ID passthrough
   *
   * For any string value provided as correlation_id when creating a child logger,
   * all log entries from that child SHALL use that exact value as the correlation_id
   * field in the output.
   *
   * **Validates: Requirements 2.3**
   */
  it("Property 3: any correlation_id string passed to child logger appears exactly in all log entries", () => {
    const methods: Array<"debug" | "info" | "warn" | "error" | "critical"> = [
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ];

    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom(...methods),
        fc.string({ minLength: 1, maxLength: 100 }),
        (correlationId, method, message) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation((msg) => {
              captured = msg;
            });

          const logger = createLogger({ minLevel: "DEBUG" });
          const child = logger.child({ correlation_id: correlationId });

          (child[method] as (msg: string) => void)(message);

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // The correlation_id in the output must exactly match what was provided
          expect(entry.correlation_id).toBe(correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 3b: correlation_id from createRequestLogger propagates to all log methods", () => {
    const methods: Array<"debug" | "info" | "warn" | "error" | "critical"> = [
      "debug",
      "info",
      "warn",
      "error",
      "critical",
    ];

    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom(...methods),
        fc.string({ minLength: 1, maxLength: 100 }),
        (correlationId, method, message) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation((msg) => {
              captured = msg;
            });
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation((msg) => {
              captured = msg;
            });

          const reqLogger = createRequestLogger("testFn", {
            "x-request-id": correlationId,
          });

          (reqLogger[method] as (msg: string) => void)(message);

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // The correlation_id must exactly match the X-Request-ID header value
          expect(entry.correlation_id).toBe(correlationId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Logger - Redaction Unit Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("redact does not mutate the original object", () => {
    const original = {
      apiKey: "super-secret-key-123",
      uid: "abcdefghijklmnop",
      email: "john@example.com",
      safe: "hello",
    };
    const originalCopy = { ...original };

    redact(original);

    expect(original).toEqual(originalCopy);
  });

  it("redact handles empty context", () => {
    const result = redact({});
    expect(result).toEqual({});
  });

  it("redact handles nested objects (only shallow — nested objects are not recursively redacted)", () => {
    const context = {
      nested: { apiKey: "should-not-be-redacted", email: "inner@test.com" },
      status: "visible",
    };
    const result = redact(context);
    // Nested object is passed through as-is (shallow copy, no recursive redaction)
    expect(result.nested).toEqual({ apiKey: "should-not-be-redacted", email: "inner@test.com" });
    expect(result.status).toBe("visible");
  });

  it("email with short local part (1 char before @)", () => {
    const result = redact({ contact: "a@example.com" });
    expect(result.contact).toBe("a***@example.com");
  });

  it("redacts secret-pattern keys regardless of value type", () => {
    const result = redact({
      apiKey: "my-key",
      secretToken: 12345,
      password: true,
      accessToken: null,
    });
    expect(result.apiKey).toBe("[REDACTED]");
    expect(result.secretToken).toBe("[REDACTED]");
    expect(result.password).toBe("[REDACTED]");
    expect(result.accessToken).toBe("[REDACTED]");
  });

  it("truncates uid to first 8 chars + ellipsis", () => {
    const result = redact({ uid: "abcdefghijklmnop" });
    expect(result.uid).toBe("abcdefgh…");
  });

  it("truncates short uid (less than 8 chars) with ellipsis", () => {
    const result = redact({ uid: "abc" });
    expect(result.uid).toBe("abc…");
  });

  it("masks email values to first 2 chars + ***@domain", () => {
    const result = redact({ userEmail: "john.doe@example.com" });
    expect(result.userEmail).toBe("jo***@example.com");
  });

  it("message field is never redacted (only context)", () => {
    const sensitiveMessage = "User apiKey is abc123 and email is test@example.com";
    const entry = captureLogOutput((logger) =>
      logger.info(sensitiveMessage, { apiKey: "secret123" })
    );
    expect(entry).not.toBeNull();
    expect(entry!.message).toBe(sensitiveMessage);
    expect(entry!.context!.apiKey).toBe("[REDACTED]");
  });
});

describe("Logger - Property 5: Redaction correctness", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 5: Redaction correctness
   *
   * For any context object containing sensitive fields (emails, UIDs, secret-pattern keys),
   * the serialized log entry SHALL contain the redacted forms of those values in the
   * `context` object while the `message` field remains exactly as provided by the caller.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
   */
  it("Property 5: secret-pattern keys are always redacted to [REDACTED]", () => {
    const secretKeyPrefixes = ["apiKey", "secretToken", "password", "accessKey", "mySecret", "authToken"];

    fc.assert(
      fc.property(
        fc.constantFrom(...secretKeyPrefixes),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        fc.string({ minLength: 1, maxLength: 100 }),
        (key, value, message) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => { captured = msg; });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          logger.info(message, { [key]: value });

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // Secret key values must be redacted
          expect(entry.context![key]).toBe("[REDACTED]");
          // Message must remain unchanged
          expect(entry.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 5: uid values are truncated to 8 chars + ellipsis", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (uidValue, message) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => { captured = msg; });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          logger.info(message, { uid: uidValue });

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // UID must be truncated to first 8 chars + ellipsis
          const expected = uidValue.length > 8
            ? uidValue.slice(0, 8) + "…"
            : uidValue + "…";
          expect(entry.context!.uid).toBe(expected);
          // Message must remain unchanged
          expect(entry.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 5: email values are masked to first 2 chars + ***@domain", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !s.includes("@") && !s.includes(" ")),
        fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !s.includes("@") && !s.includes(" ") && !s.includes(".")),
        fc.string({ minLength: 2, maxLength: 5 }).filter((s) => !s.includes("@") && !s.includes(" ") && !s.includes(".")),
        fc.string({ minLength: 1, maxLength: 100 }),
        (localPart, domainName, tld, message) => {
          const email = `${localPart}@${domainName}.${tld}`;
          // Use a key that won't trigger secret pattern
          const key = "userEmail";

          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => { captured = msg; });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          logger.info(message, { [key]: email });

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // Email must be masked: first 2 chars of local part + ***@domain
          const expectedMasked = localPart.slice(0, 2) + "***@" + domainName + "." + tld;
          expect(entry.context![key]).toBe(expectedMasked);
          // Message must remain unchanged
          expect(entry.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("Property 5: message field is never modified regardless of sensitive content", () => {
    const secretKeyPrefixes = ["apiKey", "secretToken", "password"];

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.constantFrom(...secretKeyPrefixes),
        fc.string({ minLength: 1 }),
        (message, secretKey, secretValue) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => { captured = msg; });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation(() => {});
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

          const logger = createLogger({ minLevel: "DEBUG" });
          // Even if message contains sensitive-looking content, it should not be modified
          logger.info(message, { [secretKey]: secretValue });

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          expect(captured).not.toBeNull();
          const entry = JSON.parse(captured!) as LogEntry;

          // Message must be exactly as provided — never redacted
          expect(entry.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Logger - Log Level Filtering Unit Tests", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;
    delete process.env.K_SERVICE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("logs WARNING and defaults to INFO when LOG_LEVEL is unrecognized", () => {
    process.env.LOG_LEVEL = "VERBOSE";

    const warnCalls: string[] = [];
    const spyWarn = vi.spyOn(console, "warn").mockImplementation((msg) => {
      warnCalls.push(msg);
    });
    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    // Creating a logger triggers resolveMinLevel()
    const logger = createLogger();

    // Should have emitted a WARNING about invalid LOG_LEVEL
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    const warningEntry = JSON.parse(warnCalls[0]);
    expect(warningEntry.severity).toBe("WARNING");
    expect(warningEntry.message).toContain("Invalid LOG_LEVEL");
    expect(warningEntry.message).toContain("VERBOSE");

    // Should default to INFO (DEBUG messages suppressed)
    logger.debug("should be suppressed");
    logger.info("should appear");

    // console.info should have been called once (for the INFO message)
    expect(spyInfo).toHaveBeenCalledTimes(1);

    spyWarn.mockRestore();
    spyInfo.mockRestore();
  });

  it("K_SERVICE env var triggers INFO default (production mode)", () => {
    process.env.K_SERVICE = "my-cloud-function";

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG should be suppressed in production mode
    logger.debug("should be suppressed");
    expect(spyInfo).not.toHaveBeenCalled();

    // INFO should pass
    logger.info("should appear");
    expect(spyInfo).toHaveBeenCalledTimes(1);

    spyInfo.mockRestore();
    spyWarn.mockRestore();
  });

  it("NODE_ENV=production triggers INFO default", () => {
    process.env.NODE_ENV = "production";

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG should be suppressed
    logger.debug("should be suppressed");
    expect(spyInfo).not.toHaveBeenCalled();

    // INFO should pass
    logger.info("should appear");
    expect(spyInfo).toHaveBeenCalledTimes(1);

    spyInfo.mockRestore();
  });

  it("NODE_ENV=development triggers DEBUG default", () => {
    process.env.NODE_ENV = "development";

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG should pass in development mode
    logger.debug("should appear");
    expect(spyInfo).toHaveBeenCalledTimes(1);

    spyInfo.mockRestore();
  });

  it("NODE_ENV unset (no K_SERVICE) triggers DEBUG default", () => {
    // Neither NODE_ENV nor K_SERVICE set

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG should pass when not in production
    logger.debug("should appear");
    expect(spyInfo).toHaveBeenCalledTimes(1);

    spyInfo.mockRestore();
  });

  it("valid LOG_LEVEL env var is respected", () => {
    process.env.LOG_LEVEL = "WARNING";

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG and INFO should be suppressed
    logger.debug("suppressed");
    logger.info("suppressed");
    expect(spyInfo).not.toHaveBeenCalled();

    // WARNING should pass
    logger.warn("should appear");
    expect(spyWarn).toHaveBeenCalledTimes(1);

    spyInfo.mockRestore();
    spyWarn.mockRestore();
  });

  it("LOG_LEVEL is case-insensitive", () => {
    process.env.LOG_LEVEL = "warning";

    const spyInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const logger = createLogger();

    // DEBUG and INFO should be suppressed
    logger.debug("suppressed");
    logger.info("suppressed");
    expect(spyInfo).not.toHaveBeenCalled();

    // WARNING should pass
    logger.warn("should appear");
    // spyWarn may have been called for the warning about invalid level or for the actual log
    const warnCalls = spyWarn.mock.calls;
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);

    spyInfo.mockRestore();
    spyWarn.mockRestore();
  });
});

describe("Logger - Property 4: Log level filtering", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 4: Log level filtering
   *
   * For any pair of (configured minimum level, log call level), a log entry
   * SHALL be emitted if and only if the log call level is greater than or equal
   * to the configured minimum level.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it("Property 4: entry is emitted iff callLevel >= minLevel", () => {
    const allLevels: LogLevel[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];
    const levelOrder: Record<LogLevel, number> = {
      DEBUG: 0,
      INFO: 1,
      WARNING: 2,
      ERROR: 3,
      CRITICAL: 4,
    };

    // Map log levels to the logger method names
    const levelToMethod: Record<LogLevel, keyof Logger> = {
      DEBUG: "debug",
      INFO: "info",
      WARNING: "warn",
      ERROR: "error",
      CRITICAL: "critical",
    };

    fc.assert(
      fc.property(
        fc.constantFrom(...allLevels),
        fc.constantFrom(...allLevels),
        (minLevel, callLevel) => {
          let captured: string | null = null;

          const spyInfo = vi
            .spyOn(console, "info")
            .mockImplementation((msg) => { captured = msg; });
          const spyWarn = vi
            .spyOn(console, "warn")
            .mockImplementation((msg) => { captured = msg; });
          const spyError = vi
            .spyOn(console, "error")
            .mockImplementation((msg) => { captured = msg; });

          const logger = createLogger({ minLevel });
          const method = levelToMethod[callLevel];

          // Use string message to avoid Error object severity promotion
          (logger[method] as (msg: string) => void)("test message");

          spyInfo.mockRestore();
          spyWarn.mockRestore();
          spyError.mockRestore();

          const shouldBeEmitted = levelOrder[callLevel] >= levelOrder[minLevel];

          if (shouldBeEmitted) {
            // Entry should have been emitted
            expect(captured).not.toBeNull();
            const entry = JSON.parse(captured!) as LogEntry;
            expect(entry.message).toBe("test message");
            // Severity should match the call level
            expect(entry.severity).toBe(callLevel);
          } else {
            // Entry should NOT have been emitted
            expect(captured).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
