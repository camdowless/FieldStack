import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {
  buildAuthHeader,
  searchBusinesses,
  fetchInstantPages,
  fetchLighthouse,
  isParkedDomain,
  extractBusinessData,
  deadSiteSignals,
  probeUrl,
} from "./dfsClient";
import { lookupDomainInfo } from "./rdap";
import { score, computeLegitimacy } from "./scorer";
import { ScoredBusiness, CostBreakdown, BusinessRaw, ScorerInput, JobDocument, UserProfile } from "./types";
import { geocodeLocation, milesToKm, buildLocationCoordinate } from "./geocode";
import { computeJobId, deleteResultsSubcollection, createOrReuseJob, isJobCancelled, cancelJob, identifyStuckJobs, identifyExpiredJobs } from "./jobHelpers";
import { Timestamp } from "firebase-admin/firestore";
import { checkUserRole, checkAdminRole } from "./authHelpers";
import type { Subscription, SubscriptionPlan } from "./types";
import { getPlanCredits, buildPriceIdToPlanMap, invalidatePlanCache } from "./plans";
import { buildPlanSeedData, PLAN_IDS } from "./seedPlans";
import Stripe from "stripe";
type StripeInstance = InstanceType<typeof Stripe>;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
let _stripe: StripeInstance | null = null;
function getStripe(): StripeInstance {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
  }
  return _stripe;
}

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Set CORS_ORIGIN (comma-separated) in functions/.env:
//   CORS_ORIGIN=https://your-app.web.app,https://your-custom-domain.com
const rawCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

if (rawCorsOrigins.length === 0) {
  console.error("[CORS] ❌ CORS_ORIGIN is not set — all cross-origin requests will be rejected with 401. Set CORS_ORIGIN in functions/.env");
} else {
  console.log(`[CORS] Allowed origins: ${rawCorsOrigins.join(", ")}`);
}

