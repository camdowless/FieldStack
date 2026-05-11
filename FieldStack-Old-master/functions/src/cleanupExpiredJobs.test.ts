import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { identifyExpiredJobs, CleanupJobSnapshot } from "./jobHelpers";

/**
 * Feature: async-search-jobs
 * Property 16: TTL cleanup deletes only expired jobs
 * Validates: Requirements 8.2
 *
 * For any set of Job documents, the TTL cleanup function SHALL delete exactly
 * those documents where ttl is in the past. Documents where ttl is in the
 * future SHALL remain untouched.
 */

const statusArb = fc.constantFrom("running", "completed", "failed", "cancelled");

const jobSnapshotArb = (nowMs: number): fc.Arbitrary<CleanupJobSnapshot> =>
  fc.record({
    id: fc.string({ minLength: 5, maxLength: 20 }),
    status: statusArb,
    createdAt: fc.constant({ toMillis: () => nowMs - 24 * 60 * 60 * 1000 }),
    // TTL ranges from 2 hours ago to 2 hours in the future
    ttl: fc.integer({ min: nowMs - 2 * 60 * 60 * 1000, max: nowMs + 2 * 60 * 60 * 1000 }).map((ms) => ({
      toMillis: () => ms,
    })),
  });

describe("Property 16: TTL cleanup deletes only expired jobs", () => {
  const NOW = Date.now();

  it("identifies exactly the jobs whose ttl is in the past", () => {
    fc.assert(
      fc.property(
        fc.array(jobSnapshotArb(NOW), { minLength: 0, maxLength: 20 }),
        (jobs) => {
          const expiredIds = identifyExpiredJobs(jobs, NOW);

          // Every returned ID must have a ttl in the past
          for (const id of expiredIds) {
            const job = jobs.find((j) => j.id === id);
            expect(job).toBeDefined();
            expect(job!.ttl.toMillis()).toBeLessThan(NOW);
          }

          // Every job with ttl in the past must be in the result
          for (const job of jobs) {
            if (job.ttl.toMillis() < NOW) {
              expect(expiredIds).toContain(job.id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never deletes jobs whose ttl is in the future", () => {
    fc.assert(
      fc.property(
        fc.array(jobSnapshotArb(NOW), { minLength: 1, maxLength: 20 }),
        (jobs) => {
          const expiredIds = identifyExpiredJobs(jobs, NOW);

          for (const job of jobs) {
            if (job.ttl.toMillis() >= NOW) {
              expect(expiredIds).not.toContain(job.id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("deletes expired jobs regardless of their status", () => {
    fc.assert(
      fc.property(
        statusArb,
        fc.string({ minLength: 5, maxLength: 20 }),
        (status, id) => {
          const expiredJob: CleanupJobSnapshot = {
            id,
            status,
            createdAt: { toMillis: () => NOW - 48 * 60 * 60 * 1000 },
            ttl: { toMillis: () => NOW - 1000 }, // 1 second ago
          };

          const result = identifyExpiredJobs([expiredJob], NOW);
          expect(result).toContain(id);
        }
      ),
      { numRuns: 100 }
    );
  });
});
