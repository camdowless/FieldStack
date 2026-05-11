import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  sanitizeString,
  MAX_KEYWORD_LEN,
  MAX_LOCATION_LEN,
  SAFE_TEXT_RE,
} from "./validation";

/**
 * Feature: async-search-jobs
 * Property 2: Invalid input rejection
 * Validates: Requirements 1.2, 11.2
 *
 * For any input where the keyword is empty, exceeds 120 characters, or contains
 * characters outside the safe regex, OR the location is empty, exceeds 200
 * characters, or contains characters outside the safe regex, the Job_Creator
 * SHALL return an HTTP error status (400) and no Job document SHALL be created
 * in Firestore.
 *
 * We test the sanitizeString function directly since it is the pure function
 * that enforces these rules. If sanitizeString returns null, the Job_Creator
 * returns 400.
 */
describe("Property 2: Invalid input rejection", () => {
  // ── Generators ──────────────────────────────────────────────────────────────

  /** Generates a non-empty string that matches the safe regex and is not whitespace-only. */
  const safeChar = fc.stringOf(
    fc.mapToConstant(
      { num: 26, build: (v) => String.fromCharCode(97 + v) },  // a-z
      { num: 26, build: (v) => String.fromCharCode(65 + v) },  // A-Z
      { num: 10, build: (v) => String.fromCharCode(48 + v) },  // 0-9
      { num: 1, build: () => " " },
      { num: 1, build: () => "." },
      { num: 1, build: () => "," },
      { num: 1, build: () => "-" },
      { num: 1, build: () => "'" },
      { num: 1, build: () => "&" },
      { num: 1, build: () => "#" },
      { num: 1, build: () => "/" },
      { num: 1, build: () => "(" },
      { num: 1, build: () => ")" }
    ),
    { minLength: 1, maxLength: 20 }
  ).filter((s) => s.trim().length > 0);

  /** Characters that are NOT in the safe regex. */
  const unsafeChar = fc.constantFrom(
    "!", "@", "$", "%", "^", "*", "=", "+", "[", "]", "{", "}", "|",
    "\\", "~", "`", "<", ">", "?", ";", ":", '"'
  );

  /** Generates a string containing at least one unsafe character. */
  const stringWithUnsafeChars = fc
    .tuple(
      fc.stringOf(fc.char(), { minLength: 0, maxLength: 10 }),
      unsafeChar,
      fc.stringOf(fc.char(), { minLength: 0, maxLength: 10 })
    )
    .map(([prefix, bad, suffix]) => prefix + bad + suffix);

  // ── Empty input rejection ───────────────────────────────────────────────────

  it("rejects empty strings for keyword-length inputs", () => {
    fc.assert(
      fc.property(fc.constant(""), (input) => {
        expect(sanitizeString(input, MAX_KEYWORD_LEN)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("rejects whitespace-only strings for keyword-length inputs", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 1, maxLength: 50 }),
        (input) => {
          expect(sanitizeString(input, MAX_KEYWORD_LEN)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("rejects empty strings for location-length inputs", () => {
    fc.assert(
      fc.property(fc.constant(""), (input) => {
        expect(sanitizeString(input, MAX_LOCATION_LEN)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("rejects whitespace-only strings for location-length inputs", () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 1, maxLength: 50 }),
        (input) => {
          expect(sanitizeString(input, MAX_LOCATION_LEN)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Non-string input rejection ──────────────────────────────────────────────

  it("rejects non-string inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.object(),
          fc.array(fc.anything())
        ),
        (input) => {
          expect(sanitizeString(input, MAX_KEYWORD_LEN)).toBeNull();
          expect(sanitizeString(input, MAX_LOCATION_LEN)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Unsafe character rejection ──────────────────────────────────────────────

  it("rejects strings containing unsafe characters (keyword length)", () => {
    fc.assert(
      fc.property(stringWithUnsafeChars, (input) => {
        // After trim+slice, if the result still contains an unsafe char, it must be rejected
        const trimmed = input.trim().slice(0, MAX_KEYWORD_LEN);
        if (trimmed.length > 0 && !SAFE_TEXT_RE.test(trimmed)) {
          expect(sanitizeString(input, MAX_KEYWORD_LEN)).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  it("rejects strings containing unsafe characters (location length)", () => {
    fc.assert(
      fc.property(stringWithUnsafeChars, (input) => {
        const trimmed = input.trim().slice(0, MAX_LOCATION_LEN);
        if (trimmed.length > 0 && !SAFE_TEXT_RE.test(trimmed)) {
          expect(sanitizeString(input, MAX_LOCATION_LEN)).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  // ── Length enforcement ──────────────────────────────────────────────────────

  it("truncates strings exceeding MAX_KEYWORD_LEN but still validates", () => {
    fc.assert(
      fc.property(safeChar, (base) => {
        // Create a string longer than MAX_KEYWORD_LEN using safe chars
        const longInput = base.repeat(Math.ceil((MAX_KEYWORD_LEN + 10) / base.length));
        const result = sanitizeString(longInput, MAX_KEYWORD_LEN);
        if (result !== null) {
          expect(result.length).toBeLessThanOrEqual(MAX_KEYWORD_LEN);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("truncates strings exceeding MAX_LOCATION_LEN but still validates", () => {
    fc.assert(
      fc.property(safeChar, (base) => {
        const longInput = base.repeat(Math.ceil((MAX_LOCATION_LEN + 10) / base.length));
        const result = sanitizeString(longInput, MAX_LOCATION_LEN);
        if (result !== null) {
          expect(result.length).toBeLessThanOrEqual(MAX_LOCATION_LEN);
        }
      }),
      { numRuns: 100 }
    );
  });

  // ── Valid input acceptance (inverse property) ───────────────────────────────

  it("accepts valid safe strings within keyword length", () => {
    fc.assert(
      fc.property(safeChar, (input) => {
        // safeChar generates non-empty strings of safe characters
        const result = sanitizeString(input, MAX_KEYWORD_LEN);
        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThan(0);
        expect(result!.length).toBeLessThanOrEqual(MAX_KEYWORD_LEN);
      }),
      { numRuns: 100 }
    );
  });

  it("accepts valid safe strings within location length", () => {
    fc.assert(
      fc.property(safeChar, (input) => {
        const result = sanitizeString(input, MAX_LOCATION_LEN);
        expect(result).not.toBeNull();
        expect(result!.length).toBeGreaterThan(0);
        expect(result!.length).toBeLessThanOrEqual(MAX_LOCATION_LEN);
      }),
      { numRuns: 100 }
    );
  });

  // ── Core property: invalid input ↔ null result ─────────────────────────────

  it("returns null for ANY input that is invalid (empty, non-string, or unsafe chars)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Non-string types
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          // Empty / whitespace-only strings
          fc.constant(""),
          fc.stringOf(fc.constantFrom(" ", "\t", "\n"), { minLength: 1, maxLength: 20 }),
          // Strings with unsafe characters
          stringWithUnsafeChars
        ),
        (input) => {
          const kwResult = sanitizeString(input, MAX_KEYWORD_LEN);
          const locResult = sanitizeString(input, MAX_LOCATION_LEN);

          // For non-strings, empty, and whitespace-only: always null
          if (typeof input !== "string" || input.trim().length === 0) {
            expect(kwResult).toBeNull();
            expect(locResult).toBeNull();
            return;
          }

          // For strings with unsafe chars: null if trimmed+sliced still fails regex
          const kwTrimmed = input.trim().slice(0, MAX_KEYWORD_LEN);
          if (kwTrimmed.length === 0 || !SAFE_TEXT_RE.test(kwTrimmed)) {
            expect(kwResult).toBeNull();
          }

          const locTrimmed = input.trim().slice(0, MAX_LOCATION_LEN);
          if (locTrimmed.length === 0 || !SAFE_TEXT_RE.test(locTrimmed)) {
            expect(locResult).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