const corsHandler = cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (same-origin, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }
    if (rawCorsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] ❌ Rejected origin="${origin}" — not in allowed list: [${rawCorsOrigins.join(", ")}]`);
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// ─── Auth Helper ──────────────────────────────────────────────────────────────

/**
 * Verifies the request token and checks that the caller has the "user" or "admin" role.
 * Treats a missing `role` claim as "user" for backward compatibility.
 * Throws FORBIDDEN for any unrecognized role value.
 */
async function verifyUserRole(req: functions.https.Request): Promise<admin.auth.DecodedIdToken> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  // No checkRevoked here — revocation is reserved for admin/security actions.
  // Checking revocation on every user request breaks sessions for users whose
  // tokens were revoked during admin operations (e.g. role changes).
  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  checkUserRole(decoded);
  return decoded;
}

/**
 * Verifies the request token with revocation check and asserts the caller has the "admin" role.
 * Logs uid + function name on rejection (Req 4.3).
 * Throws FORBIDDEN if role !== "admin".
 */
async function verifyAdmin(req: functions.https.Request, functionName?: string): Promise<admin.auth.DecodedIdToken> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1], true /* checkRevoked */);
  checkAdminRole(decoded, decoded.uid, functionName);
  return decoded;
}

// ─── User Profile Helper ─────────────────────────────────────────────────────

const USERS_COLLECTION = "users";

type FirestoreUserProfile = Omit<UserProfile, "createdAt" | "updatedAt"> & {
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
};

/**
 * Build a default subscription object for a given plan.
 * creditsTotal is read from the Firestore plans collection.
 */
async function buildDefaultSubscription(plan: SubscriptionPlan = "free"): Promise<Subscription> {
  const creditsTotal = await getPlanCredits(plan);
  return {
    plan,
    status: "active",
    creditsUsed: 0,
    creditsTotal,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Build a complete user profile document from the given fields.
 * Single source of truth for the shape of a new user document.
 */
async function buildUserProfile(fields: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}): Promise<FirestoreUserProfile> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  return {
    uid: fields.uid,
    email: fields.email ?? null,
    displayName: fields.displayName ?? null,
    photoURL: fields.photoURL ?? null,
    role: "user",
    subscription: await buildDefaultSubscription("free"),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Authoritative user profile creation — called from the onUserCreate auth
 * trigger with the full UserRecord already in hand.
 *
 * Uses Firestore `create()` so it fails loudly if the doc already exists
 * (which should never happen in the onCreate path). This guarantees the
 * complete profile is written atomically before the function returns.
 */
async function createUserProfile(user: admin.auth.UserRecord): Promise<void> {
  const ref = db.collection(USERS_COLLECTION).doc(user.uid);
  const profile = await buildUserProfile({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  });

  console.log(`[createUserProfile] attempting write uid=${user.uid} fields=${JSON.stringify({ email: profile.email, displayName: profile.displayName, role: profile.role, plan: profile.subscription.plan, creditsTotal: profile.subscription.creditsTotal })}`);

  try {
    await ref.create(profile);
    console.log(`[createUserProfile] SUCCESS uid=${user.uid} (${user.email ?? "no email"})`);
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 6) {
      console.warn(`[createUserProfile] doc already exists uid=${user.uid}, skipping`);
      return;
    }
    console.error(`[createUserProfile] FAILED uid=${user.uid} code=${code}`, err);
    throw err;
  }
}

/**
 * Lazy safety-net: ensure a user document exists when called from HTTP
 * functions (e.g. dataforseoBusinessSearch). Falls back to fetching the
 * auth record if the doc is missing — this should rarely happen because
 * onUserCreate handles the primary creation path.
 */
async function ensureUserProfile(uid: string): Promise<void> {
  const ref = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await ref.get();
  if (snap.exists) return;

  console.warn(`[user] profile missing for ${uid} — creating via fallback`);

  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  try {
    const userRecord = await admin.auth().getUser(uid);
    email = userRecord.email ?? null;
    displayName = userRecord.displayName ?? null;
    photoURL = userRecord.photoURL ?? null;
  } catch (err) {
    console.error(`[user] failed to fetch auth record for ${uid}:`, err);
  }

  const profile = buildUserProfile({ uid, email, displayName, photoURL });

  try {
    await ref.create(profile);
    console.log(`[user] created profile for ${uid} via fallback`);
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 6) {
      // Another path created it between our read and write — that's fine
      return;
    }
    throw err;
  }
}

/**
 * Save a search to the user's searches subcollection.
 */
// Exported for Job_Processor (Task 3.1)
export function saveSearchToUser(
  uid: string,
  search: { query: string; location: string; category: string; radius: number; cids: string[]; cost?: CostBreakdown | null },
): void {
  const ref = db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection("searches")
    .doc();

  ref
    .set({
      ...search,
      resultCount: search.cids.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    .catch((err) => {
      console.error("[user] failed to save search:", err);
    });

  // Increment running totals on the admin stats doc (fire-and-forget)
  if (search.cost) {
    const statsRef = db.collection("admin").doc("stats");
    statsRef.set({
      totalSearches: admin.firestore.FieldValue.increment(1),
      totalResultCount: admin.firestore.FieldValue.increment(search.cids.length),
      totalDfsCost: admin.firestore.FieldValue.increment(search.cost.totalDfs ?? 0),
      totalBusinessSearch: admin.firestore.FieldValue.increment(search.cost.businessSearch ?? 0),
      totalInstantPages: admin.firestore.FieldValue.increment(search.cost.instantPages ?? 0),
      totalLighthouse: admin.firestore.FieldValue.increment(search.cost.lighthouse ?? 0),
      totalCachedBusinesses: admin.firestore.FieldValue.increment(search.cost.cachedBusinesses ?? 0),
      totalFreshBusinesses: admin.firestore.FieldValue.increment(search.cost.freshBusinesses ?? 0),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err) => {
      console.error("[admin] failed to update stats:", err);
    });
  }

  console.log(`[user] saving search for ${uid} with ${search.cids.length} CIDs`);
}

// ─── Input Validation Helpers ─────────────────────────────────────────────────

import { sanitizeString, MAX_KEYWORD_LEN, MAX_LOCATION_LEN } from "./validation";

// ─── Firestore Cache Helpers ──────────────────────────────────────────────────

const BUSINESSES_COLLECTION = "businesses";

/**
 * Look up cached ScoredBusiness docs by CID.
 * Returns a Map of cid → ScoredBusiness for any that exist.
 */
async function getCachedBusinesses(cids: string[]): Promise<Map<string, ScoredBusiness>> {
  const cached = new Map<string, ScoredBusiness>();
  if (cids.length === 0) return cached;

  // Firestore getAll supports up to 100 refs at a time
  const batches: string[][] = [];
  for (let i = 0; i < cids.length; i += 100) {
    batches.push(cids.slice(i, i + 100));
  }

  for (const batch of batches) {
    const refs = batch.map((cid) => db.collection(BUSINESSES_COLLECTION).doc(cid));
    const snapshots = await db.getAll(...refs);
    for (const snap of snapshots) {
      if (snap.exists) {
        const data = snap.data() as ScoredBusiness;
        cached.set(snap.id, data);
      }
    }
  }

  console.log(`[cache] looked up ${cids.length} CIDs, found ${cached.size} cached`);
  return cached;
}

/**
 * Save scored businesses to Firestore (fire-and-forget).
 * Only saves businesses that have a non-null cid.
 */
// Exported for Job_Processor (Task 3.1)
export function saveBusinessesToCache(businesses: ScoredBusiness[]): void {
  const toSave = businesses.filter((b) => b.cid);
  if (toSave.length === 0) return;

  // Firestore batch supports up to 500 writes
  const batchSize = 500;
  for (let i = 0; i < toSave.length; i += batchSize) {
    const chunk = toSave.slice(i, i + batchSize);
    const batch = db.batch();
    for (const biz of chunk) {
      const ref = db.collection(BUSINESSES_COLLECTION).doc(biz.cid as string);
      batch.set(ref, {
        ...biz,
        _cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    batch.commit().catch((err) => {
      console.error("[cache] batch write failed:", err);
    });
  }

  console.log(`[cache] saving ${toSave.length} businesses to Firestore`);
}

// ─── Rate Limiting (Firestore-backed, per-user) ───────────────────────────────
// Keyed by uid so limits are consistent across all function instances.
// Each counter doc lives at: rateLimits/{uid}_{fn} and expires after the window.

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Returns null if the request is allowed, or the resetAt timestamp (ms) if
 * the user has exceeded `maxRequests` calls to `fnName` within the window.
 */
async function checkRateLimit(uid: string, fnName: string, maxRequests: number): Promise<number | null> {
  const key = `${uid}_${fnName}`;
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  try {
    const resetAtMs = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()!.resetAt.toMillis() <= now) {
        tx.set(ref, {
          count: 1,
          resetAt: Timestamp.fromMillis(now + RATE_LIMIT_WINDOW_MS),
        });
        return null;
      }
      const count: number = snap.data()!.count;
      const resetAt: number = snap.data()!.resetAt.toMillis();
      if (count >= maxRequests) return resetAt;
      tx.update(ref, { count: count + 1 });
      return null;
    });
    return resetAtMs;
  } catch (err) {
    console.error(`[rateLimit] Firestore error for uid=${uid} fn=${fnName}:`, err);
    return null; // fail open
  }
}

/** Send a 429 with Retry-After header and retryAfter seconds in the body. */
function replyRateLimited(res: functions.Response, resetAtMs: number): void {
  const retryAfter = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  res.set("Retry-After", String(retryAfter));
  res.status(429).json({ error: "Too many requests. Please wait a moment.", retryAfter });
}

// ─── DataForSEO Business Search ───────────────────────────────────────────────

// Helper: build ScorerInput from a BusinessRaw + optional enrichment data
// Exported for Job_Processor (Task 3.1)
export function buildScorerInput(
  b: BusinessRaw,
  overrides: {
    website?: string | null;
    htmlSignals?: ScorerInput["htmlSignals"];
    lighthousePerformance?: number | null;
    lighthouseSeo?: number | null;
    domainAgeYears?: number | null;
    isExpiredDomain?: boolean;
  } = {}
): ScorerInput {
  const socialTypes = ["facebook", "instagram", "twitter", "linkedin", "youtube", "pinterest", "tiktok"];
  const contacts = b.contact_info ?? [];
  const socialContacts = contacts.filter((c) => socialTypes.includes(c.type));

  // Business hours: timetable is non-null and has at least one day entry
  const timetable = b.work_time?.work_hours?.timetable;
  const hasBusinessHours = !!(timetable && Object.keys(timetable).length > 0);

  // people_also_search: non-empty array means Google considers this a real entity
  const hasPeopleAlsoSearch = !!(b.people_also_search && b.people_also_search.length > 0);

  // place_topics: extracted from review content by Google
  const hasPlaceTopics = !!(b.place_topics && Object.keys(b.place_topics).length > 0);

  return {
    website: overrides.website ?? b.url ?? null,
    htmlSignals: overrides.htmlSignals ?? null,
    lighthousePerformance: overrides.lighthousePerformance ?? null,
    lighthouseSeo: overrides.lighthouseSeo ?? null,
    domainAgeYears: overrides.domainAgeYears ?? null,
    isExpiredDomain: overrides.isExpiredDomain ?? false,
    phone: b.phone,
    isClaimed: b.is_claimed,
    currentStatus: b.work_time?.work_hours?.current_status ?? null,
    permanentlyClosed: b.work_time?.work_hours?.current_status === "closed_forever",
    reviewCount: b.rating?.votes_count ?? null,
    rating: b.rating?.value ?? null,
    ratingDistribution: b.rating_distribution,
    firstSeen: b.first_seen,
    // Legitimacy signals
    totalPhotos: b.total_photos,
    hasFacebookLink: socialContacts.some((c) => c.type === "facebook"),
    socialLinkCount: socialContacts.length,
    hasLogo: !!b.logo,
    hasMainImage: !!b.main_image,
    hasAttributes: !!(b.attributes?.available_attributes && Object.keys(b.attributes.available_attributes).length > 0),
    hasDescription: !!b.description,
    hasBusinessHours,
    address: b.address,
    // Future: reviews API
    daysSinceLastReview: null,
    hasOwnerResponses: false,
    // Bonus signals
    hasPeopleAlsoSearch,
    hasPlaceTopics,
  };
}

// ─── Auth Trigger: Assign default role on account creation ──────────────────

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  console.log(`[onUserCreate] TRIGGERED uid=${user.uid} email=${user.email ?? "none"} provider=${user.providerData.map((p) => p.providerId).join(",")}`);

  // 1. Set the custom claim so the frontend can gate on role.
  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: "user" });
    console.log(`[onUserCreate] custom claim set uid=${user.uid}`);
  } catch (err) {
    console.error(`[onUserCreate] FAILED to set custom claim uid=${user.uid}`, err);
    throw err; // propagate so Cloud Functions retries
  }

  // Do NOT revoke tokens here — the claim will be picked up on next natural
  // token refresh. Revoking immediately after signup breaks the new user's session.

  // 2. Write the full user profile document using the UserRecord we already
  //    have — no redundant getUser() call, no silent swallowing of errors.
  await createUserProfile(user);

  console.log(`[onUserCreate] COMPLETE uid=${user.uid}`);
});

export const dataforseoBusinessSearch = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      // ── Method check ──
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      // ── Auth check ──
      let decodedToken: admin.auth.DecodedIdToken;
      try {
        decodedToken = await verifyUserRole(req);
      } catch {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
        return;
      }

      const uid = decodedToken.uid;

      // Ensure user profile exists (must complete before credit check)
      await ensureUserProfile(uid);

      // ── Rate limiting ──
      const rateLimitReset = await checkRateLimit(uid, "search", 3);
      if (rateLimitReset !== null) {
        replyRateLimited(res, rateLimitReset);
        return;
      }

      // ── Input validation & sanitization ──
      const rawKeyword = req.body?.keyword;
      const rawLocation = req.body?.location;
      const rawRadius = req.body?.radius;

      const keyword = sanitizeString(rawKeyword, MAX_KEYWORD_LEN);
      const location = sanitizeString(rawLocation, MAX_LOCATION_LEN);

      if (!keyword) {
        res.status(400).json({ error: "Missing or invalid field: keyword (letters, numbers, basic punctuation only)" });
        return;
      }
      if (!location) {
        res.status(400).json({ error: "Missing or invalid field: location (letters, numbers, basic punctuation only)" });
        return;
      }

      // Radius: default 10 miles, clamp to 1–100
      const radiusMiles = typeof rawRadius === "number"
        ? Math.max(1, Math.min(100, rawRadius))
        : 10;

      // Limit: default 50, clamp to 1–500
      const rawLimit = req.body?.limit;
      const limit = typeof rawLimit === "number"
        ? Math.max(1, Math.min(500, Math.round(rawLimit)))
        : 50;

      // ── Compute deterministic job ID and create job document ──
      const jobId = computeJobId(uid, keyword, location, radiusMiles);
      const jobRef = db.collection("jobs").doc(jobId);

      const now = Date.now();
      const jobData: JobDocument = {
        uid,
        status: "running",
        params: { keyword, location, radius: radiusMiles, limit },
        progress: { analyzed: 0, total: 0 },
        resultCount: null,
        error: null,
        cost: null,
        createdAt: Timestamp.fromMillis(now),
        updatedAt: Timestamp.fromMillis(now),
        ttl: Timestamp.fromMillis(now + 24 * 60 * 60 * 1000),
      };

      // ── Credit check & deduction (atomic) ──
      // Performed AFTER input validation but BEFORE job creation so we don't
      // charge for invalid requests. The credit is deducted inside a transaction
      // that also verifies the user has sufficient credits.
      //
      // We must also handle job deduplication: if the same search is already
      // running, we return the existing jobId without charging again.
      const userRef = db.collection(USERS_COLLECTION).doc(uid);

      // Pre-flight credit check (read-only) — reject early before creating any job.
      {
        const snap = await userRef.get();
        if (!snap.exists) {
          res.status(402).json({ error: "Insufficient credits. Please upgrade your plan.", code: "INSUFFICIENT_CREDITS" });
          return;
        }
        const data = snap.data()!;
        const sub = data.subscription as Subscription | undefined;
        const creditsUsed = sub?.creditsUsed ?? 0;
        const creditsTotal = sub?.creditsTotal ?? (data.credits as number | undefined) ?? 0;
        if (creditsUsed >= creditsTotal) {
          res.status(402).json({ error: "Insufficient credits. Please upgrade your plan.", code: "INSUFFICIENT_CREDITS" });
          return;
        }
      }

      // ── Create or reuse job ──
      try {
        const result = await createOrReuseJob(jobId, jobData, jobRef as unknown as import("./jobHelpers").JobDocRef, deleteResultsSubcollection);
        if (result.isExisting) {
          // Duplicate running job — return existing ID without charging
          console.log(`[Job_Creator] Returning existing running job ${jobId} (no credit charged)`);
          res.status(200).json({ jobId });
          return;
        }
      } catch (err: unknown) {
        console.error("[Job_Creator] Firestore error:", err);
        res.status(500).json({ error: "An unexpected error occurred. Please try again." });
        return;
      }

      // ── Atomic credit deduction (new job only) ──
      // The pre-flight check above was a non-transactional read. Two concurrent
      // requests could both pass it. This transaction is the authoritative gate.
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(userRef);
          if (!snap.exists) {
            throw new Error("INSUFFICIENT_CREDITS");
          }
          const data = snap.data()!;
          const sub = data.subscription as Subscription | undefined;
          const creditsUsed = sub?.creditsUsed ?? 0;
          const creditsTotal = sub?.creditsTotal ?? (data.credits as number | undefined) ?? 0;
          if (creditsUsed >= creditsTotal) {
            throw new Error("INSUFFICIENT_CREDITS");
          }
          tx.update(userRef, {
            "subscription.creditsUsed": admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (err) {
        if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
          // Roll back: delete the job so the onCreate processor doesn't run a
          // search the user can't pay for. The processor handles missing docs
          // gracefully (its jobRef.update calls will fail and it exits).
          await deleteResultsSubcollection(jobId);
          await jobRef.delete().catch((delErr) => {
            console.error(`[credits] Failed to roll back job ${jobId}:`, delErr);
          });
          res.status(402).json({ error: "Insufficient credits. Please upgrade your plan.", code: "INSUFFICIENT_CREDITS" });
          return;
        }
        console.error("[credits] Transaction failed:", err);
        res.status(500).json({ error: "An unexpected error occurred. Please try again." });
        return;
      }

      console.log(`[credits] Deducted 1 credit for uid=${uid}`);
      console.log(`[Job_Creator] Created new job ${jobId} for uid=${uid}`);
      res.status(200).json({ jobId });
    });
  });

// ─── Job_Processor: Firestore onCreate trigger ───────────────────────────────

/**
 * Write scored business results to the results subcollection.
 * Each result doc uses the CID as its document ID and includes the uid for security rules.
 */
async function writeResultsBatch(
  jobId: string,
  uid: string,
  businesses: ScoredBusiness[]
): Promise<number> {
  const toWrite = businesses.filter((b) => b.cid);
  if (toWrite.length === 0) return 0;

  console.log(`[Job_Processor] Writing ${toWrite.length} results to jobs/${jobId}/results`);

  const batchSize = 500;
  for (let i = 0; i < toWrite.length; i += batchSize) {
    const chunk = toWrite.slice(i, i + batchSize);
    const batch = db.batch();
    for (const biz of chunk) {
      const ref = db.collection("jobs").doc(jobId).collection("results").doc(biz.cid as string);
      batch.set(ref, { ...biz, uid });
    }
    await batch.commit();
  }

  return toWrite.length;
}

/**
 * Update the job document with progress and updatedAt timestamp.
 */
async function updateJobProgress(
  jobId: string,
  analyzed: number,
  total: number
): Promise<void> {
  await db.collection("jobs").doc(jobId).update({
    progress: { analyzed, total },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Score a batch of businesses that have no website.
 */
function scoreNoWebsiteBatch(businesses: BusinessRaw[]): ScoredBusiness[] {
  return businesses.map((b) => {
    const input = buildScorerInput(b, { website: null });
    const { score: s, label, scoring } = score(input);
    const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
    return {
      cid: b.cid,
      name: b.title,
      address: b.address,
      phone: b.phone,
      website: null,
      rating: b.rating?.value ?? null,
      reviewCount: b.rating?.votes_count ?? null,
      category: b.category,
      score: s,
      label,
      scoring,
      legitimacyScore,
      legitimacyBreakdown,
      businessData: extractBusinessData(b),
      websiteData: null,
    };
  });
}

/**
 * Score a batch of businesses with their HTML signals (dead-site or parked).
 */
function scoreWithSignals(
  businesses: BusinessRaw[],
  signalsMap: Map<string, import("./types").HtmlSignals>,
  rdapMap: Map<string, import("./rdap").DomainInfo>,
  lighthouseMap: Map<string, { performance: number; seo: number }>
): ScoredBusiness[] {
  return businesses.map((b) => {
    const url = b.url ?? "";
    const htmlSignals = signalsMap.get(url) ?? null;
    const domain = b.domain ?? "";
    const rdap = rdapMap.get(domain);
    const lh = lighthouseMap.get(url);

    const input = buildScorerInput(b, {
      website: b.url,
      htmlSignals,
      lighthousePerformance: lh?.performance ?? null,
      lighthouseSeo: lh?.seo ?? null,
      domainAgeYears: rdap?.ageYears ?? null,
      isExpiredDomain: rdap?.isExpired ?? false,
    });

    const { score: s, label, scoring } = score(input);
    const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);

    return {
      cid: b.cid,
      name: b.title,
      address: b.address,
      phone: b.phone,
      website: b.url,
      rating: b.rating?.value ?? null,
      reviewCount: b.rating?.votes_count ?? null,
      category: b.category,
      score: s,
      label,
      scoring,
      legitimacyScore,
      legitimacyBreakdown,
      businessData: extractBusinessData(b),
      websiteData: htmlSignals,
    };
  });
}

export const processSearchJob = functions
  .runWith({ timeoutSeconds: 300 })
  .firestore.document("jobs/{jobId}")
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const jobData = snap.data() as JobDocument;
    const { uid, params } = jobData;
    const { keyword, location, radius: radiusMiles, limit: searchLimit } = params;
    const jobRef = db.collection("jobs").doc(jobId);

    console.log(`[Job_Processor] Starting job ${jobId} for uid=${uid}`);

    const cost: CostBreakdown = {
      businessSearch: 0,
      instantPages: 0,
      lighthouse: 0,
      totalDfs: 0,
      firestoreReads: 0,
      firestoreWrites: 0,
      cachedBusinesses: 0,
      freshBusinesses: 0,
    };

    try {
      // ── Step 1: Geocode ──
      const DFS_EMAIL = process.env.DFS_EMAIL;
      const DFS_PASSWORD = process.env.DFS_PASSWORD;
      if (!DFS_EMAIL || !DFS_PASSWORD) {
        await jobRef.update({
          status: "failed",
          error: "Server configuration error",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const authHeader = buildAuthHeader(DFS_EMAIL, DFS_PASSWORD);

      let geo: { lat: number; lng: number };
      try {
        const geoResult = await geocodeLocation(location);
        geo = { lat: geoResult.lat, lng: geoResult.lng };
      } catch (geoErr) {
        const msg = geoErr instanceof Error ? geoErr.message : "Geocoding failed";
        await jobRef.update({
          status: "failed",
          error: msg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const radiusKm = milesToKm(radiusMiles);
      const locationCoord = buildLocationCoordinate(geo.lat, geo.lng, radiusKm);

      // ── Step 2: DFS Business Search ──
      let dfsItems: BusinessRaw[];
      try {
        const dfsResult = await searchBusinesses(keyword, locationCoord, authHeader, searchLimit ?? 50);
        dfsItems = dfsResult.items;
        cost.businessSearch = dfsResult.cost;
      } catch (dfsErr) {
        const msg = dfsErr instanceof Error ? dfsErr.message : "DataForSEO business search failed";
        await jobRef.update({
          status: "failed",
          error: msg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // ── Zero results: complete immediately ──
      if (dfsItems.length === 0) {
        console.log(`[Job_Processor] Job ${jobId}: DFS returned 0 businesses, completing immediately`);
        cost.totalDfs = cost.businessSearch;
        await jobRef.update({
          status: "completed",
          progress: { analyzed: 0, total: 0 },
          resultCount: 0,
          cost,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Job_Processor] Job ${jobId} completed with 0 results`);
        return;
      }

      const totalBusinesses = dfsItems.length;

      console.log(`[Job_Processor] Job ${jobId}: DFS returned ${totalBusinesses} businesses`);

      // Write initial progress: 0 analyzed out of N total
      await updateJobProgress(jobId, 0, totalBusinesses);

      // ── Check cancellation after DFS search ──
      if (await isJobCancelled(jobId)) {
        await jobRef.update({
          status: "cancelled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Job_Processor] Job ${jobId} cancelled after DFS search`);
        return;
      }

      // ── Step 3: Split businesses into batches ──
      // Check cache first
      const allCids = dfsItems.filter((b) => b.cid).map((b) => b.cid as string);
      const cachedMap = await getCachedBusinesses(allCids);
      cost.firestoreReads += allCids.length;
      cost.cachedBusinesses = cachedMap.size;

      console.log(`[Job_Processor] Job ${jobId}: ${cachedMap.size} cached, ${dfsItems.length - cachedMap.size} fresh`);

      // Separate cached vs fresh businesses
      const cachedBusinesses: ScoredBusiness[] = [];
      const freshItems: BusinessRaw[] = [];
      for (const b of dfsItems) {
        if (b.cid && cachedMap.has(b.cid)) {
          cachedBusinesses.push(cachedMap.get(b.cid)!);
        } else {
          freshItems.push(b);
        }
      }
      cost.freshBusinesses = freshItems.length;

      let totalResultsWritten = 0;
      let analyzed = 0;

      // Write cached results immediately
      if (cachedBusinesses.length > 0) {
        const written = await writeResultsBatch(jobId, uid, cachedBusinesses);
        totalResultsWritten += written;
        analyzed += cachedBusinesses.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);
      }

      // Split fresh businesses into: no-website, has-website
      const noWebsite = freshItems.filter((b) => !b.url);
      const hasWebsite = freshItems.filter((b) => !!b.url);

      // ── Batch 1: No-website businesses ──
      if (noWebsite.length > 0) {
        const scored = scoreNoWebsiteBatch(noWebsite);
        const written = await writeResultsBatch(jobId, uid, scored);
        totalResultsWritten += written;
        analyzed += noWebsite.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);

        // Save to cache (fire-and-forget)
        saveBusinessesToCache(scored);
        cost.firestoreWrites += scored.filter((b) => b.cid).length;

        // Check cancellation
        if (await isJobCancelled(jobId)) {
          await jobRef.update({
            status: "cancelled",
            resultCount: totalResultsWritten,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[Job_Processor] Job ${jobId} cancelled after no-website batch`);
          return;
        }
      }

      if (hasWebsite.length === 0) {
        // All businesses had no website — complete
        cost.totalDfs = cost.businessSearch;
        await jobRef.update({
          status: "completed",
          progress: { analyzed: totalBusinesses, total: totalBusinesses },
          resultCount: totalResultsWritten,
          cost,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Fire-and-forget: save search to user
        const allCidsForSearch = [...cachedBusinesses, ...scoreNoWebsiteBatch(noWebsite)]
          .filter((b) => b.cid)
          .map((b) => b.cid as string);
        saveSearchToUser(uid, {
          query: keyword,
          location,
          category: keyword,
          radius: radiusMiles,
          cids: allCidsForSearch,
          cost,
        });

        console.log(`[Job_Processor] Job ${jobId} completed with ${totalResultsWritten} results`);
        return;
      }

      // ── Step 4: Fetch Instant Pages for all websites ──
      // Skip web analysis for businesses with a low legitimacy score — not worth the cost.
      const LEGIT_SCORE_WEB_THRESHOLD = 30;
      const lowLegitBusinesses: BusinessRaw[] = [];
      const webEligible: BusinessRaw[] = [];
      for (const b of hasWebsite) {
        const input = buildScorerInput(b, { website: b.url });
        const { legitimacyScore } = computeLegitimacy(input);
        if (legitimacyScore < LEGIT_SCORE_WEB_THRESHOLD) {
          lowLegitBusinesses.push(b);
        } else {
          webEligible.push(b);
        }
      }

      // Score low-legit businesses without web signals and flush them now
      if (lowLegitBusinesses.length > 0) {
        console.log(`[Job_Processor] Job ${jobId}: skipping web analysis for ${lowLegitBusinesses.length} low-legit businesses`);
        const scored = scoreNoWebsiteBatch(lowLegitBusinesses);
        const written = await writeResultsBatch(jobId, uid, scored);
        totalResultsWritten += written;
        analyzed += lowLegitBusinesses.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);
        saveBusinessesToCache(scored);
        cost.firestoreWrites += scored.filter((b) => b.cid).length;
      }

      const websiteUrls = webEligible.map((b) => b.url!);
      const { signals: htmlSignals, cost: ipCost } = await fetchInstantPages(websiteUrls, authHeader);
      cost.instantPages = ipCost;

      // Build signals map
      const signalsMap = new Map<string, import("./types").HtmlSignals>();
      for (let i = 0; i < websiteUrls.length; i++) {
        signalsMap.set(websiteUrls[i], htmlSignals[i]);
      }

      // ── Split has-website businesses into: dead-site, parked, non-parked ──
      const deadSite: BusinessRaw[] = [];
      const parked: BusinessRaw[] = [];
      const nonParked: BusinessRaw[] = [];

      for (const b of webEligible) {
        const url = b.url!;
        const sig = signalsMap.get(url);
        if (!sig) {
          deadSite.push(b);
        } else if (sig.fetchFailed) {
          deadSite.push(b);
        } else if (isParkedDomain(sig)) {
          parked.push(b);
        } else {
          nonParked.push(b);
        }
      }

      // Check cancellation after Instant Pages
      if (await isJobCancelled(jobId)) {
        await jobRef.update({
          status: "cancelled",
          resultCount: totalResultsWritten,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Job_Processor] Job ${jobId} cancelled after Instant Pages`);
        return;
      }

      // ── Batch 2: Dead-site businesses ──
      if (deadSite.length > 0) {
        const emptyRdap = new Map<string, import("./rdap").DomainInfo>();
        const emptyLh = new Map<string, { performance: number; seo: number }>();
        const scored = scoreWithSignals(deadSite, signalsMap, emptyRdap, emptyLh);
        const written = await writeResultsBatch(jobId, uid, scored);
        totalResultsWritten += written;
        analyzed += deadSite.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);

        saveBusinessesToCache(scored);
        cost.firestoreWrites += scored.filter((b) => b.cid).length;
      }

      // ── Batch 3: Parked businesses ──
      if (parked.length > 0) {
        const emptyRdap = new Map<string, import("./rdap").DomainInfo>();
        const emptyLh = new Map<string, { performance: number; seo: number }>();
        const scored = scoreWithSignals(parked, signalsMap, emptyRdap, emptyLh);
        const written = await writeResultsBatch(jobId, uid, scored);
        totalResultsWritten += written;
        analyzed += parked.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);

        saveBusinessesToCache(scored);
        cost.firestoreWrites += scored.filter((b) => b.cid).length;

        // Check cancellation after dead-site + parked batches
        if (await isJobCancelled(jobId)) {
          await jobRef.update({
            status: "cancelled",
            resultCount: totalResultsWritten,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[Job_Processor] Job ${jobId} cancelled after dead-site/parked batches`);
          return;
        }
      }

      // ── Batch 4: Non-parked businesses (Lighthouse + RDAP) ──
      if (nonParked.length > 0) {
        const nonParkedUrls = nonParked.map((b) => b.url!);
        const nonParkedDomains = nonParked
          .map((b) => b.domain)
          .filter((d): d is string => !!d);

        // Lighthouse
        const { scores: lhScores, cost: lhCost } = await fetchLighthouse(nonParkedUrls, authHeader);
        cost.lighthouse = lhCost;

        const lighthouseMap = new Map<string, { performance: number; seo: number }>();
        for (let i = 0; i < nonParkedUrls.length; i++) {
          if (lhScores[i]) {
            lighthouseMap.set(nonParkedUrls[i], lhScores[i]!);
          }
        }

        // RDAP domain lookups
        const rdapMap = new Map<string, import("./rdap").DomainInfo>();
        const uniqueDomains = [...new Set(nonParkedDomains)];
        const rdapResults = await Promise.allSettled(
          uniqueDomains.map((d) => lookupDomainInfo(d))
        );
        for (let i = 0; i < uniqueDomains.length; i++) {
          if (rdapResults[i].status === "fulfilled") {
            rdapMap.set(uniqueDomains[i], (rdapResults[i] as PromiseFulfilledResult<import("./rdap").DomainInfo>).value);
          }
        }

        const scored = scoreWithSignals(nonParked, signalsMap, rdapMap, lighthouseMap);
        const written = await writeResultsBatch(jobId, uid, scored);
        totalResultsWritten += written;
        analyzed += nonParked.length;
        await updateJobProgress(jobId, analyzed, totalBusinesses);

        saveBusinessesToCache(scored);
        cost.firestoreWrites += scored.filter((b) => b.cid).length;
      }

      // ── Completion ──
      cost.totalDfs = cost.businessSearch + cost.instantPages + cost.lighthouse;

      console.log(`[Job_Processor] Job ${jobId}: completing with ${totalResultsWritten} results, analyzed=${analyzed}/${totalBusinesses}`);

      await jobRef.update({
        status: "completed",
        progress: { analyzed: totalBusinesses, total: totalBusinesses },
        resultCount: totalResultsWritten,
        cost,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Fire-and-forget: save search to user's history
      const allResultCids = allCids.length > 0 ? allCids : [];
      saveSearchToUser(uid, {
        query: keyword,
        location,
        category: keyword,
        radius: radiusMiles,
        cids: allResultCids,
        cost,
      });

      console.log(`[Job_Processor] Job ${jobId} completed with ${totalResultsWritten} results`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred";
      console.error(`[Job_Processor] Job ${jobId} failed:`, err);
      try {
        await jobRef.update({
          status: "failed",
          error: msg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateErr) {
        console.error(`[Job_Processor] Failed to update job ${jobId} status:`, updateErr);
      }
    }
  });

// ─── Job_Canceller: Cancel a running search job ──────────────────────────────

export const cancelSearchJob = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // ── Method check ──
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // ── Auth check ──
    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;

    // ── Read jobId from request body ──
    const jobId = req.body?.jobId;
    if (!jobId || typeof jobId !== "string" || jobId.length > 128) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    // ── Cancel the job via extracted logic ──
    const jobRef = db.collection("jobs").doc(jobId);
    const result = await cancelJob(uid, {
      get: async () => {
        const snap = await jobRef.get();
        return { exists: snap.exists, data: () => snap.data() as JobDocument | undefined };
      },
      update: async (data) => {
        await jobRef.update({
          ...data,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      },
    });

    switch (result.outcome) {
      case "not_found":
        res.status(404).json({ error: "Job not found" });
        return;
      case "forbidden":
        res.status(403).json({ error: "Forbidden" });
        return;
      case "not_running":
        res.status(409).json({ error: "Job is not running" });
        return;
      case "cancelled":
        res.status(200).json({ success: true });
        return;
    }
  });
});


// ─── Reconstruct ScorerInput from a cached ScoredBusiness ─────────────────────
// Used by recalculateBusinessRank to re-score existing businesses without
// re-fetching from DataForSEO. Fields only available on BusinessRaw
// (hasBusinessHours, hasAttributes, permanentlyClosed, hasPeopleAlsoSearch)
// are approximated from what's stored.

function scorerInputFromCached(biz: ScoredBusiness): ScorerInput {
  const bd = biz.businessData;
  const sc = biz.scoring;
  const socialLinks = bd?.socialLinks ?? [];

  // Prefer full websiteData; fall back to reconstructing a minimal HtmlSignals
  // stub from the scoring breakdown (statusCode/fetchFailed are stored there too).
  let htmlSignals: ScorerInput["htmlSignals"] = biz.websiteData ?? null;
  // Correct stale data: old records stored 403s with fetchFailed=true before the
  // dfsClient fix. A 403 means the server responded — it is never a fetch failure.
  if (htmlSignals !== null && htmlSignals.statusCode === 403 && htmlSignals.fetchFailed) {
    htmlSignals = { ...htmlSignals, fetchFailed: false };
  }
  if (htmlSignals === null && sc !== null && sc.statusCode !== null) {
    htmlSignals = {
      statusCode: sc.statusCode,
      fetchFailed: sc.statusCode === 403 ? false : (sc.fetchFailed ?? true),
      onpageScore: sc.onpageScore ?? null,
      totalDomSize: null,
      pageSize: null,
      encodedSize: null,
      server: null,
      contentEncoding: null,
      mediaType: null,
      finalUrl: null,
      isHttps: sc.isHttps ?? (biz.website?.startsWith("https://") ?? false),
      redirectedToHttps: false,
      wordCount: sc.wordCount ?? 0,
      hasMetaDescription: sc.hasMetaDescription ?? false,
      hasFavicon: sc.hasFavicon ?? false,
      deprecatedTagCount: 0,
      copyrightYear: null,
      headerText: "",
      footerText: "",
      hasAdPixel: false,
      hasAgencyFooter: false,
      hasBrokenResources: false,
      hasBrokenLinks: false,
      lastModifiedHeader: null,
      lastModifiedSitemap: null,
      lastModifiedMetaTag: null,
      pageTiming: null,
      pageMeta: null,
      pageChecks: null,
    };
  }

  return {
    website: biz.website,
    htmlSignals,
    lighthousePerformance: sc?.lighthousePerformance ?? null,
    lighthouseSeo: sc?.lighthouseSeo ?? null,
    domainAgeYears: sc?.domainAgeYears ?? null,
    isExpiredDomain: sc?.isExpiredDomain ?? false,
    phone: biz.phone,
    isClaimed: bd?.isClaimed ?? false,
    currentStatus: bd?.currentStatus ?? null,
    permanentlyClosed: bd?.permanentlyClosed ?? false, // now persisted on BusinessData
    reviewCount: biz.reviewCount,
    rating: biz.rating,
    ratingDistribution: bd?.ratingDistribution ?? null,
    firstSeen: bd?.firstSeen ?? null,
    totalPhotos: bd?.totalPhotos ?? null,
    hasFacebookLink: socialLinks.some((l) => l.type === "facebook"),
    socialLinkCount: socialLinks.length,
    hasLogo: !!bd?.logo,
    hasMainImage: !!bd?.mainImage,
    hasAttributes: false, // not stored on BusinessData; conservative default
    hasDescription: !!bd?.description,
    hasBusinessHours: false, // not stored on BusinessData; conservative default
    address: biz.address,
    daysSinceLastReview: null, // future: reviews API
    hasOwnerResponses: false, // future: reviews API
    hasPeopleAlsoSearch: false, // not stored on BusinessData; conservative default
    hasPlaceTopics: !!(bd?.placeTopics && Object.keys(bd.placeTopics).length > 0),
  };
}

// ─── Re-evaluate a single business: full DFS/Lighthouse re-fetch ──────────────

export const reevaluateBusiness = functions
  .runWith({ timeoutSeconds: 120 })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      try {
        await verifyAdmin(req, "reevaluateBusiness");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "UNAUTHENTICATED") {
          res.status(401).json({ error: "Unauthorized. Please sign in." });
        } else {
          res.status(403).json({ error: "Forbidden. Admin role required." });
        }
        return;
      }

      const cid = req.body?.cid;
      if (!cid || typeof cid !== "string" || cid.length > 50) {
        res.status(400).json({ error: "Missing required field: cid" });
        return;
      }

      const DFS_EMAIL = process.env.DFS_EMAIL;
      const DFS_PASSWORD = process.env.DFS_PASSWORD;
      if (!DFS_EMAIL || !DFS_PASSWORD) {
        res.status(500).json({ error: "Server configuration error" });
        return;
      }

      // Load cached business
      const cached = await getCachedBusinesses([cid]);
      const biz = cached.get(cid);
      if (!biz) {
        res.status(404).json({ error: "Business not found in cache" });
        return;
      }

      const authHeader = buildAuthHeader(DFS_EMAIL, DFS_PASSWORD);
      const website = biz.website;

      let updatedBiz: ScoredBusiness;

      if (!website) {
        // No website — just re-score from cached signals
        const input = scorerInputFromCached(biz);
        const { score: s, label, scoring } = score(input);
        const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
        updatedBiz = { ...biz, score: s, label, scoring, legitimacyScore, legitimacyBreakdown };
      } else {
        // Re-fetch instant pages
        const { signals, cost: ipCost } = await fetchInstantPages([website], authHeader);
        // fetchInstantPages guarantees a signal per URL, but guard defensively
        const htmlSignals = signals[0] ?? deadSiteSignals(website, null);
        console.log(`[reevaluateBusiness] ${cid} (${website}): fetchFailed=${htmlSignals.fetchFailed} statusCode=${htmlSignals.statusCode} cost=${ipCost}`);

        const signalsMap = new Map([[website, htmlSignals]]);

        let lighthouseMap = new Map<string, { performance: number; seo: number }>();
        let rdapMap = new Map<string, import("./rdap").DomainInfo>();

        // Only run Lighthouse + RDAP if the site is reachable and not parked
        if (!htmlSignals.fetchFailed && !isParkedDomain(htmlSignals)) {
          const [lhResult, rdapResult] = await Promise.allSettled([
            fetchLighthouse([website], authHeader),
            biz.businessData?.city != null
              ? lookupDomainInfo(new URL(website).hostname).catch(() => null)
              : Promise.resolve(null),
          ]);

          if (lhResult.status === "fulfilled" && lhResult.value.scores[0]) {
            lighthouseMap.set(website, lhResult.value.scores[0]);
            console.log(`[reevaluateBusiness] ${cid}: lighthouse perf=${lhResult.value.scores[0].performance} seo=${lhResult.value.scores[0].seo}`);
          }
          if (rdapResult.status === "fulfilled" && rdapResult.value) {
            const domain = new URL(website).hostname;
            rdapMap.set(domain, rdapResult.value);
          }
        }

        // Build a minimal BusinessRaw-compatible stub from cached data
        const bd = biz.businessData;
        const bizRawStub: BusinessRaw = {
          title: biz.name,
          description: bd?.description ?? null,
          address: biz.address,
          address_info: null,
          phone: biz.phone,
          domain: (() => { try { return new URL(website).hostname; } catch { return null; } })(),
          url: website,
          rating: biz.rating != null ? { value: biz.rating, votes_count: biz.reviewCount } : null,
          rating_distribution: bd?.ratingDistribution ?? null,
          category: biz.category,
          category_ids: null,
          additional_categories: bd?.additionalCategories ?? null,
          is_claimed: bd?.isClaimed ?? false,
          price_level: bd?.priceLevel ?? null,
          total_photos: bd?.totalPhotos ?? null,
          attributes: null,
          work_time: bd?.currentStatus ? { work_hours: { timetable: null, current_status: bd.currentStatus } } : null,
          contact_info: (bd?.socialLinks ?? []).map((l) => ({ type: l.type, value: l.value, source: "cached" })),
          people_also_search: null,
          place_topics: bd?.placeTopics ?? null,
          logo: bd?.logo ?? null,
          main_image: bd?.mainImage ?? null,
          last_updated_time: bd?.lastUpdatedTime ?? null,
          first_seen: bd?.firstSeen ?? null,
          check_url: bd?.checkUrl ?? null,
          cid,
          feature_id: null,
          place_id: null,
          latitude: bd?.latitude ?? null,
          longitude: bd?.longitude ?? null,
        };

        const [scored] = scoreWithSignals([bizRawStub], signalsMap, rdapMap, lighthouseMap);
        updatedBiz = scored;
      }

      // Overwrite cache
      if (updatedBiz.cid) {
        await db.collection(BUSINESSES_COLLECTION).doc(updatedBiz.cid).set(updatedBiz, { merge: false });
        console.log(`[reevaluateBusiness] ${cid}: updated cache → label=${updatedBiz.label} score=${updatedBiz.score}`);
      }

      res.status(200).json({ result: updatedBiz });
    });
  });

// ─── Recalculate full scores for cached businesses (no DFS/Lighthouse re-fetch) ─

export const recalculateBusinessRank = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      try {
        await verifyAdmin(req, "recalculateBusinessRank");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "UNAUTHENTICATED") {
          res.status(401).json({ error: "Unauthorized. Please sign in." });
        } else {
          res.status(403).json({ error: "Forbidden. Admin role required." });
        }
        return;
      }

      // Accept optional CID list; if omitted, process all cached businesses
      const cids = req.body?.cids;
      const hasSpecificCids = Array.isArray(cids) && cids.length > 0;

      /** Re-score a business using cached signals and return the updated fields. */
      function rescore(biz: ScoredBusiness) {
        const input = scorerInputFromCached(biz);
        const { score: newScore, label, scoring } = score(input);
        const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
        if (biz.label !== label || biz.score !== newScore) {
          console.log(`[rescore] ${biz.name} (${biz.website}): ${biz.label}/${biz.score} → ${label}/${newScore} | statusCode=${input.htmlSignals?.statusCode} fetchFailed=${input.htmlSignals?.fetchFailed}`);
        }
        return { score: newScore, label, scoring, legitimacyScore, legitimacyBreakdown };
      }

      /** Returns true if any scored field changed. */
      function hasChanged(biz: ScoredBusiness, updated: ReturnType<typeof rescore>) {
        return (
          updated.score !== biz.score ||
          updated.label !== biz.label ||
          updated.legitimacyScore !== biz.legitimacyScore
        );
      }

      try {
        let updated = 0;
        let processed = 0;

        if (hasSpecificCids) {
          const safeCids = cids
            .slice(0, 500)
            .filter((c: unknown): c is string => typeof c === "string" && c.length > 0);
          const cached = await getCachedBusinesses(safeCids);

          const batch = db.batch();
          for (const [cid, biz] of cached) {
            const rescored = rescore(biz);
            processed++;
            if (hasChanged(biz, rescored)) {
              batch.update(db.collection(BUSINESSES_COLLECTION).doc(cid), rescored);
              updated++;
            }
          }

          if (updated > 0) await batch.commit();
        } else {
          // Paginated scan of all cached businesses
          const PAGE_SIZE = 200;
          let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
          let hasMore = true;

          while (hasMore) {
            let query = db
              .collection(BUSINESSES_COLLECTION)
              .orderBy("__name__")
              .limit(PAGE_SIZE);

            if (lastDoc) query = query.startAfter(lastDoc);

            const snapshot = await query.get();
            if (snapshot.empty || snapshot.docs.length === 0) { hasMore = false; break; }

            const batch = db.batch();
            let batchUpdates = 0;

            for (const doc of snapshot.docs) {
              const biz = doc.data() as ScoredBusiness;
              const rescored = rescore(biz);
              processed++;
              if (hasChanged(biz, rescored)) {
                batch.update(doc.ref, rescored);
                batchUpdates++;
                updated++;
              }
            }

            if (batchUpdates > 0) await batch.commit();
            lastDoc = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < PAGE_SIZE) hasMore = false;
          }
        }

        console.log(`[recalculateBusinessRank] processed=${processed} updated=${updated}`);
        res.status(200).json({ processed, updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error";
        console.error("[recalculateBusinessRank] error:", msg);
        res.status(500).json({ error: "An unexpected error occurred. Please try again." });
      }
    });
  });

// ─── Get Businesses by CIDs (free retrieval from cache) ───────────────────────

export const getGhostBusinesses = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      await verifyAdmin(req, "getGhostBusinesses");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "UNAUTHENTICATED") {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
      } else {
        res.status(403).json({ error: "Forbidden. Admin role required." });
      }
      return;
    }

    const threshold = Number(req.query.threshold) || 25;
    const limitParam = Number(req.query.limit) || 50;
    const safeLimit = Math.min(limitParam, 200);

    try {
      const snapshot = await db
        .collection(BUSINESSES_COLLECTION)
        .where("legitimacyScore", "<=", threshold)
        .orderBy("legitimacyScore", "asc")
        .limit(safeLimit)
        .get();

      const results = snapshot.docs.map((doc) => doc.data() as ScoredBusiness);
      console.log(`[getGhostBusinesses] threshold=${threshold} found=${results.length}`);
      res.status(200).json({ results, threshold });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[getGhostBusinesses] error:", msg);
      res.status(500).json({ error: "An unexpected error occurred. Please try again." });
    }
  });
});

// ─── Get Businesses by CIDs ──────────────────────────────────────────────────

export const getBusinessesByCids = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const rlReset = await checkRateLimit(decodedToken.uid, "getBusinessesByCids", 30);
    if (rlReset !== null) { replyRateLimited(res, rlReset); return; }

    const cids = req.body?.cids;
    if (!Array.isArray(cids) || cids.length === 0) {
      res.status(400).json({ error: "Missing or invalid field: cids (must be a non-empty array)" });
      return;
    }

    // Cap at 500 to prevent abuse
    const safeCids = cids.slice(0, 500).filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 50);
    if (safeCids.length === 0) {
      res.status(400).json({ error: "No valid CIDs provided" });
      return;
    }

    try {
      const cached = await getCachedBusinesses(safeCids);
      const results = safeCids
        .filter((cid) => cached.has(cid))
        .map((cid) => cached.get(cid)!);

      // Sort by score descending (same as search response)
      results.sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return b.score - a.score;
      });

      console.log(`[getBusinessesByCids] requested ${safeCids.length}, found ${results.length}`);
      res.status(200).json({ results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[getBusinessesByCids] error:", msg);
      res.status(500).json({ error: "An unexpected error occurred. Please try again." });
    }
  });
});

// ─── Get Google Places Photos for a business ─────────────────────────────────

export const getBusinessPhotos = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const rlReset = await checkRateLimit(decodedToken.uid, "getBusinessPhotos", 60);
    if (rlReset !== null) { replyRateLimited(res, rlReset); return; }

    const cid = req.query.cid as string | undefined;
    if (!cid || typeof cid !== "string") {
      res.status(400).json({ error: "Missing required query param: cid" });
      return;
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Google Places API key not configured" });
      return;
    }

    try {
      // Step 1: Use legacy Places Details endpoint — supports ?cid= directly
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?cid=${encodeURIComponent(cid)}&fields=place_id,photos&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);

      if (!detailsRes.ok) {
        const errBody = await detailsRes.text();
        console.error("[getBusinessPhotos] Place details failed:", errBody);
        res.status(502).json({ error: "Failed to fetch place from Google" });
        return;
      }

      const detailsData = await detailsRes.json() as {
        status: string;
        result?: {
          place_id?: string;
          photos?: Array<{ photo_reference: string; width: number; height: number }>;
        };
      };

      if (detailsData.status !== "OK" || !detailsData.result?.photos?.length) {
        console.log("[getBusinessPhotos] No photos found, status:", detailsData.status);
        res.status(200).json({ photoUrls: [] });
        return;
      }

      // Step 2: Fetch photos server-side and return as base64 (max 20)
      const photos = detailsData.result.photos.slice(0, 20);
      const photoResults = await Promise.all(
        photos.map(async (p, i) => {
          try {
            const maxSize = Math.min(Math.max(p.width, p.height), 4800);
            const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxSize}&photo_reference=${p.photo_reference}&key=${apiKey}`;
            const imgRes = await fetch(photoUrl);
            if (!imgRes.ok) return null;
            const buffer = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
            const ext = contentType.includes("png") ? "png" : "jpg";
            return {
              index: i + 1,
              ext,
              contentType,
              data: Buffer.from(buffer).toString("base64"),
            };
          } catch {
            return null;
          }
        })
      );

      const photos64 = photoResults.filter(Boolean);
      res.status(200).json({ photos: photos64 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[getBusinessPhotos] error:", msg);
      res.status(500).json({ error: "An unexpected error occurred." });
    }
  });
});

