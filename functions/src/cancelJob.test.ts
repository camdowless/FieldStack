import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Timestamp } from "firebase-admin/firestore";
import { cancelJob, CancelJobDocRef } from "./jobHelpers";
import { JobDocument, JobStatus } from "./types";

/**
 * Feature: async-search-jobs
 * Property 11: Cancel endpoint ownership check
 * Validates: Requirements 4.1
 *
 * For any cancel request, the Job_Canceller SHALL only update the status to
 * "cancelled" if the requesting user's UID matches the Job document's uid
 * field. If the UIDs do not match, the status SHALL remain unchanged.
 */
describe("Property 11: Cancel endpoint ownership check", () => {
  // ── Generators ──────────────────────────────────────────────────────────────

  const uidArb = fc.string({ minLength: 1, maxLength: 40 });

  const jobStatusArb = fc.constantFrom<JobStatus>(
    "running",
    "completed",
    "failed",
    "cancelled"
  );

  function makeJobDoc(uid: string, status: JobStatus): JobDocument {
    const now = Date.now();
    return {
      uid,
      status,
      params: { keyword: "test", location: "test", radius: 10 },
      progress: { analyzed: 0, total: 0 },
      resultCount: null,
      error: null,
      cost: null,
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      ttl: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    };
  }

  function makeMockRef(jobDoc: JobDocument | null): {
    ref: CancelJobDocRef;
    getUpdateCalls: () => number;
    getLastUpdateData: () => Record<string, unknown> | null;
  } {
    let updateCalls = 0;
    let lastUpdateData: Record<string, unknown> | null = null;

    const ref: CancelJobDocRef = {
      get: async () => ({
        exists: jobDoc !== null,
        data: () => jobDoc ?? undefined,
      }),
      update: async (data: Record<string, unknown>) => {
        updateCalls++;
        lastUpdateData = data;
      },
    };

    return { ref, getUpdateCalls: () => updateCalls, getLastUpdateData: () => lastUpdateData };
  }

  // ── Property: mismatched UID never triggers update ──────────────────────────

  it("does not update status when requesting UID does not match job owner", async () => {
    await fc.assert(
      fc.asyncProperty(
        uidArb,
        uidArb,
        jobStatusArb,
        async (ownerUid, requestingUid, status) => {
          fc.pre(ownerUid !== requestingUid);

          const jobDoc = makeJobDoc(ownerUid, status);
          const { ref, getUpdateCalls } = makeMockRef(jobDoc);

          const result = await cancelJob(requestingUid, ref);

          expect(result.outcome).toBe("forbidden");
          expect(getUpdateCalls()).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property: matching UID + running status triggers cancellation ───────────

  it("updates status to cancelled when UID matches and job is running", async () => {
    await fc.assert(
      fc.asyncProperty(uidArb, async (uid) => {
        const jobDoc = makeJobDoc(uid, "running");
        const { ref, getUpdateCalls, getLastUpdateData } = makeMockRef(jobDoc);

        const result = await cancelJob(uid, ref);

        expect(result.outcome).toBe("cancelled");
        expect(getUpdateCalls()).toBe(1);
        expect(getLastUpdateData()).toEqual({ status: "cancelled" });
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: matching UID + non-running status does not update ─────────────

  it("does not update when UID matches but job is not running", async () => {
    const nonRunningStatusArb = fc.constantFrom<JobStatus>(
      "completed",
      "failed",
      "cancelled"
    );

    await fc.assert(
      fc.asyncProperty(uidArb, nonRunningStatusArb, async (uid, status) => {
        const jobDoc = makeJobDoc(uid, status);
        const { ref, getUpdateCalls } = makeMockRef(jobDoc);

        const result = await cancelJob(uid, ref);

        expect(result.outcome).toBe("not_running");
        expect(getUpdateCalls()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
