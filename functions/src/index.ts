import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import {
  buildAuthHeader,
  searchBusinesses,
  fetchInstantPages,
  fetchLighthouse,
  isParkedDomain,
} from "./dfsClient";
import { lookupDomainInfo } from "./rdap";
import { score } from "./scorer";
import { ScoredBusiness, SearchResponse } from "./types";

admin.initializeApp();

const corsHandler = cors({origin: true});

interface PlaceResult {
  name: string;
  address: string;
  phone: string;
  website: string;
  types: string[];
  businessStatus: string;
  openNow: boolean | null;
  weekdayHours: string[];
  summary: string;
  zipCode: string;
}

interface TextSearchResponse {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    types?: string[];
    businessStatus?: string;
    currentOpeningHours?: {
      openNow?: boolean;
      weekdayDescriptions?: string[];
    };
    editorialSummary?: { text?: string };
    primaryTypeDisplayName?: { text?: string };
  }>;
  nextPageToken?: string;
}

const FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.types",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.editorialSummary",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

async function searchPlacesForZip(
  apiKey: string,
  zipCode: string,
  businessType?: string,
  pageToken?: string
): Promise<{ results: PlaceResult[]; nextPageToken?: string }> {
  const query = businessType
    ? `${businessType} in ${zipCode}`
    : `businesses in ${zipCode}`;

  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: "en",
    pageSize: 20,
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const url = "https://places.googleapis.com/v1/places:searchText";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELDS,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Places API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as TextSearchResponse;

  console.log(
    `[searchPlaces] zip=${zipCode} page query returned ` +
    `${(data.places || []).length} places, ` +
    `nextPageToken=${data.nextPageToken ? "present" : "absent"}`
  );

  const results: PlaceResult[] = (data.places || []).map((place) => ({
    name: place.displayName?.text || "",
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || "",
    website: place.websiteUri || "",
    types: place.types || [],
    businessStatus: place.businessStatus || "",
    openNow: place.currentOpeningHours?.openNow ?? null,
    weekdayHours: place.currentOpeningHours?.weekdayDescriptions || [],
    summary: place.editorialSummary?.text ||
      place.primaryTypeDisplayName?.text || "",
    zipCode,
  }));

  return {results, nextPageToken: data.nextPageToken};
}

export const searchPlaces = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // Verify Firebase Auth token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({error: "Unauthorized"});
      return;
    }

    try {
      await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch {
      res.status(401).json({error: "Invalid token"});
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({error: "Method not allowed"});
      return;
    }

    const {zipCodes, businessType, maxPages = 10} = req.body;

    if (!zipCodes || !Array.isArray(zipCodes) || zipCodes.length === 0) {
      res.status(400).json({error: "zipCodes array is required"});
      return;
    }

    if (zipCodes.length > 10) {
      res.status(400).json({error: "Maximum 10 zip codes per request"});
      return;
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;

    if (!apiKey) {
      res.status(500).json({error: "Places API key not configured"});
      return;
    }

    try {
      // Search all zip codes in parallel
      const allResults = await Promise.all(
        zipCodes.map(async (zip: string) => {
          const results: PlaceResult[] = [];
          let nextPageToken: string | undefined;
          let page = 0;

          do {
            const response = await searchPlacesForZip(
              apiKey, zip, businessType, nextPageToken
            );
            results.push(...response.results);
            nextPageToken = response.nextPageToken;
            page++;
            // Google requires a short delay before using page tokens
            if (nextPageToken && page < maxPages) {
              await new Promise((r) => setTimeout(r, 2000));
            }
          } while (nextPageToken && page < maxPages);

          console.log(
            `[searchPlaces] zip=${zip} total=${results.length} pages=${page}`
          );
          return results;
        })
      );

      const flatResults = allResults.flat()
        .filter((r) => r.businessStatus === "OPERATIONAL" || r.businessStatus === "");
      // Sort by zip code
      flatResults.sort((a, b) => a.zipCode.localeCompare(b.zipCode));

      res.json({
        results: flatResults,
        totalCount: flatResults.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Search error:", message);
      res.status(500).json({error: message});
    }
  });
});

// ─── Lead Analysis ────────────────────────────────────────────────────────────