// ─── Cleanup: Mark stuck running jobs as failed ───────────────────────────────

export const cleanupStuckJobs = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    const tenMinutesAgo = Timestamp.fromMillis(Date.now() - 10 * 60 * 1000);

    const snapshot = await db
      .collection("jobs")
      .where("status", "==", "running")
      .where("createdAt", "<", tenMinutesAgo)
      .get();

    if (snapshot.empty) {
      console.log("[cleanupStuckJobs] No stuck jobs found");
      return;
    }

    const stuckIds = identifyStuckJobs(
      snapshot.docs.map((doc) => ({
        id: doc.id,
        status: doc.data().status,
        createdAt: doc.data().createdAt,
        ttl: doc.data().ttl,
      })),
      Date.now()
    );

    const batch = db.batch();
    for (const jobId of stuckIds) {
      const ref = db.collection("jobs").doc(jobId);
      batch.update(ref, {
        status: "failed",
        error: "Search timed out. Please try again.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    console.log(`[cleanupStuckJobs] Marked ${stuckIds.length} stuck jobs as failed`);
  });


// ─── Cleanup: Delete expired job documents and their results ──────────────────

export const cleanupExpiredJobs = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const now = Timestamp.now();

    const snapshot = await db
      .collection("jobs")
      .where("ttl", "<", now)
      .get();

    if (snapshot.empty) {
      console.log("[cleanupExpiredJobs] No expired jobs found");
      return;
    }

    const expiredIds = identifyExpiredJobs(
      snapshot.docs.map((doc) => ({
        id: doc.id,
        status: doc.data().status,
        createdAt: doc.data().createdAt,
        ttl: doc.data().ttl,
      })),
      now.toMillis()
    );

    for (const jobId of expiredIds) {
      // Delete all results subcollection documents first
      await deleteResultsSubcollection(jobId);
      // Then delete the parent job document
      await db.collection("jobs").doc(jobId).delete();
    }

    console.log(`[cleanupExpiredJobs] Deleted ${expiredIds.length} expired jobs`);
  });


