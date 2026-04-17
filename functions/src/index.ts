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
import { ScoredBusiness, SearchResponse, CostBreakdown, BusinessRaw, ScorerInput } from "./types";
import { geocodeLocation, milesToKm, buildLocationCoordinate } from "./geocode";

admin.initializeApp();
const db = admin.firestore();

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
function saveSearchToUser(
  uid: string,
  search: { query: string; location: string; category: string; radius: number; cids: string[] },
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

const MAX_KEYWORD_LEN = 120;
const MAX_LOCATION_LEN = 200;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,\-'&#/()]+$/u;

function sanitizeString(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, maxLen);
  if (trimmed.length === 0) return null;
  if (!SAFE_TEXT_RE.test(trimmed)) return null;
  return trimmed;
}

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
function saveBusinessesToCache(businesses: ScoredBusiness[]): void {
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
function buildScorerInput(
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
    permanentlyClosed: b.permanently_closed,
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

      // ── Geocode location → coordinates ──
      const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
      let locationCoordinate: string;
      try {
        const geo = await geocodeLocation(location, googleApiKey);
        const radiusKm = Math.round(milesToKm(radiusMiles));
        locationCoordinate = buildLocationCoordinate(geo.lat, geo.lng, radiusKm);
        console.log(`[dataforseoBusinessSearch] Geocoded "${location}" → ${locationCoordinate}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not resolve location";
        res.status(400).json({ error: msg });
        return;
      }

      // ── Env var check ──
      const dfsEmail = process.env.DFS_EMAIL;
      const dfsPassword = process.env.DFS_PASSWORD;
      if (!dfsEmail || !dfsPassword) {
        console.error("[dataforseoBusinessSearch] Missing DFS_EMAIL or DFS_PASSWORD env vars");
        res.status(500).json({ error: "Server configuration error" });
        return;
      }

      const auth = buildAuthHeader(dfsEmail, dfsPassword);

      // Partial results accumulator for timeout scenario
      let partialResults: ScoredBusiness[] = [];
      const costTracker: CostBreakdown = {
        businessSearch: 0,
        instantPages: 0,
        lighthouse: 0,
        totalDfs: 0,
        firestoreReads: 0,
        firestoreWrites: 0,
        cachedBusinesses: 0,
        freshBusinesses: 0,
      };

      const pipeline = async (): Promise<SearchResponse> => {
        // 1. Business discovery
        let businesses;
        try {
          const searchResult = await searchBusinesses(keyword, locationCoordinate, auth);
          businesses = searchResult.items;
          costTracker.businessSearch = searchResult.cost;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "DataForSEO business search failed";
          res.status(502).json({ error: msg });
          return { results: [] };
        }

        // 2. Pre-flight filter: remove Facebook URLs (permanently closed handled by legitimacy score)
        const filtered = businesses.filter(
          (b) =>
            !(b.url && b.url.toLowerCase().includes("facebook.com"))
        );

        // 3. Split into no-website and has-website groups
        const noWebsite = filtered.filter((b) => !b.url);
        const hasWebsite = filtered.filter((b) => !!b.url);

        // 3.5 Check cache for businesses we've already scored
        const allCids = filtered
          .map((b) => b.cid)
          .filter((cid): cid is string => cid !== null);
        const cachedMap = await getCachedBusinesses(allCids);
        costTracker.firestoreReads = allCids.length;
        costTracker.cachedBusinesses = cachedMap.size;

        // Separate cached from uncached in each group
        const noWebsiteUncached = noWebsite.filter((b) => !b.cid || !cachedMap.has(b.cid));
        const hasWebsiteUncached = hasWebsite.filter((b) => !b.cid || !cachedMap.has(b.cid));
        const cachedResults: ScoredBusiness[] = [...cachedMap.values()];

        // 4. Score no-website businesses using the scorer
        const noWebsiteScored: ScoredBusiness[] = noWebsiteUncached.map((b) => {
          const scorerInput = buildScorerInput(b, { website: null });
          const { score: s, label, scoring } = score(scorerInput);
          const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(scorerInput);
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

        partialResults = [...cachedResults, ...noWebsiteScored];

        // 5. Fetch instant pages for all has-website businesses (uncached only)
        const websiteUrls = hasWebsiteUncached.map((b) => b.url as string);
        const instantPagesResult = await fetchInstantPages(websiteUrls, auth);
        const htmlSignalsArr = instantPagesResult.signals;
        costTracker.instantPages = instantPagesResult.cost;

        // 6. Classify: dead site → parked → normal
        const deadSiteScored: ScoredBusiness[] = [];
        const parkedScored: ScoredBusiness[] = [];
        const nonParkedBusinesses: Array<{
          business: typeof hasWebsite[0];
          url: string;
          htmlSignals: typeof htmlSignalsArr[0];
        }> = [];

        for (let i = 0; i < hasWebsiteUncached.length; i++) {
          const b = hasWebsiteUncached[i];
          const signals = htmlSignalsArr[i];
          const url = b.url as string;

          if (signals.fetchFailed) {
            const scorerInput = buildScorerInput(b, { website: url, htmlSignals: signals });
            const { score: s, label, scoring } = score(scorerInput);
            const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(scorerInput);

            deadSiteScored.push({
              cid: b.cid,
              name: b.title,
              address: b.address,
              phone: b.phone,
              website: url,
              rating: b.rating?.value ?? null,
              reviewCount: b.rating?.votes_count ?? null,
              category: b.category,
              score: s,
              label,
              scoring,
              legitimacyScore,
              legitimacyBreakdown,
              businessData: extractBusinessData(b),
              websiteData: signals,
            });
          } else if (isParkedDomain(signals)) {
            const parkedInput = buildScorerInput(b, { website: url, htmlSignals: signals });
            const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(parkedInput);
            parkedScored.push({
              cid: b.cid,
              name: b.title,
              address: b.address,
              phone: b.phone,
              website: url,
              rating: b.rating?.value ?? null,
              reviewCount: b.rating?.votes_count ?? null,
              category: b.category,
              score: null,
              label: "parked",
              scoring: {
                total: 0,
                reasons: ["Domain contains parking keywords"],
                lighthousePerformance: null,
                lighthouseSeo: null,
                domainAgeYears: null,
                isExpiredDomain: false,
                isHttps: signals.isHttps,
                wordCount: signals.wordCount,
                hasMetaDescription: signals.hasMetaDescription,
                hasFavicon: signals.hasFavicon,
                fetchFailed: false,
                statusCode: signals.statusCode,
                onpageScore: signals.onpageScore,
              },
              legitimacyScore,
              legitimacyBreakdown,
              businessData: extractBusinessData(b),
              websiteData: signals,
            });
          } else {
            nonParkedBusinesses.push({ business: b, url, htmlSignals: signals });
          }
        }

        partialResults = [...cachedResults, ...noWebsiteScored, ...deadSiteScored, ...parkedScored];

        // 7. First 25 non-parked get Lighthouse; all non-parked get domain age
        const first25Urls = nonParkedBusinesses.slice(0, 25).map((x) => x.url);
        const allNonParkedUrls = nonParkedBusinesses.map((x) => x.url);

        // 8. Run Lighthouse (first 25) + domain info (all non-parked) in parallel
        const [lighthouseResult, domainInfoResults] = await Promise.all([
          fetchLighthouse(first25Urls, auth),
          Promise.allSettled(allNonParkedUrls.map((url) => {
            try {
              const domain = new URL(url).hostname;
              return lookupDomainInfo(domain);
            } catch {
              return Promise.resolve({ ageYears: null, isExpired: false });
            }
          })),
        ]);

        const lighthouseResults = lighthouseResult.scores;
        costTracker.lighthouse = lighthouseResult.cost;

        // 9. Score each non-parked business
        const nonParkedScored: ScoredBusiness[] = nonParkedBusinesses.map((item, idx) => {
          const lighthouseScore = idx < 25 ? (lighthouseResults[idx] ?? null) : null;
          const domainInfoOutcome = domainInfoResults[idx];
          const domainInfo = domainInfoOutcome.status === "fulfilled"
            ? domainInfoOutcome.value
            : { ageYears: null, isExpired: false };

          const scorerInput = buildScorerInput(item.business, {
            website: item.url,
            htmlSignals: item.htmlSignals,
            lighthousePerformance: lighthouseScore?.performance ?? null,
            lighthouseSeo: lighthouseScore?.seo ?? null,
            domainAgeYears: domainInfo.ageYears,
            isExpiredDomain: domainInfo.isExpired,
          });

          const { score: s, label, scoring } = score(scorerInput);
          const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(scorerInput);

          return {
            cid: item.business.cid,
            name: item.business.title,
            address: item.business.address,
            phone: item.business.phone,
            website: item.url,
            rating: item.business.rating?.value ?? null,
            reviewCount: item.business.rating?.votes_count ?? null,
            category: item.business.category,
            score: s,
            label,
            scoring,
            legitimacyScore,
            legitimacyBreakdown,
            businessData: extractBusinessData(item.business),
            websiteData: item.htmlSignals,
          };
        });

        const allScored = [
          ...cachedResults,
          ...noWebsiteScored,
          ...deadSiteScored,
          ...parkedScored,
          ...nonParkedScored,
        ];

        // 10. Sort: non-null scores descending, nulls last
        allScored.sort((a, b) => {
          if (a.score === null && b.score === null) return 0;
          if (a.score === null) return 1;
          if (b.score === null) return -1;
          return b.score - a.score;
        });

        // 11. Save newly scored businesses to cache (fire-and-forget)
        const newlyScored = [
          ...noWebsiteScored,
          ...deadSiteScored,
          ...parkedScored,
          ...nonParkedScored,
        ];
        saveBusinessesToCache(newlyScored);
        costTracker.firestoreWrites = newlyScored.filter((b) => b.cid).length;
        costTracker.freshBusinesses = newlyScored.length;
        costTracker.totalDfs = costTracker.businessSearch + costTracker.instantPages + costTracker.lighthouse;

        partialResults = allScored;
        return { results: allScored, cost: costTracker };
      };

      // Wrap in 290s timeout race
      const timeoutPromise = new Promise<SearchResponse>((resolve) => {
        setTimeout(() => {
          const sorted = [...partialResults].sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
          });
          costTracker.totalDfs = costTracker.businessSearch + costTracker.instantPages + costTracker.lighthouse;
          resolve({ results: sorted, timedOut: true, cost: costTracker });
        }, 290_000);
      });

      try {
        const result = await Promise.race([pipeline(), timeoutPromise]);
        if (!res.headersSent) {
          console.log(`[dataforseoBusinessSearch] COST: $${costTracker.totalDfs.toFixed(4)} (search=$${costTracker.businessSearch.toFixed(4)} pages=$${costTracker.instantPages.toFixed(4)} lighthouse=$${costTracker.lighthouse.toFixed(4)}) | ${costTracker.cachedBusinesses} cached, ${costTracker.freshBusinesses} fresh, ${costTracker.firestoreReads} reads, ${costTracker.firestoreWrites} writes`);
          // Save search to user profile (fire-and-forget)
          const resultCids = result.results
            .map((b) => b.cid)
            .filter((cid): cid is string => cid !== null);
          saveSearchToUser(uid, {
            query: keyword,
            location: location,
            category: keyword,
            radius: radiusMiles,
            cids: resultCids,
          });

          res.status(200).json(result);
        }
      } catch (err) {
        if (!res.headersSent) {
          const msg = err instanceof Error ? err.message : "Internal server error";
          console.error("[dataforseoBusinessSearch] error:", msg);
          // Don't leak internal error details to client
          res.status(500).json({ error: "An unexpected error occurred. Please try again." });
        }
      }
    });
  });

// ─── Reconstruct ScorerInput from a cached ScoredBusiness ─────────────────────
// Used by recalculateLegitimacy to re-score existing businesses without
// re-fetching from DataForSEO. Fields only available on BusinessRaw
// (hasBusinessHours, hasAttributes, permanentlyClosed, hasPeopleAlsoSearch)
// are approximated from what's stored.

function scorerInputFromCached(biz: ScoredBusiness): ScorerInput {
  const bd = biz.businessData;
  const sc = biz.scoring;
  const socialLinks = bd?.socialLinks ?? [];

  return {
    website: biz.website,
    htmlSignals: biz.websiteData ?? null,
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

// ─── Recalculate Legitimacy Scores for cached businesses ──────────────────────

export const recalculateLegitimacy = functions
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

      try {
        let updated = 0;
        let processed = 0;

        if (hasSpecificCids) {
          // Recalculate specific businesses by CID
          const safeCids = cids
            .slice(0, 500)
            .filter((c: unknown): c is string => typeof c === "string" && c.length > 0);
          const cached = await getCachedBusinesses(safeCids);

          const batch = db.batch();
          for (const [cid, biz] of cached) {
            const input = scorerInputFromCached(biz);
            const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
            processed++;

            if (legitimacyScore !== biz.legitimacyScore) {
              const ref = db.collection(BUSINESSES_COLLECTION).doc(cid);
              batch.update(ref, { legitimacyScore, legitimacyBreakdown });
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

            if (lastDoc) {
              query = query.startAfter(lastDoc);
            }

            const snapshot = await query.get();
            if (snapshot.empty || snapshot.docs.length === 0) {
              hasMore = false;
              break;
            }

            const batch = db.batch();
            let batchUpdates = 0;

            for (const doc of snapshot.docs) {
              const biz = doc.data() as ScoredBusiness;
              const input = scorerInputFromCached(biz);
              const { legitimacyScore, legitimacyBreakdown } = computeLegitimacy(input);
              processed++;

              // Only write if the score actually changed
              const oldScore = biz.legitimacyScore ?? -1;
              if (legitimacyScore !== oldScore) {
                batch.update(doc.ref, { legitimacyScore, legitimacyBreakdown });
                batchUpdates++;
                updated++;
              }
            }

            if (batchUpdates > 0) await batch.commit();

            lastDoc = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < PAGE_SIZE) hasMore = false;
          }
        }

        console.log(`[recalculateLegitimacy] processed=${processed} updated=${updated}`);
        res.status(200).json({ processed, updated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error";
        console.error("[recalculateLegitimacy] error:", msg);
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