interface LeadAnalysis {
  leadScore: number;
  scoreReasons: string[];
  isExcluded: boolean;
  excludeReason?: string;
  isHttps: boolean | null;
  isMobileFriendly: boolean | null;
  hasViewport: boolean | null;
  hasMediaQueries: boolean | null;
  copyrightYear: number | null;
  lastWaybackSeen: string | null;
  waybackAgeYears: number | null;
  neverCrawled: boolean | null;
  hasGoogleAds: boolean | null;
}

interface AnalyzedResult extends PlaceResult {
  analysis: LeadAnalysis | null;
  analysisFailed?: boolean;
}

// Business types to exclude from scoring (they don't need our services)
const EXCLUDED_TYPE_PATTERNS = [
  "software", "it_company", "computer", "internet_service_provider",
  "marketing_agency", "advertising_agency", "web_design", "seo",
  "university", "school", "primary_school", "secondary_school",
  "hospital", "government_office", "embassy", "city_hall",
  "real_estate_agency", "corporate_office", "insurance_agency",
];

// High-value target types (get bonus points)
const HIGH_VALUE_TYPES = [
  "plumber", "electrician", "roofing_contractor", "general_contractor",
  "painter", "hvac_contractor", "landscaper", "carpenter",
  "car_repair", "auto_body_shop", "car_wash", "auto_parts_store",
  "dentist", "chiropractor", "physiotherapist", "beauty_salon",
  "hair_care", "nail_salon", "spa", "gym", "fitness_center",
  "restaurant", "cafe", "bakery", "bar", "food",
  "lawyer", "accounting", "insurance_agency", "tax_preparation",
  "florist", "jewelry_store", "clothing_store", "shoe_store",
  "pet_store", "veterinary_care", "laundry", "dry_cleaning",
];

function isExcludedBusiness(types: string[]): { excluded: boolean; reason?: string } {
  const typeStr = types.join(" ").toLowerCase();
  for (const pattern of EXCLUDED_TYPE_PATTERNS) {
    if (typeStr.includes(pattern)) {
      return { excluded: true, reason: `Business type '${pattern}' excluded` };
    }
  }
  return { excluded: false };
}

function isHighValueBusiness(types: string[]): boolean {
  const typeStr = types.join(" ").toLowerCase();
  return HIGH_VALUE_TYPES.some((t) => typeStr.includes(t));
}