// ─── Submit Report ────────────────────────────────────────────────────────────

const VALID_REASONS = ["wrong_ranking", "wrong_signal", "incorrect_info", "other"] as const;

export const submitReport = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const rlReset = await checkRateLimit(decodedToken.uid, "submitReport", 10);
    if (rlReset !== null) { replyRateLimited(res, rlReset); return; }

    const { cid, businessName, websiteUrl, reason, details } = req.body ?? {};

    if (!cid || typeof cid !== "string" || cid.length > 50) {
      res.status(400).json({ error: "Missing or invalid field: cid (max 50 chars)" });
      return;
    }
    if (!businessName || typeof businessName !== "string" || businessName.length > 200) {
      res.status(400).json({ error: "Missing or invalid field: businessName (max 200 chars)" });
      return;
    }
    if (!VALID_REASONS.includes(reason)) {
      res.status(400).json({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}` });
      return;
    }
    if (details !== undefined && (typeof details !== "string" || details.length > 1000)) {
      res.status(400).json({ error: "details must be a string under 1000 characters" });
      return;
    }

    if (websiteUrl !== undefined && websiteUrl !== null && (typeof websiteUrl !== "string" || websiteUrl.length > 500)) {
      res.status(400).json({ error: "websiteUrl must be a string under 500 characters" });
      return;
    }

    const reportRef = db.collection("reports").doc();
    await reportRef.set({
      cid,
      businessName,
      websiteUrl: websiteUrl ?? null,
      reason,
      details: details ?? null,
      uid: decodedToken.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "open",
    });

    console.log(`[submitReport] Report ${reportRef.id} created by uid=${decodedToken.uid} for cid=${cid}`);
    res.status(200).json({ reportId: reportRef.id });
  });
});

// ─── Admin: List Reports (grouped by business) ───────────────────────────────

export const getAdminReports = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "getAdminReports");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({ error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required." });
      return;
    }

    try {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "all";
      let query: admin.firestore.Query = db.collection("reports").orderBy("createdAt", "desc");
      if (statusFilter === "open" || statusFilter === "closed") {
        query = query.where("status", "==", statusFilter);
      }

      const snap = await query.limit(500).get();

      // Group by cid
      const grouped: Record<string, {
        cid: string;
        businessName: string;
        websiteUrl: string | null;
        reportCount: number;
        openCount: number;
        reasons: Record<string, number>;
        reports: Array<{
          id: string;
          reason: string;
          details: string | null;
          uid: string;
          status: string;
          createdAt: number | null;
        }>;
        latestAt: number | null;
      }> = {};

      // Collect unique uids to resolve emails
      const uids = new Set<string>();
      snap.docs.forEach((doc) => {
        const d = doc.data();
        if (d.uid) uids.add(d.uid);
      });

      // Batch-fetch user emails from Auth
      const emailMap: Record<string, string> = {};
      const uidArr = Array.from(uids);
      for (let i = 0; i < uidArr.length; i += 100) {
        const batch = uidArr.slice(i, i + 100).map((uid) => ({ uid }));
        const result = await admin.auth().getUsers(batch);
        result.users.forEach((u) => { emailMap[u.uid] = u.email ?? u.uid; });
      }

      snap.docs.forEach((doc) => {
        const d = doc.data();
        const cid: string = d.cid;
        const ts = d.createdAt as admin.firestore.Timestamp | null;
        const createdAtMs = ts ? ts.toMillis() : null;

        if (!grouped[cid]) {
          grouped[cid] = {
            cid,
            businessName: d.businessName,
            websiteUrl: d.websiteUrl ?? null,
            reportCount: 0,
            openCount: 0,
            reasons: {},
            reports: [],
            latestAt: null,
          };
        }

        const g = grouped[cid];
        g.reportCount++;
        if (d.status === "open") g.openCount++;
        g.reasons[d.reason] = (g.reasons[d.reason] ?? 0) + 1;
        if (createdAtMs && (g.latestAt === null || createdAtMs > g.latestAt)) g.latestAt = createdAtMs;

        g.reports.push({
          id: doc.id,
          reason: d.reason,
          details: d.details ?? null,
          uid: emailMap[d.uid] ?? d.uid,
          status: d.status,
          createdAt: createdAtMs,
        });
      });

      res.status(200).json({ groups: Object.values(grouped).sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0)) });
    } catch (err) {
      console.error("[getAdminReports] error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// ─── Admin: Update Report Status ─────────────────────────────────────────────

export const updateReportStatus = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "updateReportStatus");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({ error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required." });
      return;
    }

    const { reportId, status } = req.body ?? {};
    if (!reportId || typeof reportId !== "string") { res.status(400).json({ error: "Missing reportId" }); return; }
    if (status !== "open" && status !== "closed") { res.status(400).json({ error: 'status must be "open" or "closed"' }); return; }

    await db.collection("reports").doc(reportId).update({ status });
    console.log(`[updateReportStatus] reportId=${reportId} status=${status}`);
    res.status(200).json({ success: true });
  });
});

// ─── Set User Role: admin-only endpoint to assign roles ──────────────────────

export const setUserRole = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // ── Method check ──
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // ── Admin auth check ──
    try {
      await verifyAdmin(req, "setUserRole");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "UNAUTHENTICATED") {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
      } else {
        res.status(403).json({ error: "Forbidden. Admin role required." });
      }
      return;
    }

    // ── Validate role ──
    const { uid, role } = req.body ?? {};
    if (!uid || typeof uid !== "string" || uid.length > 128) {
      res.status(400).json({ error: "Missing or invalid field: uid" });
      return;
    }
    if (role !== "user" && role !== "admin") {
      res.status(400).json({ error: 'Invalid role value. Must be "user" or "admin".' });
      return;
    }

    // ── Set custom claim and revoke tokens ──
    await admin.auth().setCustomUserClaims(uid, { role });
    await admin.auth().revokeRefreshTokens(uid);

    console.log(`[setUserRole] uid=${uid} role=${role}`);
    res.status(200).json({ success: true, uid, role });
  });
});

// ─── Admin Stats: aggregate search + business data across all users ───────────

export const getAdminStats = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      await verifyAdmin(req, "getAdminStats");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "UNAUTHENTICATED") {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
      } else {
        res.status(403).json({ error: "Forbidden. Admin role required." });
      }
      return;
    }

    try {
      const [statsSnap, bizCount, highOpportunityCount] = await Promise.all([
        db.collection("admin").doc("stats").get(),
        db.collection(BUSINESSES_COLLECTION).count().get(),
        db.collection(BUSINESSES_COLLECTION).where("score", ">", 70).count().get(),
      ]);

      const stats = statsSnap.data() ?? {};
      const totalSearches = stats.totalSearches ?? 0;
      const totalResultCount = stats.totalResultCount ?? 0;
      const totalDfsCost = stats.totalDfsCost ?? 0;
      const totalBusinessesIndexed = bizCount.data().count;
      const highOpportunity = highOpportunityCount.data().count;
      const pctHighOpportunity = totalBusinessesIndexed > 0
        ? (highOpportunity / totalBusinessesIndexed) * 100
        : 0;

      const avgCostPerSearch = totalSearches > 0 ? totalDfsCost / totalSearches : 0;
      const avgResultsPerSearch = totalSearches > 0 ? totalResultCount / totalSearches : 0;

      res.status(200).json({
        totalSearches,
        totalResultCount,
        totalDfsCost,
        totalBusinessesIndexed,
        avgCostPerSearch,
        avgResultsPerSearch,
        breakdown: {
          totalBusinessSearch: stats.totalBusinessSearch ?? 0,
          totalInstantPages: stats.totalInstantPages ?? 0,
          totalLighthouse: stats.totalLighthouse ?? 0,
          totalCachedBusinesses: stats.totalCachedBusinesses ?? 0,
          totalFreshBusinesses: stats.totalFreshBusinesses ?? 0,
        },
        highOpportunityCount: highOpportunity,
        pctHighOpportunity,
        lastUpdated: stats.lastUpdated ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[getAdminStats] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
});

// ─── Admin: Audit Dead Sites — run pipeline on reported businesses, return CSV ─

export const auditDeadSites = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

      try {
        await verifyAdmin(req, "auditDeadSites");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({ error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required." });
        return;
      }

      const { cids } = req.body ?? {};
      if (!Array.isArray(cids) || cids.length === 0 || cids.length > 100) {
        res.status(400).json({ error: "cids must be a non-empty array of up to 100 strings" });
        return;
      }

      const DFS_EMAIL = process.env.DFS_EMAIL;
      const DFS_PASSWORD = process.env.DFS_PASSWORD;
      if (!DFS_EMAIL || !DFS_PASSWORD) {
        res.status(500).json({ error: "Server configuration error" });
        return;
      }

      const authHeader = buildAuthHeader(DFS_EMAIL, DFS_PASSWORD);

      // Load cached businesses
      const cached = await getCachedBusinesses(cids);

      // Collect URLs to audit (only businesses with a website)
      const entries: Array<{ cid: string; name: string; url: string }> = [];
      for (const cid of cids) {
        const biz = cached.get(cid);
        if (biz?.website) entries.push({ cid, name: biz.name, url: biz.website });
      }

      if (entries.length === 0) {
        res.status(200).json({ rows: [] });
        return;
      }

      const urls = entries.map((e) => e.url);

      // Run probeUrl (HEAD + single DFS pass, no retries) with concurrency=8.
      // Each probe: 12s HEAD + 12s DFS = ~24s max. At concurrency 8,
      // ceil(11/8)=2 rounds × 24s = ~48s worst-case — within Firebase's 60s proxy limit.
      const CONCURRENCY = 8;
      const probeResults: Array<{ signals: import("./types").HtmlSignals; cost: number; headErrorCode: string | null; dfsTaskStatusCode: number | null }> = new Array(urls.length);
      let totalCost = 0;

      for (let i = 0; i < urls.length; i += CONCURRENCY) {
        const batch = urls.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(batch.map((url) => probeUrl(url, authHeader)));
        for (let j = 0; j < batchResults.length; j++) {
          probeResults[i + j] = batchResults[j];
          totalCost += batchResults[j].cost;
        }
      }

      const signals = probeResults.map((r) => r.signals);
      const cost = totalCost;

      // Build result rows — run scorer to detect ERROR_PAGE_* stages
      const rows = entries.map((entry, i) => {
        const sig = signals[i];
        const biz = cached.get(entry.cid)!;
        const bd = biz.businessData;

        // Build a minimal BusinessRaw stub so we can use buildScorerInput
        const bizRawStub: BusinessRaw = {
          title: biz.name,
          description: bd?.description ?? null,
          address: biz.address,
          address_info: null,
          phone: biz.phone,
          domain: (() => { try { return new URL(entry.url).hostname; } catch { return null; } })(),
          url: entry.url,
          rating: biz.rating != null ? { value: biz.rating, votes_count: biz.reviewCount } : null,
          rating_distribution: bd?.ratingDistribution ?? null,
          category: biz.category,
          category_ids: null,
          additional_categories: bd?.additionalCategories ?? null,
          is_claimed: bd?.isClaimed ?? false,
          price_level: bd?.priceLevel ?? null,
          total_photos: bd?.totalPhotos ?? null,
          attributes: null,
          work_time: bd?.currentStatus ? { work_hours: { timetable: null, current_status: bd.currentStatus } } : null,
          contact_info: (bd?.socialLinks ?? []).map((l) => ({ type: l.type, value: l.value, source: "cached" })),
          people_also_search: null,
          place_topics: bd?.placeTopics ?? null,
          logo: bd?.logo ?? null,
          main_image: bd?.mainImage ?? null,
          last_updated_time: bd?.lastUpdatedTime ?? null,
          first_seen: bd?.firstSeen ?? null,
          check_url: bd?.checkUrl ?? null,
          cid: entry.cid,
          feature_id: null,
          place_id: null,
          latitude: bd?.latitude ?? null,
          longitude: bd?.longitude ?? null,
        };

        const input = buildScorerInput(bizRawStub, { website: entry.url, htmlSignals: sig });
        const { label } = score(input);

        const isDeadOrError = label === "dead site";
        const deathStage = sig?.deathStage ?? (isDeadOrError ? "UNKNOWN" : null);

        return {
          cid: entry.cid,
          name: entry.name,
          url: entry.url,
          label,
          deathStage: deathStage ?? "",
          fetchFailed: sig?.fetchFailed ?? false,
          statusCode: sig?.statusCode ?? "",
          headErrorCode: probeResults[i].headErrorCode ?? "",
          dfsTaskStatusCode: probeResults[i].dfsTaskStatusCode ?? "",
          pageTitle: sig?.pageMeta?.title ?? "",
          totalDomSize: sig?.totalDomSize ?? "",
          wordCount: sig?.wordCount ?? "",
        };
      });

      console.log(`[auditDeadSites] audited ${rows.length} URLs, cost=${cost}`);
      res.status(200).json({ rows, cost });
    });
  });

// ─── Create Stripe Checkout Session ──────────────────────────────────────────

export const createCheckoutSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const { priceId } = req.body ?? {};

    // Validate priceId against plans collection
    const priceToplan = await buildPriceIdToPlanMap();
    if (!priceId || !priceToplan.has(priceId)) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    // Read user profile
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userData = userSnap.data()!;
    let stripeCustomerId: string = userData.subscription?.stripeCustomerId ?? null;

    // Create Stripe Customer if not exists
    if (!stripeCustomerId) {
      const customer = await getStripe().customers.create({
        email: userData.email ?? undefined,
        metadata: { uid },
      });
      stripeCustomerId = customer.id;
      await userRef.update({ "subscription.stripeCustomerId": stripeCustomerId });
    }

    // Create checkout session
    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/billing`,
      metadata: { uid },
    });

    res.status(200).json({ url: session.url });
  });
});

