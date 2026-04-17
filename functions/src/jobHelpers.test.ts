import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeJobId } from "./jobHelpers";

/**
 * Feature: async-search-jobs
 * Property 3: Deterministic job ID is a pure function
 * Validates: Requirements 7.1
 */
describe("Property 3: Deterministic job ID is a pure function", () => {
  /**
   * Same inputs always produce the same output (determinism/purity).
   * For any (uid, keyword, location, radius) tuple, calling computeJobId
   * twice with the same arguments SHALL return the same string.
   */
  it("same inputs always produce the same output", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100 }),
        (uid, keyword, location, radius) => {
          const id1 = computeJobId(uid, keyword, location, radius);
          const id2 = computeJobId(uid, keyword, location, radius);
          expect(id1).toBe(id2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Output is always a 20-character hex string.
   * SHA-256 truncated to 20 hex chars should always match /^[0-9a-f]{20}$/.
   */
  it("output is always a 20-character hex string", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.string(),
        fc.integer({ min: 1, max: 100 }),
        (uid, keyword, location, radius) => {
          const id = computeJobId(uid, keyword, location, radius);
          expect(id).toMatch(/^[0-9a-f]{20}$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Different inputs produce different outputs (with high probability).
   * For any two distinct (uid, keyword, location, radius) tuples where at
   * least one component differs, computeJobId SHALL return different strings.
   */
  it("different inputs produce different outputs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100 }),
        (uid1, kw1, loc1, r1, uid2, kw2, loc2, r2) => {
          // Skip if all components are identical
          const same = uid1 === uid2 && kw1 === kw2 && loc1 === loc2 && r1 === r2;
          if (same) return;

          const id1 = computeJobId(uid1, kw1, loc1, r1);
          const id2 = computeJobId(uid2, kw2, loc2, r2);
          expect(id1).not.toBe(id2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
