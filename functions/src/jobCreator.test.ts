import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { Timestamp } from "firebase-admin/firestore";
import { createOrReuseJob, computeJobId, JobDocRef } from "./jobHelpers";
import { JobDocument } from "./types";

/**
 * Feature: async-search-jobs
 * Property 4: Duplicate running job returns existing ID
 * Validates: Requirements 7.3
 *
 * For any search request where a Job document with the same deterministic ID
 * already exists and has status "running", the Job_Creator SHALL return the
 * existing job ID and the total number of Job documents with that ID SHALL
 * remain exactly one.
 */
describe("Property 4: Duplicate running job returns existing ID", () => {
  // ── Generators ──────────────────────────────────────────────────────────────

  /** Generates valid search parameters. */
  const searchParamsArb = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 40 }),
    keyword: fc.string({ minLength: 1, maxLength: 120 }),
    location: fc.string({ minLength: 1, maxLength: 200 }),
    radius: fc.integer({ min: 1, max: 100 }),
  });

  /** Builds a JobDocument from search params. */
  function makeJobData(params: {
    uid: string;
    keyword: string;
    location: string;
    radius: number;
  }): JobDocument {
    const now = Date.now();
    return {
      uid: params.uid,
      status: "running",
      params: {
        keyword: params.keyword,
        location: params.location,
        radius: params.radius,
      },
      progress: { analyzed: 0, total: 0 },
      resultCount: null,
      error: null,
      cost: null,
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      ttl: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Creates a mock JobDocRef that simulates a Firestore document reference
   * where a "running" job already exists. Tracks create/set call counts.
   */
  function makeMockRefWithRunningJob(existingDoc: JobDocument) {
    let setCalls = 0;
    let cleanupCalls = 0;

    const ref: JobDocRef = {
      create: async () => {
        // Simulate ALREADY_EXISTS error (Firestore error code 6)
        const err = new Error("Document already exists") as Error & { code: number };
        err.code = 6;
        throw err;
      },
      get: async () => ({
        exists: true,
        data: () => existingDoc,
      }),
      set: async () => {
        setCalls++;
      },
      delete: async () => {},
    };

    const cleanup = async () => { cleanupCalls++; };

    return {
      ref,
      cleanup,
      getSetCalls: () => setCalls,
      getCleanupCalls: () => cleanupCalls,
    };
  }

  // ── Property: duplicate running job returns existing ID ─────────────────────

  it("returns the existing job ID when a running job already exists", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, async (params) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params);
        const jobData = makeJobData(params);

        const { ref, cleanup } = makeMockRefWithRunningJob(existingDoc);

        const result = await createOrReuseJob(jobId, jobData, ref, cleanup);

        // SHALL return the existing job ID
        expect(result.jobId).toBe(jobId);
        // SHALL indicate it was an existing job
        expect(result.isExisting).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: no additional documents are created (count remains exactly one)

  it("does not create or overwrite the document (count remains exactly one)", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, async (params) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params);
        const jobData = makeJobData(params);

        const { ref, cleanup, getSetCalls } = makeMockRefWithRunningJob(existingDoc);

        await createOrReuseJob(jobId, jobData, ref, cleanup);

        // set() should NOT be called — the existing running doc is reused as-is
        expect(getSetCalls()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: returned jobId matches the deterministic ID ───────────────────

  it("returned jobId matches the deterministic ID computed from the same params", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, async (params) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params);
        const jobData = makeJobData(params);

        const { ref, cleanup } = makeMockRefWithRunningJob(existingDoc);

        const result = await createOrReuseJob(jobId, jobData, ref, cleanup);

        // The returned ID must be the same deterministic ID
        expect(result.jobId).toBe(computeJobId(
          params.uid, params.keyword, params.location, params.radius
        ));
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: subcollection cleanup is NOT called for running duplicates ────

  it("does not trigger subcollection cleanup for running duplicates", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, async (params) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params);
        const jobData = makeJobData(params);

        const { ref, cleanup, getCleanupCalls } = makeMockRefWithRunningJob(existingDoc);

        await createOrReuseJob(jobId, jobData, ref, cleanup);

        // Cleanup should NOT be called — running jobs are reused, not overwritten
        expect(getCleanupCalls()).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: async-search-jobs
 * Property 5: Terminal job reuse clears stale results
 * Validates: Requirements 7.4
 *
 * For any search request where a Job document with the same deterministic ID
 * already exists and has a terminal status ("completed", "failed", "cancelled"),
 * after the Job_Creator processes the request: the Results_Subcollection SHALL
 * be empty (all previous result documents deleted), and the Job document SHALL
 * have status "running" with fresh timestamps.
 */
describe("Property 5: Terminal job reuse clears stale results", () => {
  // ── Generators ──────────────────────────────────────────────────────────────

  /** Generates valid search parameters. */
  const searchParamsArb = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 40 }),
    keyword: fc.string({ minLength: 1, maxLength: 120 }),
    location: fc.string({ minLength: 1, maxLength: 200 }),
    radius: fc.integer({ min: 1, max: 100 }),
  });

  /** Generates one of the three terminal statuses. */
  const terminalStatusArb = fc.constantFrom(
    "completed" as const,
    "failed" as const,
    "cancelled" as const
  );

  /** Builds a JobDocument with a given status. */
  function makeJobData(
    params: { uid: string; keyword: string; location: string; radius: number },
    status: "running" | "completed" | "failed" | "cancelled" = "running"
  ): JobDocument {
    const now = Date.now();
    return {
      uid: params.uid,
      status,
      params: {
        keyword: params.keyword,
        location: params.location,
        radius: params.radius,
      },
      progress: { analyzed: 0, total: 0 },
      resultCount: null,
      error: null,
      cost: null,
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
      ttl: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Creates a mock JobDocRef that simulates a Firestore document reference
   * where a job with a terminal status already exists.
   * Tracks create/set calls and captures the data passed to set().
   */
  function makeMockRefWithTerminalJob(existingDoc: JobDocument) {
    let deleteCalls = 0;
    let createAfterDeleteCalls = 0;
    let cleanupCalls = 0;
    let lastCreateData: Record<string, unknown> | null = null;
    let deleted = false;

    const ref: JobDocRef = {
      create: async (data: Record<string, unknown>) => {
        if (!deleted) {
          // First create() — simulate ALREADY_EXISTS
          const err = new Error("Document already exists") as Error & { code: number };
          err.code = 6;
          throw err;
        }
        // After delete, create succeeds
        createAfterDeleteCalls++;
        lastCreateData = data;
      },
      get: async () => ({
        exists: true,
        data: () => existingDoc,
      }),
      set: async () => {},
      delete: async () => {
        deleteCalls++;
        deleted = true;
      },
    };

    const cleanup = async () => {
      cleanupCalls++;
    };

    return {
      ref,
      cleanup,
      getDeleteCalls: () => deleteCalls,
      getCreateAfterDeleteCalls: () => createAfterDeleteCalls,
      getCleanupCalls: () => cleanupCalls,
      getLastCreateData: () => lastCreateData,
    };
  }

  // ── Property: cleanup IS called for terminal statuses ───────────────────────

  it("calls cleanupSubcollection for any terminal status", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, terminalStatusArb, async (params, terminalStatus) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params, terminalStatus);
        const newJobData = makeJobData(params, "running");

        const { ref, cleanup, getCleanupCalls } = makeMockRefWithTerminalJob(existingDoc);

        await createOrReuseJob(jobId, newJobData, ref, cleanup);

        // Results_Subcollection SHALL be empty (cleanup called)
        expect(getCleanupCalls()).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: delete + create IS called with new job data ───────────────────

  it("deletes then creates the job document for any terminal status", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, terminalStatusArb, async (params, terminalStatus) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params, terminalStatus);
        const newJobData = makeJobData(params, "running");

        const { ref, cleanup, getDeleteCalls, getCreateAfterDeleteCalls } = makeMockRefWithTerminalJob(existingDoc);

        await createOrReuseJob(jobId, newJobData, ref, cleanup);

        // Job document SHALL be deleted then re-created
        expect(getDeleteCalls()).toBe(1);
        expect(getCreateAfterDeleteCalls()).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: result indicates isExisting: false (fresh job) ────────────────

  it("returns isExisting: false for terminal job reuse", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, terminalStatusArb, async (params, terminalStatus) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params, terminalStatus);
        const newJobData = makeJobData(params, "running");

        const { ref, cleanup } = makeMockRefWithTerminalJob(existingDoc);

        const result = await createOrReuseJob(jobId, newJobData, ref, cleanup);

        // SHALL indicate this is a fresh job, not an existing one
        expect(result.isExisting).toBe(false);
        expect(result.jobId).toBe(jobId);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: new job data has status "running" ─────────────────────────────

  it("overwrites with status 'running' for any terminal status", async () => {
    await fc.assert(
      fc.asyncProperty(searchParamsArb, terminalStatusArb, async (params, terminalStatus) => {
        const jobId = computeJobId(params.uid, params.keyword, params.location, params.radius);
        const existingDoc = makeJobData(params, terminalStatus);
        const newJobData = makeJobData(params, "running");

        const { ref, cleanup, getLastCreateData } = makeMockRefWithTerminalJob(existingDoc);

        await createOrReuseJob(jobId, newJobData, ref, cleanup);

        // The data written via create() SHALL have status "running"
        const writtenData = getLastCreateData() as unknown as JobDocument;
        expect(writtenData).not.toBeNull();
        expect(writtenData.status).toBe("running");
      }),
      { numRuns: 100 }
    );
  });
});
