import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { JobDocument } from "./types";

function getDb() {
  return admin.firestore();
}

/**
 * Interface for Firestore document reference operations needed by job creation.
 * Extracted for testability — allows mocking Firestore in property tests.
 */
export interface JobDocRef {
  create(data: Record<string, unknown>): Promise<unknown>;
  get(): Promise<{ exists: boolean; data(): JobDocument | undefined }>;
  set(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

/**
 * Result of the createOrReuseJob operation.
 */
export interface CreateOrReuseJobResult {
  jobId: string;
  isExisting: boolean;
}

/**
 * Core job creation logic with duplicate detection.
 *
 * Attempts to create a new job document. If a document with the same
 * deterministic ID already exists:
 * - If status is "running", returns the existing job ID (duplicate suppression).
 * - If status is terminal, clears the results subcollection and overwrites.
 *
 * @param jobId - The deterministic job ID
 * @param jobData - The job document data to write
 * @param jobRef - Firestore document reference (injectable for testing)
 * @param cleanupSubcollection - Function to delete results subcollection
 * @returns The job ID and whether it was an existing running job
 */
export async function createOrReuseJob(
  jobId: string,
  jobData: JobDocument,
  jobRef: JobDocRef,
  cleanupSubcollection: (id: string) => Promise<void>
): Promise<CreateOrReuseJobResult> {
  try {
    await jobRef.create(jobData as unknown as Record<string, unknown>);
    return { jobId, isExisting: false };
  } catch (err: unknown) {
    const firestoreError = err as { code?: number };
    if (firestoreError.code === 6) {
      // ALREADY_EXISTS — read existing doc
      const existingSnap = await jobRef.get();
      const existingData = existingSnap.data();

      if (!existingData) {
        throw new Error("Document exists but has no data");
      }

      if (existingData.status === "running") {
        // Duplicate running job — return existing ID
        return { jobId, isExisting: true };
      }

      // Terminal status — clear subcollection, delete old doc, create fresh
      // We must delete + create (not set) so the onCreate trigger fires
      await cleanupSubcollection(jobId);
      await jobRef.delete();
      await jobRef.create(jobData as unknown as Record<string, unknown>);
      return { jobId, isExisting: false };
    }
    throw err;
  }
}

/**
 * Compute a deterministic job ID from the search parameters.
 * Uses SHA-256 truncated to 20 hex chars (80 bits).
 * The pipe delimiter prevents ambiguity between concatenated fields.
 */
export function computeJobId(
  uid: string,
  keyword: string,
  location: string,
  radius: number
): string {
  const input = `${uid}|${keyword}|${location}|${radius}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}

/**
 * Recursively delete all documents in the results subcollection for a job.
 * Firestore batch deletes are limited to 500 operations, so we recurse
 * if there are more documents.
 */
export async function deleteResultsSubcollection(jobId: string): Promise<void> {
  const resultsRef = getDb().collection("jobs").doc(jobId).collection("results");
  const snapshot = await resultsRef.limit(500).get();
  if (snapshot.empty) return;

  const batch = getDb().batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  // Recurse if there may be more documents
  if (snapshot.size === 500) {
    await deleteResultsSubcollection(jobId);
  }
}

/**
 * Check whether a job has been cancelled.
 * Called between pipeline stages in the Job_Processor.
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const snap = await getDb().collection("jobs").doc(jobId).get();
  return snap.exists && snap.data()?.status === "cancelled";
}

/**
 * Result of a cancel job attempt.
 */
export type CancelJobResult =
  | { outcome: "not_found" }
  | { outcome: "forbidden" }
  | { outcome: "not_running" }
  | { outcome: "cancelled" };

/**
 * Interface for reading a job document for cancellation.
 * Extracted for testability.
 */
export interface CancelJobDocRef {
  get(): Promise<{ exists: boolean; data(): JobDocument | undefined }>;
  update(data: Record<string, unknown>): Promise<unknown>;
}

/**
 * Core cancellation logic: verify ownership and status, then cancel.
 *
 * @param requestingUid - The UID of the user requesting cancellation
 * @param jobRef - Firestore document reference (injectable for testing)
 * @returns The outcome of the cancellation attempt
 */
export async function cancelJob(
  requestingUid: string,
  jobRef: CancelJobDocRef
): Promise<CancelJobResult> {
  const snap = await jobRef.get();

  if (!snap.exists) {
    return { outcome: "not_found" };
  }

  const jobData = snap.data();
  if (!jobData) {
    return { outcome: "not_found" };
  }

  if (jobData.uid !== requestingUid) {
    return { outcome: "forbidden" };
  }

  if (jobData.status !== "running") {
    return { outcome: "not_running" };
  }

  await jobRef.update({ status: "cancelled" });
  return { outcome: "cancelled" };
}


/**
 * Represents a job document snapshot for cleanup operations.
 */
export interface CleanupJobSnapshot {
  id: string;
  status: string;
  createdAt: { toMillis(): number };
  ttl: { toMillis(): number };
}

/**
 * Core logic for identifying stuck running jobs.
 * A job is "stuck" if its status is "running" and its createdAt is older than
 * the specified threshold (default: 10 minutes).
 *
 * Extracted for testability — the Cloud Function handles Firestore queries,
 * this function handles the filtering logic.
 *
 * @param jobs - Array of job snapshots to evaluate
 * @param nowMs - Current time in milliseconds
 * @param thresholdMs - Age threshold in milliseconds (default: 10 minutes)
 * @returns Array of job IDs that should be marked as failed
 */
export function identifyStuckJobs(
  jobs: CleanupJobSnapshot[],
  nowMs: number,
  thresholdMs: number = 10 * 60 * 1000
): string[] {
  return jobs
    .filter(
      (job) =>
        job.status === "running" &&
        nowMs - job.createdAt.toMillis() > thresholdMs
    )
    .map((job) => job.id);
}

/**
 * Core logic for identifying expired jobs based on TTL.
 * A job is "expired" if its ttl timestamp is in the past.
 *
 * Extracted for testability.
 *
 * @param jobs - Array of job snapshots to evaluate
 * @param nowMs - Current time in milliseconds
 * @returns Array of job IDs that should be deleted
 */
export function identifyExpiredJobs(
  jobs: CleanupJobSnapshot[],
  nowMs: number
): string[] {
  return jobs
    .filter((job) => job.ttl.toMillis() < nowMs)
    .map((job) => job.id);
}

