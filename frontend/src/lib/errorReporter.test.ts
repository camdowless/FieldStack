import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";
import {
  initErrorReporter,
  reportError,
  buildReport,
  _internals,
  type ErrorReporterConfig,
} from "./errorReporter";

const { dedupMap, shouldReport, cleanupDedupMap, DEDUP_TTL_MS, DEDUP_MAX_SIZE } =
  _internals;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<ErrorReporterConfig>): ErrorReporterConfig {
  return {
    endpoint: "https://example.com/reportFrontendError",
    getUid: () => null,
    ...overrides,
  };
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

describe("errorReporter", () => {
  beforeEach(() => {
    dedupMap.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("buildReport", () => {
    it("builds a report with all required fields", () => {
      const report = buildReport("Test error", "Error: Test\n  at foo.ts:1", () => null);

      expect(report.message).toBe("Test error");
      expect(report.stack).toBe("Error: Test\n  at foo.ts:1");
      expect(report.url).toBeTruthy();
      expect(report.userAgent).toBeTruthy();
      expect(report.timestamp).toBeTruthy();
      expect(report.uid).toBeUndefined();
    });

    it("truncates UID to 8 characters when present", () => {
      const report = buildReport("err", null, () => "abcdefghijklmnop");
      expect(report.uid).toBe("abcdefgh");
    });

    it("does not include uid when getUid returns null", () => {
      const report = buildReport("err", null, () => null);
      expect(report.uid).toBeUndefined();
    });

    it("handles empty string UID", () => {
      const report = buildReport("err", null, () => "");
      expect(report.uid).toBeUndefined();
    });

    it("handles UID shorter than 8 characters", () => {
      const report = buildReport("err", null, () => "abc");
      expect(report.uid).toBe("abc");
    });
  });

  describe("deduplication - shouldReport", () => {
    it("allows first report of an error", () => {
      expect(shouldReport("error1", "stack1")).toBe(true);
    });

    it("blocks duplicate within TTL window", () => {
      shouldReport("error1", "stack1");
      expect(shouldReport("error1", "stack1")).toBe(false);
    });

    it("allows same error after TTL expires", () => {
      shouldReport("error1", "stack1");
      vi.advanceTimersByTime(DEDUP_TTL_MS);
      expect(shouldReport("error1", "stack1")).toBe(true);
    });

    it("treats different messages as different errors", () => {
      shouldReport("error1", "stack1");
      expect(shouldReport("error2", "stack1")).toBe(true);
    });

    it("treats different stacks as different errors", () => {
      shouldReport("error1", "stack1");
      expect(shouldReport("error1", "stack2")).toBe(true);
    });

    it("evicts oldest entry when map reaches max size", () => {
      // Fill the map to capacity
      for (let i = 0; i < DEDUP_MAX_SIZE; i++) {
        vi.advanceTimersByTime(1); // ensure different timestamps
        shouldReport(`error-${i}`, null);
      }
      expect(dedupMap.size).toBe(DEDUP_MAX_SIZE);

      // Adding one more should evict the oldest
      vi.advanceTimersByTime(1);
      shouldReport("new-error", null);
      expect(dedupMap.size).toBe(DEDUP_MAX_SIZE);
      expect(dedupMap.has("new-error" + "")).toBe(true);
    });
  });

  describe("cleanupDedupMap", () => {
    it("removes expired entries", () => {
      shouldReport("error1", null);
      vi.advanceTimersByTime(DEDUP_TTL_MS);
      cleanupDedupMap();
      expect(dedupMap.size).toBe(0);
    });

    it("keeps non-expired entries", () => {
      shouldReport("error1", null);
      vi.advanceTimersByTime(DEDUP_TTL_MS - 1);
      cleanupDedupMap();
      expect(dedupMap.size).toBe(1);
    });
  });

  describe("initErrorReporter", () => {
    it("registers error and unhandledrejection listeners", () => {
      const addEventSpy = vi.spyOn(window, "addEventListener");
      initErrorReporter(makeConfig());

      const eventTypes = addEventSpy.mock.calls.map((call) => call[0]);
      expect(eventTypes).toContain("error");
      expect(eventTypes).toContain("unhandledrejection");
    });

    it("sends report via sendBeacon on error event", () => {
      const sendBeaconSpy = vi.fn(() => true);
      Object.defineProperty(navigator, "sendBeacon", {
        value: sendBeaconSpy,
        writable: true,
        configurable: true,
      });

      initErrorReporter(makeConfig());

      const errorEvent = new ErrorEvent("error", {
        message: "Test error",
        error: new Error("Test error"),
      });
      window.dispatchEvent(errorEvent);

      expect(sendBeaconSpy).toHaveBeenCalled();
    });

    it("falls back to fetch when sendBeacon fails", () => {
      Object.defineProperty(navigator, "sendBeacon", {
        value: () => false,
        writable: true,
        configurable: true,
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 204 })
      );

      initErrorReporter(makeConfig());

      const errorEvent = new ErrorEvent("error", {
        message: "Fetch fallback test",
        error: new Error("Fetch fallback test"),
      });
      window.dispatchEvent(errorEvent);

      expect(fetchSpy).toHaveBeenCalled();
    });

    it("never throws on network errors", () => {
      Object.defineProperty(navigator, "sendBeacon", {
        value: () => { throw new Error("sendBeacon failed"); },
        writable: true,
        configurable: true,
      });

      initErrorReporter(makeConfig());

      expect(() => {
        const errorEvent = new ErrorEvent("error", {
          message: "Should not throw",
          error: new Error("Should not throw"),
        });
        window.dispatchEvent(errorEvent);
      }).not.toThrow();
    });
  });

  describe("reportError (manual)", () => {
    beforeEach(() => {
      Object.defineProperty(navigator, "sendBeacon", {
        value: vi.fn(() => true),
        writable: true,
        configurable: true,
      });
      initErrorReporter(makeConfig({ getUid: () => "user12345678abcd" }));
    });

    it("reports an Error object", () => {
      const sendBeaconSpy = navigator.sendBeacon as ReturnType<typeof vi.fn>;
      reportError(new Error("manual error"));
      expect(sendBeaconSpy).toHaveBeenCalled();
    });

    it("reports a string error", () => {
      const sendBeaconSpy = navigator.sendBeacon as ReturnType<typeof vi.fn>;
      reportError("string error");
      expect(sendBeaconSpy).toHaveBeenCalled();
    });

    it("deduplicates repeated manual reports", () => {
      const sendBeaconSpy = navigator.sendBeacon as ReturnType<typeof vi.fn>;
      const err = new Error("dup error");
      reportError(err);
      reportError(err);
      // sendBeacon called once for the first, not for the second
      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Property-Based Tests ───────────────────────────────────────────────────

describe("Property 7: Error report structure", () => {
  /**
   * **Validates: Requirements 6.3, 6.4**
   *
   * For any Error object captured by the frontend Error_Reporter, the generated
   * report payload SHALL contain non-empty `message`, `url`, `userAgent`, and
   * `timestamp` fields, and if a UID is available, it SHALL be truncated to 8 characters.
   */
  it("report payload contains non-empty message, url, userAgent, timestamp", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: null }),
        (message, stack) => {
          const report = buildReport(message, stack, () => null);

          expect(report.message).toBeTruthy();
          expect(report.message).toBe(message);
          expect(typeof report.url).toBe("string");
          expect(typeof report.userAgent).toBe("string");
          expect(report.timestamp).toBeTruthy();
          // Verify timestamp is valid ISO 8601
          expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("UID is truncated to 8 characters when present", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: null }),
        fc.string({ minLength: 1 }),
        (message, stack, uid) => {
          const report = buildReport(message, stack, () => uid);

          expect(report.uid).toBeDefined();
          expect(report.uid!.length).toBeLessThanOrEqual(8);
          expect(report.uid).toBe(uid.substring(0, 8));
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 8: Error deduplication", () => {
  beforeEach(() => {
    dedupMap.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Validates: Requirements 6.6**
   *
   * For any error reported N times (N > 1) within a 60-second window,
   * the Error_Reporter SHALL transmit exactly 1 report to the backend.
   */
  it("exactly 1 report is transmitted for N > 1 identical errors within 60s", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: null }),
        fc.integer({ min: 2, max: 50 }),
        (message, stack, n) => {
          dedupMap.clear();

          let reportCount = 0;
          for (let i = 0; i < n; i++) {
            if (shouldReport(message, stack)) {
              reportCount++;
            }
          }

          expect(reportCount).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("allows re-reporting after TTL expires", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.option(fc.string(), { nil: null }),
        (message, stack) => {
          dedupMap.clear();

          // First report
          expect(shouldReport(message, stack)).toBe(true);
          // Within TTL — blocked
          expect(shouldReport(message, stack)).toBe(false);
          // Advance past TTL
          vi.advanceTimersByTime(DEDUP_TTL_MS);
          // Should be allowed again
          expect(shouldReport(message, stack)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
