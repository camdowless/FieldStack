import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { identifyStuckJobs, CleanupJobSnapshot } from "./jobHelpers";

/**
 * Feature: async-search-jobs
 * Property 17: Stuck job cleanup marks only old running jobs
 * Validates: Requirements 8.3
 *
 * For any set of Job documents, the stuck job cleanup function SHALL update
 * to "failed" exactly those documents where status is "running" AND createdAt
 * is older than 10 minutes. Documents with other statuses or createdAt within
 * 10 minutes SHALL remain untouched.
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;

const statusArb = fc.constantFrom("running", "completed", "failed", "cancelled");

const jobSnapshotArb = (nowMs: number): fc.Arbitrary<CleanupJobSnapshot> =>
  fc.record({
    id: fc.string({ minLength: 5, maxLength: 20 }),
    status: statusArb,
    // createdAt ranges from 30 minutes ago to 5 minutes in the future
    createdAt: fc.integer({ min: nowMs - 30 * 60 * 1000, max: nowMs + 5 * 60 * 1000 }).map((ms) => ({
      toMillis: () => ms,
    })),
    ttl: fc.constant({ toMillis: () => nowMs + 24 * 60 * 60 * 1000 }),
  });

describe("Property 17: Stuck job cleanup marks only old running jobs", () => {
  const NOW = Date.now();

  it("identifies exactly the jobs that are running AND older than 10 minutes", () => {
    fc.assert(
      fc.property(
        fc.array(jobSnapshotArb(NOW), { minLength: 0, maxLength: 20 }),
        (jobs) => {
          const stuckIds = identifyStuckJobs(jobs, NOW);

          // Every returned ID must be a running job older than 10 minutes
          for (const id of stuckIds) {
            const job = jobs.find((j) => j.id === id);
            expect(job).toBeDefined();
            expect(job!.status).toBe("running");
            expect(NOW - job!.createdAt.toMillis()).toBeGreaterThan(TEN_MINUTES_MS);
          }

          // Every running job older than 10 minutes must be in the result
          for (const job of jobs) {
            const isStuck =
              job.status === "running" &&
              NOW - job.createdAt.toMillis() > TEN_MINUTES_MS;
            if (isStuck) {
              expect(stuckIds).toContain(job.id);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never marks non-running jobs as stuck", () => {
    fc.assert(
      fc.property(
        fc.array(jobSnapshotArb(NOW), { minLength: 1, maxLength: 20 }),
        (jobs) => {
          const stuckIds = identifyStuckJobs(jobs, NOW);

          for (const id of stuckIds) {
            const job = jobs.find((j) => j.id === id);
            expect(job!.status).toBe("running");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("never marks recently created running jobs as stuck", () => {
    fc.assert(
      fc.property(
        fc.array(jobSnapshotArb(NOW), { minLength: 1, maxLength: 20 }),
        (jobs) => {
          const stuckIds = identifyStuckJobs(jobs, NOW);

          for (const id of stuckIds) {
            const job = jobs.find((j) => j.id === id);
            expect(NOW - job!.createdAt.toMillis()).toBeGreaterThan(TEN_MINUTES_MS);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