async function checkWayback(
  url: string
): Promise<{ lastSeen: string | null; ageYears: number | null; neverCrawled: boolean }> {
  try {
    const domain = new URL(url).hostname;

    // Availability API — returns the most recent snapshot directly
    const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(domain)}`;
    const res = await fetch(availUrl, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) return { lastSeen: null, ageYears: null, neverCrawled: false };

    const data = await res.json() as {
      archived_snapshots?: {
        closest?: { available: boolean; url: string; timestamp: string; status: string };
      };
    };

    const closest = data.archived_snapshots?.closest;

    if (!closest || !closest.available) {
      return { lastSeen: null, ageYears: null, neverCrawled: true };
    }

    // timestamp format: YYYYMMDDHHmmss
    const ts = closest.timestamp;
    const lastDate = new Date(
      parseInt(ts.slice(0, 4)),
      parseInt(ts.slice(4, 6)) - 1,
      parseInt(ts.slice(6, 8))
    );
    const ageYears = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 365);

    return {
      lastSeen: lastDate.toISOString().slice(0, 10),
      ageYears: Math.round(ageYears * 10) / 10,
      neverCrawled: false,
    };
  } catch {
    return { lastSeen: null, ageYears: null, neverCrawled: false };
  }
}

async function fetchWebsiteSignals(url: string): Promise<{
  isHttps: boolean;
  hasViewport: boolean | null;
  hasMediaQueries: boolean | null;
  copyrightYear: number | null;
  hasGoogleAds: boolean | null;
  fetchFailed: boolean;
}> {
  const isHttps = url.startsWith("https://");

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadFinderBot/1.0)" },
      redirect: "follow",
    });

    // If we got redirected to HTTPS, update the flag
    const finalUrl = res.url || url;
    const finalIsHttps = finalUrl.startsWith("https://");

    if (!res.ok) {
      return { isHttps: finalIsHttps, hasViewport: null, hasMediaQueries: null, copyrightYear: null, hasGoogleAds: null, fetchFailed: true };
    }

    const html = await res.text();
    const lower = html.toLowerCase();

    const hasViewport = lower.includes('name="viewport"') || lower.includes("name='viewport'");
    const hasMediaQueries = lower.includes("@media");

    // Google Ads tag: AW- conversion ID in gtag or googletag
    const hasGoogleAds = /AW-\d{9,12}/.test(html) || lower.includes("googleadservices.com");

    // Copyright year: look for © or "copyright" followed by a 4-digit year
    const copyrightMatch = html.match(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i);
    const copyrightYear = copyrightMatch ? parseInt(copyrightMatch[1]) : null;

    return { isHttps: finalIsHttps, hasViewport, hasMediaQueries, copyrightYear, hasGoogleAds, fetchFailed: false };
  } catch {
    // Fetch failed entirely (timeout, DNS, blocked) — don't penalize the business
    return { isHttps, hasViewport: null, hasMediaQueries: null, copyrightYear: null, hasGoogleAds: null, fetchFailed: true };
  }
}

async function analyzeLead(place: PlaceResult): Promise<AnalyzedResult> {
  const exclusionCheck = isExcludedBusiness(place.types);

  if (exclusionCheck.excluded) {
    return {
      ...place,
      analysis: {
        leadScore: 0,
        scoreReasons: [],
        isExcluded: true,
        excludeReason: exclusionCheck.reason,
        isHttps: null,
        isMobileFriendly: null,
        hasViewport: null,
        hasMediaQueries: null,
        copyrightYear: null,
        lastWaybackSeen: null,
        waybackAgeYears: null,
        neverCrawled: null,
        hasGoogleAds: null,
      },
    };
  }

  const currentYear = new Date().getFullYear();
  let score = 0;
  const reasons: string[] = [];

  // No website — max score, skip web analysis
  if (!place.website) {
    score = 60;
    reasons.push("No website found (+60)");

    if (isHighValueBusiness(place.types)) {
      score += 7;
      reasons.push("High-value business type (+7)");
    }

    return {
      ...place,
      analysis: {
        leadScore: Math.min(score, 100),
        scoreReasons: reasons,
        isExcluded: false,
        isHttps: null,
        isMobileFriendly: null,
        hasViewport: null,
        hasMediaQueries: null,
        copyrightYear: null,
        lastWaybackSeen: null,
        waybackAgeYears: null,
        neverCrawled: null,
        hasGoogleAds: null,
      },
    };
  }

  // Run wayback + website fetch in parallel
  const [wayback, webSignals] = await Promise.all([
    checkWayback(place.website),
    fetchWebsiteSignals(place.website),
  ]);

  // Wayback scoring
  if (wayback.neverCrawled) {
    score += 20;
    reasons.push("Never crawled by Wayback Machine (+20)");
  } else if (wayback.ageYears !== null) {
    if (wayback.ageYears > 2) {
      score += 15;
      reasons.push(`Last crawled ${wayback.ageYears.toFixed(1)}yr ago (+15)`);
    } else if (wayback.ageYears > 1) {
      score += 8;
      reasons.push(`Last crawled ${wayback.ageYears.toFixed(1)}yr ago (+8)`);
    }
  }

  // HTTPS — only score if fetch succeeded or URL is clearly HTTP
  if (!webSignals.isHttps) {
    score += 8;
    reasons.push("Not using HTTPS (+8)");
  }

  // Mobile friendliness — only penalize if we actually fetched the page
  if (!webSignals.fetchFailed) {
    if (!webSignals.hasViewport) {
      score += 12;
      reasons.push("No viewport meta tag — not mobile friendly (+12)");
    }
    if (!webSignals.hasMediaQueries) {
      score += 5;
      reasons.push("No CSS media queries detected (+5)");
    }

    // Copyright year staleness
    if (webSignals.copyrightYear !== null) {
      const yearDiff = currentYear - webSignals.copyrightYear;
      if (yearDiff >= 2) {
        score += 8;
        reasons.push(`Copyright year ${webSignals.copyrightYear} is stale (+8)`);
      }
    }
  }

  // High-value type bonus
  if (isHighValueBusiness(place.types)) {
    score += 7;
    reasons.push("High-value business type (+7)");
  }

  const isMobileFriendly = webSignals.fetchFailed
    ? null
    : (webSignals.hasViewport === true && webSignals.hasMediaQueries === true);

  return {
    ...place,
    analysis: {
      leadScore: Math.min(score, 100),
      scoreReasons: reasons,
      isExcluded: false,
      isHttps: webSignals.isHttps,
      isMobileFriendly,
      hasViewport: webSignals.hasViewport,
      hasMediaQueries: webSignals.hasMediaQueries,
      copyrightYear: webSignals.copyrightYear,
      lastWaybackSeen: wayback.lastSeen,
      waybackAgeYears: wayback.ageYears,
      neverCrawled: wayback.neverCrawled,
      hasGoogleAds: webSignals.hasGoogleAds,
    },
  };
}

// Concurrency-limited parallel execution
async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

export const analyzeLeads = functions
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      try {
        await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
      } catch {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const { places } = req.body as { places: PlaceResult[] };

      if (!places || !Array.isArray(places) || places.length === 0) {
        res.status(400).json({ error: "places array is required" });
        return;
      }

      if (places.length > 200) {
        res.status(400).json({ error: "Maximum 200 places per request" });
        return;
      }

      try {
        const tasks = places.map((place) => async (): Promise<AnalyzedResult> => {
          try {
            return await analyzeLead(place);
          } catch (err) {
            console.error(`[analyzeLeads] failed for ${place.name}:`, err);
            return { ...place, analysis: null, analysisFailed: true };
          }
        });

        // 5 concurrent requests — polite to external servers
        const analyzed = await pLimit(tasks, 5);

        // Sort by lead score descending, excluded last
        analyzed.sort((a, b) => {
          if (a.analysis?.isExcluded && !b.analysis?.isExcluded) return 1;
          if (!a.analysis?.isExcluded && b.analysis?.isExcluded) return -1;
          return (b.analysis?.leadScore ?? 0) - (a.analysis?.leadScore ?? 0);
        });

        res.json({ results: analyzed, totalCount: analyzed.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[analyzeLeads] error:", message);
        res.status(500).json({ error: message });
      }
    });
  });

// ─── DataForSEO Business Search ───────────────────────────────────────────────

export const dataforseoBusinessSearch = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
      // Method check
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      // Body validation
      const { keyword, location } = req.body as { keyword?: string; location?: string };
      if (!keyword) {
        res.status(400).json({ error: "Missing required field: keyword" });
        return;
      }
      if (!location) {
        res.status(400).json({ error: "Missing required field: location" });
        return;
      }

      // Env var check
      const dfsEmail = process.env.DFS_EMAIL;
      const dfsPassword = process.env.DFS_PASSWORD;
      if (!dfsEmail || !dfsPassword) {
        res.status(500).json({ error: "Missing configuration: DFS_EMAIL and DFS_PASSWORD are required" });
        return;
      }

      console.log("[dataforseoBusinessSearch] DFS_EMAIL present:", !!dfsEmail, "| first 4 chars:", dfsEmail.substring(0, 4));

      const auth = buildAuthHeader(dfsEmail, dfsPassword);

      // Partial results accumulator for timeout scenario
      let partialResults: ScoredBusiness[] = [];

      const pipeline = async (): Promise<SearchResponse> => {
        // 1. Business discovery
        let businesses;
        try {
          businesses = await searchBusinesses(keyword, location, auth);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "DataForSEO business search failed";
          res.status(502).json({ error: msg });
          // Return a sentinel so Promise.race doesn't try to send again
          return { results: [] };
        }

        // 2. Pre-flight filter: remove permanently_closed and Facebook URLs
        const filtered = businesses.filter(
          (b) =>
            !b.permanently_closed &&
            !(b.url && b.url.toLowerCase().includes("facebook.com"))
        );

        // 3. Split into no-website and has-website groups
        const noWebsite = filtered.filter((b) => !b.url);
        const hasWebsite = filtered.filter((b) => !!b.url);

        // 4. Score no-website businesses immediately
        const noWebsiteScored: ScoredBusiness[] = noWebsite.map((b) => ({
          name: b.title,
          address: b.address,
          phone: b.phone,
          website: null,
          rating: b.rating?.value ?? null,
          reviewCount: b.rating?.votes_count ?? null,
          category: b.category,
          score: 100,
          label: "no website" as const,
          scoring: {
            total: 100,
            reasons: ["No website found (+100)"],
            lighthousePerformance: null,
            lighthouseSeo: null,
            domainAgeYears: null,
            isExpiredDomain: false,
            isHttps: null,
            wordCount: null,
            hasMetaDescription: null,
            hasFavicon: null,
            fetchFailed: null,
            statusCode: null,
          },
        }));

        partialResults = [...noWebsiteScored];

        // 5. Fetch instant pages for all has-website businesses
        const websiteUrls = hasWebsite.map((b) => b.url as string);
        const htmlSignalsArr = await fetchInstantPages(websiteUrls, auth);

        // 6. Classify: dead site → parked → normal
        const deadSiteScored: ScoredBusiness[] = [];
        const parkedScored: ScoredBusiness[] = [];
        const nonParkedBusinesses: Array<{
          business: typeof hasWebsite[0];
          url: string;
          htmlSignals: typeof htmlSignalsArr[0];
        }> = [];

        for (let i = 0; i < hasWebsite.length; i++) {
          const b = hasWebsite[i];
          const signals = htmlSignalsArr[i];
          const url = b.url as string;

          // Dead site: fetch failed or non-200 — top priority classification
          if (signals.fetchFailed) {
            const statusCode = signals.statusCode;
            const reason = statusCode !== null
              ? `Site returned HTTP ${statusCode} (+90)`
              : "Site unreachable — DNS failure, timeout, or SSL error (+90)";

            deadSiteScored.push({
              name: b.title,
              address: b.address,
              phone: b.phone,
              website: url,
              rating: b.rating?.value ?? null,
              reviewCount: b.rating?.votes_count ?? null,
              category: b.category,
              score: 90,
              label: "dead site",
              scoring: {
                total: 90,
                reasons: [reason],
                lighthousePerformance: null,
                lighthouseSeo: null,
                domainAgeYears: null,
                isExpiredDomain: false,
                isHttps: signals.isHttps,
                wordCount: null,
                hasMetaDescription: null,
                hasFavicon: null,
                fetchFailed: true,
                statusCode: signals.statusCode,
              },
            });
          } else if (isParkedDomain(signals)) {
            parkedScored.push({
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
              },
            });
          } else {
            nonParkedBusinesses.push({ business: b, url, htmlSignals: signals });
          }
        }

        partialResults = [...noWebsiteScored, ...deadSiteScored, ...parkedScored];

        // 7. First 25 non-parked get Lighthouse; all non-parked get domain age
        const first25Urls = nonParkedBusinesses.slice(0, 25).map((x) => x.url);
        const allNonParkedUrls = nonParkedBusinesses.map((x) => x.url);

        // 8. Run Lighthouse (first 25) + domain info (all non-parked) in parallel
        const [lighthouseResults, domainInfoResults] = await Promise.all([
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

        // 9. Score each non-parked business
        // Businesses at index >= 25 get null Lighthouse scores
        const nonParkedScored: ScoredBusiness[] = nonParkedBusinesses.map((item, idx) => {
          const lighthouseScore = idx < 25 ? (lighthouseResults[idx] ?? null) : null;
          const domainInfoOutcome = domainInfoResults[idx];
          const domainInfo = domainInfoOutcome.status === "fulfilled"
            ? domainInfoOutcome.value
            : { ageYears: null, isExpired: false };

          const scorerInput = {
            website: item.url,
            htmlSignals: item.htmlSignals,
            lighthousePerformance: lighthouseScore?.performance ?? null,
            lighthouseSeo: lighthouseScore?.seo ?? null,
            domainAgeYears: domainInfo.ageYears,
            isExpiredDomain: domainInfo.isExpired,
          };

          const { score: s, label, scoring } = score(scorerInput);

          return {
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
          };
        });

        const allScored = [
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

        partialResults = allScored;
        return { results: allScored };
      };

      // Wrap in 290s timeout race
      const timeoutPromise = new Promise<SearchResponse>((resolve) => {
        setTimeout(() => {
          // Sort partial results before returning
          const sorted = [...partialResults].sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
          });
          resolve({ results: sorted, timedOut: true });
        }, 290_000);
      });

      try {
        const result = await Promise.race([pipeline(), timeoutPromise]);
        // If pipeline already sent a 502, result.results will be empty sentinel — don't double-send
        if (!res.headersSent) {
          res.status(200).json(result);
        }
      } catch (err) {
        if (!res.headersSent) {
          const msg = err instanceof Error ? err.message : "Internal server error";
          console.error("[dataforseoBusinessSearch] error:", msg);
          res.status(500).json({ error: msg });
        }
      }
    });
  });
