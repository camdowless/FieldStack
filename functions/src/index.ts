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
} from "./dfsClient";
import { lookupDomainInfo } from "./rdap";
import { score, computeLegitimacy } from "./scorer";
import { ScoredBusiness, CostBreakdown, BusinessRaw, ScorerInput, JobDocument } from "./types";
import { geocodeLocation, milesToKm, buildLocationCoordinate } from "./geocode";
import { computeJobId, deleteResultsSubcollection, createOrReuseJob, isJobCancelled, cancelJob, identifyStuckJobs, identifyExpiredJobs } from "./jobHelpers";
import { Timestamp } from "firebase-admin/firestore";

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ─── CORS ─────────────────────────────────────────────────────────────────────
// In production, lock this down to your Firebase Hosting domain.
const ALLOWED_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : true; // `true` = allow all (dev convenience; override via env var in prod)

const corsHandler = cors({ origin: ALLOWED_ORIGINS });

// ─── Auth Helper ──────────────────────────────────────────────────────────────

async function verifyAuth(req: functions.https.Request): Promise<admin.auth.DecodedIdToken> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  return admin.auth().verifyIdToken(header.split("Bearer ")[1]);
}

// ─── User Profile Helper ─────────────────────────────────────────────────────

const USERS_COLLECTION = "users";

/**
 * Ensure a user document exists. Creates one from Firebase Auth data if missing.
 */
async function ensureUserProfile(uid: string): Promise<void> {
  const ref = db.collection(USERS_COLLECTION).doc(uid);
  const snap = await ref.get();
  if (snap.exists) return;

  // Pull basic info from Firebase Auth
  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  try {
    const userRecord = await admin.auth().getUser(uid);
    email = userRecord.email ?? null;
    displayName = userRecord.displayName ?? null;
    photoURL = userRecord.photoURL ?? null;
  } catch {
    // If we can't fetch auth record, just create with uid only
  }

  await ref.set({
    email,
    displayName,
    photoURL,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`[user] created profile for ${uid}`);
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

// ─── Rate Limiting (simple per-IP, in-memory) ────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodically clean up stale entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS * 2);

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
        decodedToken = await verifyAuth(req);
      } catch {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
        return;
      }

      const uid = decodedToken.uid;

      // Ensure user profile exists (fire-and-forget)
      ensureUserProfile(uid).catch((err) => {
        console.error("[user] ensureUserProfile failed:", err);
      });

      // ── Rate limiting ──
      const clientIp = req.ip || req.headers["x-forwarded-for"] || "unknown";
      if (isRateLimited(String(clientIp))) {
        res.status(429).json({ error: "Too many requests. Please wait a moment." });
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

      try {
        const result = await createOrReuseJob(jobId, jobData, jobRef as unknown as import("./jobHelpers").JobDocRef, deleteResultsSubcollection);
        if (result.isExisting) {
          console.log(`[Job_Creator] Returning existing running job ${jobId}`);
        } else {
          console.log(`[Job_Creator] Created new job ${jobId} for uid=${uid}`);
        }
        res.status(200).json({ jobId });
      } catch (err: unknown) {
        console.error("[Job_Creator] Firestore error:", err);
        res.status(500).json({ error: "An unexpected error occurred. Please try again." });
      }
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
      const websiteUrls = hasWebsite.map((b) => b.url!);
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

      for (const b of hasWebsite) {
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
      decodedToken = await verifyAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;

    // ── Read jobId from request body ──
    const jobId = req.body?.jobId;
    if (!jobId || typeof jobId !== "string") {
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
        await verifyAuth(req);
      } catch {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
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
      await verifyAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
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

    try {
      await verifyAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const cids = req.body?.cids;
    if (!Array.isArray(cids) || cids.length === 0) {
      res.status(400).json({ error: "Missing or invalid field: cids (must be a non-empty array)" });
      return;
    }

    // Cap at 500 to prevent abuse
    const safeCids = cids.slice(0, 500).filter((c): c is string => typeof c === "string" && c.length > 0);
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

    try {
      await verifyAuth(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

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