export const createPortalSession = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const stripeCustomerId: string | null = userSnap.data()?.subscription?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      res.status(400).json({ error: "No active subscription to manage" });
      return;
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${FRONTEND_URL}/billing`,
    });

    res.status(200).json({ url: session.url });
  });
});

// ─── Stripe Webhook Helpers ───────────────────────────────────────────────────

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) {
  console.error("[Stripe] ❌ STRIPE_WEBHOOK_SECRET is not set");
}

async function lookupUidByCustomerId(stripeCustomerId: string): Promise<string | null> {
  const snap = await db.collection(USERS_COLLECTION)
    .where("subscription.stripeCustomerId", "==", stripeCustomerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

function mapStripeStatus(stripeStatus: string): "active" | "past_due" | "cancelled" | "trialing" {
  switch (stripeStatus) {
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "cancelled";
    case "trialing": return "trialing";
    default: return "active";
  }
}

async function updateSubscription(
  uid: string,
  plan: import("./types").SubscriptionPlan,
  stripeSubscription: { id: string; cancel_at_period_end: boolean; current_period_start: number; current_period_end: number },
  status: "active" | "past_due" | "cancelled" | "trialing"
): Promise<void> {
  const creditsTotal = await getPlanCredits(plan);
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.plan": plan,
    "subscription.status": status,
    "subscription.creditsTotal": creditsTotal,
    "subscription.stripeSubscriptionId": stripeSubscription.id,
    "subscription.cancelAtPeriodEnd": stripeSubscription.cancel_at_period_end,
    "subscription.currentPeriodStart": Timestamp.fromMillis(stripeSubscription.current_period_start * 1000),
    "subscription.currentPeriodEnd": Timestamp.fromMillis(stripeSubscription.current_period_end * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function downgradeToFree(uid: string): Promise<void> {
  const creditsTotal = await getPlanCredits("free");
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.plan": "free",
    "subscription.status": "cancelled",
    "subscription.creditsTotal": creditsTotal,
    "subscription.stripeSubscriptionId": null,
    "subscription.cancelAtPeriodEnd": false,
    "subscription.currentPeriodStart": null,
    "subscription.currentPeriodEnd": null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function resetCredits(uid: string, invoice: { period_start: number; period_end: number }): Promise<void> {
  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const plan = (userSnap.data()?.subscription?.plan ?? "free") as import("./types").SubscriptionPlan;
  const creditsTotal = await getPlanCredits(plan);
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.creditsUsed": 0,
    "subscription.creditsTotal": creditsTotal,
    "subscription.currentPeriodStart": Timestamp.fromMillis(invoice.period_start * 1000),
    "subscription.currentPeriodEnd": Timestamp.fromMillis(invoice.period_end * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) { res.status(400).send("Missing Stripe-Signature header"); return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = getStripe().webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET ?? "");
  } catch (err) {
    console.error("[stripeWebhook] Signature verification failed:", err);
    res.status(400).send("Invalid webhook signature");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = event.data.object as any;
        const uid = session.metadata?.uid;
        if (!uid) { console.error("[stripeWebhook] checkout.session.completed: missing uid in metadata"); break; }
        const stripeSubscriptionId = session.subscription as string;
        if (!stripeSubscriptionId) { console.error("[stripeWebhook] checkout.session.completed: missing subscription id"); break; }
        const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId, {
          expand: ["items.data.price"],
        });
        const priceId = subscription.items.data[0]?.price?.id;
        if (!priceId) { console.error(`[stripeWebhook] checkout.session.completed: could not resolve priceId from subscription ${stripeSubscriptionId}`); break; }
        const priceToplan = await buildPriceIdToPlanMap();
        const plan = priceToplan.get(priceId);
        if (!plan) { console.error(`[stripeWebhook] Unknown priceId: ${priceId}`); break; }
        const item = subscription.items.data[0] as unknown as { current_period_start: number; current_period_end: number };
        await updateSubscription(uid, plan as SubscriptionPlan, {
          id: subscription.id,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_start: item.current_period_start,
          current_period_end: item.current_period_end,
        }, "active");
        console.log(`[stripeWebhook] checkout.session.completed uid=${uid} plan=${plan}`);
        break;
      }

      case "customer.subscription.updated": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        const uid = await lookupUidByCustomerId(subscription.customer as string);
        if (!uid) { console.error(`[stripeWebhook] customer.subscription.updated: uid not found for customer=${subscription.customer}`); break; }
        const priceId = subscription.items.data[0].price.id;
        const priceToplan2 = await buildPriceIdToPlanMap();
        const plan = (priceToplan2.get(priceId) ?? "free") as SubscriptionPlan;
        const status = mapStripeStatus(subscription.status);
        await updateSubscription(uid, plan, {
          id: subscription.id,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_start: subscription.items.data[0].current_period_start,
          current_period_end: subscription.items.data[0].current_period_end,
        }, status);
        console.log(`[stripeWebhook] customer.subscription.updated uid=${uid} plan=${plan} status=${status}`);
        break;
      }

      case "customer.subscription.deleted": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        const uid = await lookupUidByCustomerId(subscription.customer as string);
        if (!uid) { console.error(`[stripeWebhook] customer.subscription.deleted: uid not found for customer=${subscription.customer}`); break; }
        await downgradeToFree(uid);
        console.log(`[stripeWebhook] customer.subscription.deleted uid=${uid} → downgraded to free`);
        break;
      }

      case "invoice.payment_succeeded": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        if (invoice.billing_reason !== "subscription_cycle") break;
        const uid = await lookupUidByCustomerId(invoice.customer as string);
        if (!uid) { console.error(`[stripeWebhook] invoice.payment_succeeded: uid not found for customer=${invoice.customer}`); break; }
        await resetCredits(uid, { period_start: invoice.period_start, period_end: invoice.period_end });
        console.log(`[stripeWebhook] invoice.payment_succeeded (renewal) uid=${uid} credits reset`);
        break;
      }

      case "invoice.payment_failed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        const uid = await lookupUidByCustomerId(invoice.customer as string);
        if (!uid) { console.error(`[stripeWebhook] invoice.payment_failed: uid not found for customer=${invoice.customer}`); break; }
        await db.collection(USERS_COLLECTION).doc(uid).update({
          "subscription.status": "past_due",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[stripeWebhook] invoice.payment_failed uid=${uid} → past_due`);
        break;
      }

      default:
        console.log(`[stripeWebhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("[stripeWebhook] Error processing event:", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(200).json({ received: true });
});


// ─── Admin: Migrate Legacy Subscription Plans ─────────────────────────────────

export const migrateSubscriptionPlans = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

      try {
        await verifyAdmin(req, "migrateSubscriptionPlans");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({
          error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required.",
        });
        return;
      }

      const PLAN_MAP: Record<string, import("./types").SubscriptionPlan> = {
        starter: "soloPro",
        enterprise: "pro",
      };
      const VALID_PLANS = new Set(["free", "soloPro", "agency", "pro"]);

      let migrated = 0;
      let skipped = 0;
      let processed = 0;

      try {
        const PAGE_SIZE = 500;
        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        let hasMore = true;

        while (hasMore) {
          let query = db.collection(USERS_COLLECTION).orderBy("__name__").limit(PAGE_SIZE);
          if (lastDoc) query = query.startAfter(lastDoc);

          const snapshot = await query.get();
          if (snapshot.empty) { hasMore = false; break; }

          const batch = db.batch();
          let batchUpdates = 0;

          for (const doc of snapshot.docs) {
            processed++;
            const data = doc.data();
            const currentPlan: string = data.subscription?.plan ?? "free";

            if (VALID_PLANS.has(currentPlan)) {
              skipped++;
              continue;
            }

            const newPlan = PLAN_MAP[currentPlan] ?? "free";
            const newCreditsTotal = await getPlanCredits(newPlan as SubscriptionPlan);
            const currentCreditsUsed: number = data.subscription?.creditsUsed ?? 0;
            const cappedCreditsUsed = Math.min(currentCreditsUsed, newCreditsTotal);

            batch.update(doc.ref, {
              "subscription.plan": newPlan,
              "subscription.creditsTotal": newCreditsTotal,
              "subscription.creditsUsed": cappedCreditsUsed,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            batchUpdates++;
            migrated++;
          }

          if (batchUpdates > 0) await batch.commit();
          lastDoc = snapshot.docs[snapshot.docs.length - 1];
          if (snapshot.docs.length < PAGE_SIZE) hasMore = false;
        }

        console.log(`[migrateSubscriptionPlans] processed=${processed} migrated=${migrated} skipped=${skipped}`);
        res.status(200).json({ processed, migrated, skipped });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error";
        console.error("[migrateSubscriptionPlans] error:", msg);
        res.status(500).json({ error: msg });
      }
    });
  });

// ─── Admin: Seed / Update Plans Collection ────────────────────────────────────

export const seedPlans = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "seedPlans");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({
        error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required.",
      });
      return;
    }

    try {
      const seedData = buildPlanSeedData();
      const batch = db.batch();

      for (let i = 0; i < PLAN_IDS.length; i++) {
        const planId = PLAN_IDS[i];
        const data = seedData[i];
        const ref = db.collection("plans").doc(planId);
        // merge: true preserves any fields not in seed (e.g. manually set stripePriceId)
        batch.set(ref, { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }

      await batch.commit();
      invalidatePlanCache();

      console.log(`[seedPlans] seeded ${PLAN_IDS.length} plans`);
      res.status(200).json({ seeded: PLAN_IDS.length, plans: PLAN_IDS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[seedPlans] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
});
