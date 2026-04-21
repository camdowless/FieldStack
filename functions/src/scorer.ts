import { ScorerInput, BusinessLabel, ScoreBreakdown, LegitimacyBreakdown } from "./types";

const CURRENT_YEAR = new Date().getFullYear();

export interface ScoreResult {
  score: number | null;
  label: BusinessLabel;
  scoring: ScoreBreakdown | null;
}

function buildBreakdown(
  total: number,
  reasons: string[],
  input: ScorerInput
): ScoreBreakdown {
  return {
    total,
    reasons,
    lighthousePerformance: input.lighthousePerformance,
    lighthouseSeo: input.lighthouseSeo,
    domainAgeYears: input.domainAgeYears,
    isExpiredDomain: input.isExpiredDomain,
    isHttps: input.htmlSignals?.isHttps ?? null,
    wordCount: input.htmlSignals?.wordCount ?? null,
    hasMetaDescription: input.htmlSignals?.hasMetaDescription ?? null,
    hasFavicon: input.htmlSignals?.hasFavicon ?? null,
    fetchFailed: input.htmlSignals?.fetchFailed ?? null,
    statusCode: input.htmlSignals?.statusCode ?? null,
    onpageScore: input.htmlSignals?.onpageScore ?? null,
  };
}

// ─── Error page detection ─────────────────────────────────────────────────────

const ERROR_PAGE_TITLE_PATTERNS = [
  /403/i, /404/i, /forbidden/i, /not found/i, /error/i,
  /500/i, /502/i, /503/i, /service unavailable/i,
];

// Titles that unambiguously mean "this domain has no real site" regardless of DOM size.
// Kept tight to avoid false positives on legitimate pages that mention these phrases.
const UNPUBLISHED_SITE_PATTERNS = [
  /^site not found$/i,
  /^page not found$/i,
  /not published/i,
  /domain not configured/i,
  /no site (is )?associated/i,
  /coming soon/i,
  /under construction/i,
];

function isErrorPage(input: ScorerInput): boolean {
  const signals = input.htmlSignals;
  if (!signals) return false;

  const title = signals.pageMeta?.title ?? "";

  // Unambiguous "no site here" titles — catch regardless of DOM size
  if (UNPUBLISHED_SITE_PATTERNS.some((p) => p.test(title))) return true;

  // Tiny DOM size is a strong signal of an error/stub page
  if (signals.totalDomSize !== null && signals.totalDomSize < 500) {
    if (ERROR_PAGE_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  }

  // Header/footer both contain error text
  const header = signals.headerText.toLowerCase();
  const footer = signals.footerText.toLowerCase();
  if (
    (header.includes("403 forbidden") || header.includes("404 not found")) &&
    (footer.includes("403 forbidden") || footer.includes("404 not found"))
  ) {
    return true;
  }

  return false;
}

// ─── Defunct / acquired business detection ─────────────────────────────────────

const DEFUNCT_PATTERNS = [
  /\bmoved\b/i, /\bpartnered\b/i, /\bacquired\b/i,
  /\bnow part of\b/i, /\bunder new management\b/i,
  /\bpermanently closed\b/i, /\bmerged\b/i, /\bwe['']ve moved\b/i,
];

function isDefunctBusiness(input: ScorerInput): { defunct: boolean; reason: string } {
  const signals = input.htmlSignals;
  if (!signals?.pageMeta) return { defunct: false, reason: "" };

  const contentWordCount = signals.pageMeta.contentWordCount ?? 0;
  // Only flag if the site has very little content (merger announcement page)
  if (contentWordCount > 150) return { defunct: false, reason: "" };

  const textsToCheck = [
    signals.pageMeta.title ?? "",
    signals.pageMeta.socialMediaTags?.["og:title"] ?? "",
    signals.pageMeta.socialMediaTags?.["og:description"] ?? "",
    signals.headerText,
  ];

  for (const text of textsToCheck) {
    for (const pattern of DEFUNCT_PATTERNS) {
      if (pattern.test(text)) {
        return {
          defunct: true,
          reason: `Business appears defunct/acquired: "${text.substring(0, 80)}"`,
        };
      }
    }
  }

  return { defunct: false, reason: "" };
}

// ─── National / chain / SaaS detection ────────────────────────────────────────

function isNationalChain(input: ScorerInput): { chain: boolean; reason: string } {
  const signals = input.htmlSignals;
  if (!signals?.pageMeta) return { chain: false, reason: "" };

  let chainSignals = 0;
  const reasons: string[] = [];

  // Toll-free number
  const phone = input.phone ?? "";
  if (/^\+?1?(800|833|844|855|866|877|888)/.test(phone.replace(/\D/g, ""))) {
    chainSignals += 2;
    reasons.push("toll-free number");
  }

  // High script count (professional product team)
  const scriptsCount = signals.pageMeta.scriptsCount ?? 0;
  if (scriptsCount > 20) {
    chainSignals += 1;
    reasons.push(`${scriptsCount} scripts`);
  }

  // High external link count
  const externalLinks = signals.pageMeta.externalLinksCount ?? 0;
  if (externalLinks > 40) {
    chainSignals += 1;
    reasons.push(`${externalLinks} external links`);
  }

  // Social media tags (OG + Twitter cards both present)
  const social = signals.pageMeta.socialMediaTags ?? {};
  const hasOg = !!social["og:title"];
  const hasTwitter = !!social["twitter:card"];
  if (hasOg && hasTwitter) {
    chainSignals += 1;
    reasons.push("full social media tags");
  }

  // Generator tag indicating professional CMS/tooling
  const generator = signals.pageMeta.generator ?? "";
  if (generator.includes("Site Kit")) {
    chainSignals += 1;
    reasons.push(`generator: ${generator}`);
  }

  // Need at least 3 signals to flag as chain
  if (chainSignals >= 3) {
    return {
      chain: true,
      reason: `National/chain signals: ${reasons.join(", ")}`,
    };
  }

  return { chain: false, reason: "" };
}

export function score(input: ScorerInput): ScoreResult {
  // ─── Permanently closed ───────────────────────────────────────────────
  if (input.permanentlyClosed) {
    return {
      score: null,
      label: "permanently closed",
      scoring: buildBreakdown(0, ["Business is permanently closed"], input),
    };
  }

  // ─── Defunct / acquired business detection ────────────────────────────
  const defunctCheck = isDefunctBusiness(input);
  if (defunctCheck.defunct) {
    return {
      score: null,
      label: "defunct",
      scoring: buildBreakdown(0, [defunctCheck.reason], input),
    };
  }

  // ─── National / chain / SaaS disqualification ────────────────────────
  const chainCheck = isNationalChain(input);
  if (chainCheck.chain) {
    return {
      score: null,
      label: "disqualified",
      scoring: buildBreakdown(0, [chainCheck.reason], input),
    };
  }

  // ─── 403 Forbidden: server alive but blocking crawler ────────────────
  if (input.htmlSignals !== null && input.htmlSignals.statusCode === 403 && !input.htmlSignals.fetchFailed) {
    return {
      score: null,
      label: "disqualified",
      scoring: buildBreakdown(0, ["Site returned HTTP 403 — bot protection or auth wall; server is live and secure"], input),
    };
  }

  // ─── Uncrawlable: DFS task succeeded (20000) but returned no content ──
  // Server is reachable but DFS can't parse it (Cloudflare, JS-heavy SPA, etc.)
  // Treat as live — do not mark dead.
  if (input.htmlSignals !== null && !input.htmlSignals.fetchFailed && input.htmlSignals.statusCode === null && input.htmlSignals.totalDomSize === null) {
    return {
      score: null,
      label: "disqualified",
      scoring: buildBreakdown(0, ["Site is live but could not be crawled — likely bot protection or heavy JS"], input),
    };
  }

  // ─── Compute legitimacy for the multiplier ────────────────────────────
  // Piecewise: 70–100 legitimacy → 0.90–1.0 (gentle), 0–70 → 0.0–0.90 (real penalty)
  const { legitimacyScore } = computeLegitimacy(input);
  const legitimacyMultiplier = legitimacyScore >= 70
    ? 0.9 + ((legitimacyScore - 70) / 30) * 0.1
    : (legitimacyScore / 70) * 0.9;

  // ─── No website → status label, base 100 ──────────────────────────────
  if (input.website === null) {
    const reasons: string[] = ["No website found (+100)"];
    let raw = 100;

    if (input.isClaimed) {
      raw += 5;
      reasons.push("Google listing claimed — owner is digitally engaged (+5)");
    }

    const beforeLegitimacy = Math.min(100, Math.max(0, raw));
    const final = Math.round(beforeLegitimacy * legitimacyMultiplier);
    if (legitimacyMultiplier < 1) {
      reasons.push(`Legitimacy adjustment ×${legitimacyMultiplier.toFixed(2)} (legitimacy ${legitimacyScore}/100)`);
    }
    return {
      score: Math.min(100, Math.max(0, final)),
      label: "no website",
      scoring: buildBreakdown(Math.min(100, Math.max(0, final)), reasons, input),
    };
  }

  // ─── Dead site: fetch failed or non-200 ───────────────────────────────
  if (input.htmlSignals !== null && input.htmlSignals.fetchFailed) {
    const reasons: string[] = [];
    const statusCode = input.htmlSignals.statusCode;

    if (statusCode !== null) {
      reasons.push(`Site returned HTTP ${statusCode} (+90)`);
    } else {
      reasons.push("Site unreachable — DNS failure, timeout, or SSL error (+90)");
    }

    const raw = 90;
    const final = Math.round(raw * legitimacyMultiplier);
    if (legitimacyMultiplier < 1) {
      reasons.push(`Legitimacy adjustment ×${legitimacyMultiplier.toFixed(2)} (legitimacy ${legitimacyScore}/100)`);
    }
    return {
      score: Math.min(100, Math.max(0, final)),
      label: "dead site",
      scoring: buildBreakdown(Math.min(100, Math.max(0, final)), reasons, input),
    };
  }

  // ─── Error page detection (403/404 that returned 200 from DFS) ────────
  if (isErrorPage(input)) {
    const title = input.htmlSignals?.pageMeta?.title ?? "error page";
    const reasons = [`Site serves error page: "${title}" — effectively dead (+90)`];

    const raw = 90;
    const final = Math.round(raw * legitimacyMultiplier);
    if (legitimacyMultiplier < 1) {
      reasons.push(`Legitimacy adjustment ×${legitimacyMultiplier.toFixed(2)} (legitimacy ${legitimacyScore}/100)`);
    }
    return {
      score: Math.min(100, Math.max(0, final)),
      label: "dead site",
      scoring: buildBreakdown(Math.min(100, Math.max(0, final)), reasons, input),
    };
  }

  // ─── Normal scoring ───────────────────────────────────────────────────
  let raw = 0;
  const reasons: string[] = [];

  // HTML signal scoring
  if (input.htmlSignals !== null) {
    const s = input.htmlSignals;

    // HTTPS — still a strong signal of neglect in 2026
    if (!s.isHttps) {
      raw += 25;
      reasons.push("Not using HTTPS (+25)");
    }
    if (!s.hasMetaDescription) {
      raw += 20;
      reasons.push("No meta description (+20)");
    }
    if (!s.hasFavicon) {
      raw += 10;
      reasons.push("No favicon (+10)");
    }
    if (s.deprecatedTagCount > 0) {
      raw += 15;
      reasons.push(`${s.deprecatedTagCount} deprecated HTML tag(s) (+15)`);
    }
    if (s.copyrightYear !== null && CURRENT_YEAR - s.copyrightYear > 2) {
      raw += 10;
      reasons.push(`Copyright year ${s.copyrightYear} is stale (+10)`);
    }
    if (s.wordCount > 0 && s.wordCount < 300) {
      raw += 10;
      reasons.push(`Low word count: ${s.wordCount} (+10)`);
    }
    if (s.hasAdPixel) {
      raw -= 10;
      reasons.push("Has ad/analytics pixel (-10)");
    }
    if (s.hasAgencyFooter) {
      raw -= 15;
      reasons.push("Has agency footer credit (-15)");
    }

    // onpageScore from DataForSEO (0–100, higher = better site)
    // Use as supplementary signal to avoid double-counting with individual checks
    if (s.onpageScore !== null && s.onpageScore < 40) {
      const pts = s.onpageScore < 20 ? 10 : 5;
      raw += pts;
      reasons.push(`DFS on-page score ${s.onpageScore}/100 (+${pts})`);
    }

    // Page timing signals — only penalize when data is present AND bad
    if (s.pageTiming) {
      const tti = s.pageTiming.timeToInteractive;
      if (tti !== null && tti !== undefined && tti > 5000) {
        const pts = tti > 8000 ? 8 : 5;
        raw += pts;
        reasons.push(`Slow time-to-interactive: ${(tti / 1000).toFixed(1)}s (+${pts})`);
      }
      const lcp = s.pageTiming.largestContentfulPaint;
      if (lcp !== null && lcp !== undefined && lcp > 4000) {
        const pts = lcp > 7000 ? 8 : 5;
        raw += pts;
        reasons.push(`Slow largest contentful paint: ${(lcp / 1000).toFixed(1)}s (+${pts})`);
      }
    }

    // pageChecks-based signals
    const checks = s.pageChecks;
    if (checks) {
      if (checks.deprecatedHtmlTags) {
        raw += 5;
        reasons.push("Uses deprecated HTML tags (+5)");
      }
      if (checks.hasRenderBlockingResources) {
        raw += 5;
        reasons.push("Has render-blocking resources (+5)");
      }
      if (checks.hasFrame) {
        raw += 3;
        reasons.push("Uses iframes — dated pattern (+3)");
      }
      if (checks.noImageAlt) {
        raw += 5;
        reasons.push("Images missing alt text — accessibility issue (+5)");
      }
    }
  }

  // Lighthouse scoring
  if (input.lighthousePerformance !== null) {
    const pts = Math.floor((1 - input.lighthousePerformance) * 20);
    if (pts > 0) {
      raw += pts;
      reasons.push(`Lighthouse performance ${(input.lighthousePerformance * 100).toFixed(0)}% (+${pts})`);
    }
  }
  if (input.lighthouseSeo !== null) {
    const pts = Math.floor((1 - input.lighthouseSeo) * 15);
    if (pts > 0) {
      raw += pts;
      reasons.push(`Lighthouse SEO ${(input.lighthouseSeo * 100).toFixed(0)}% (+${pts})`);
    }
  }

  // Domain age scoring
  if (input.domainAgeYears !== null && input.domainAgeYears < 2) {
    raw += 10;
    reasons.push(`Domain age ${input.domainAgeYears}yr — relatively new (+10)`);
  }

  // Expired domain — big signal
  if (input.isExpiredDomain) {
    raw += 25;
    reasons.push("Domain registration expired (+25)");
  }

  // ─── Business activity signals (increased weight) ─────────────────────

  // isClaimed modifier — stronger weight
  if (!input.isClaimed) {
    raw += 12;
    reasons.push("Google listing unclaimed — less digitally engaged (+12)");
  } else {
    raw -= 5;
    reasons.push("Google listing claimed — owner is engaged (-5)");
  }

  // currentStatus: "close"
  if (input.currentStatus === "close") {
    raw += 5;
    reasons.push("Business currently listed as closed (+5)");
  }

  // Low review count — business may not be investing in reputation
  if (input.reviewCount !== null) {
    if (input.reviewCount === 0) {
      raw += 8;
      reasons.push("Zero reviews — no online reputation management (+8)");
    } else if (input.reviewCount < 5) {
      raw += 4;
      reasons.push(`Only ${input.reviewCount} review(s) — minimal online presence (+4)`);
    }
  }

  // New business risk: firstSeen within last 30 days + low reviews
  if (input.firstSeen && input.reviewCount !== null && input.reviewCount < 5) {
    const firstSeenDate = new Date(input.firstSeen);
    if (!isNaN(firstSeenDate.getTime())) {
      const daysSinceFirstSeen = (Date.now() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceFirstSeen <= 30) {
        raw -= 5;
        reasons.push("New listing (<30 days) with few reviews — risk signal (-5)");
      }
    }
  }

  // firstSeen age: old listing with stale/no content updates is a signal
  if (input.firstSeen && input.htmlSignals) {
    const firstSeenDate = new Date(input.firstSeen);
    if (!isNaN(firstSeenDate.getTime())) {
      const yearsSinceFirstSeen = (Date.now() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
      const lastMod = input.htmlSignals.lastModifiedMetaTag ?? input.htmlSignals.lastModifiedHeader;
      if (yearsSinceFirstSeen > 5 && !lastMod) {
        raw += 5;
        reasons.push(`Listing first seen ${yearsSinceFirstSeen.toFixed(1)}yr ago with no content update date (+5)`);
      }
    }
  }

  // Rating distribution: high 1-star percentage
  if (input.ratingDistribution && input.reviewCount && input.reviewCount >= 5) {
    const oneStars = input.ratingDistribution["1"] ?? 0;
    const pctDissatisfied = oneStars / input.reviewCount;
    if (pctDissatisfied >= 0.2) {
      raw -= 3;
      reasons.push(`${(pctDissatisfied * 100).toFixed(0)}% one-star reviews — difficult client risk (-3)`);
    }
  }

  // ─── CMS / tech stack scoring ─────────────────────────────────────────

  if (input.htmlSignals?.pageMeta?.generator) {
    const gen = input.htmlSignals.pageMeta.generator.toLowerCase();
    if (gen.includes("weebly") || gen.includes("jimdo") || gen.includes("site123")) {
      raw += 8;
      reasons.push(`Built on outdated builder: ${input.htmlSignals.pageMeta.generator} (+8)`);
    } else if (gen.includes("godaddy")) {
      raw += 6;
      reasons.push(`Built on GoDaddy Website Builder (+6)`);
    } else if (gen.includes("wix") || gen.includes("squarespace") || gen.includes("duda")) {
      raw -= 5;
      reasons.push(`Built on modern builder: ${input.htmlSignals.pageMeta.generator} (-5)`);
    }
  }
  // Weebly detection via footer script pattern (no generator tag)
  if (input.htmlSignals && !input.htmlSignals.pageMeta?.generator) {
    const footer = input.htmlSignals.footerText;
    if (footer.includes("_w.jquery") || footer.includes("weebly.com")) {
      raw += 8;
      reasons.push("Weebly builder detected via footer scripts (+8)");
    }
    // GoDaddy builder detection via footer
    if (footer.includes("godaddy.com") || footer.includes("secureserver.net")) {
      raw += 6;
      reasons.push("GoDaddy builder detected via footer (+6)");
    }
  }

  // ─── Apply legitimacy multiplier ──────────────────────────────────────
  const clampedRaw = Math.min(100, Math.max(0, raw));
  const final = Math.round(clampedRaw * legitimacyMultiplier);
  if (legitimacyMultiplier < 1) {
    reasons.push(`Legitimacy adjustment ×${legitimacyMultiplier.toFixed(2)} (legitimacy ${legitimacyScore}/100)`);
  }

  const clamped = Math.min(100, Math.max(0, final));

  return {
    score: clamped,
    label: "scored",
    scoring: buildBreakdown(clamped, reasons, input),
  };
}


// ─── Legitimacy Score ─────────────────────────────────────────────────────────
// Answers: "Is this an actual operating business?"
// Independent of the lead/opportunity score.
// Returns 0–100 where higher = more likely legitimate.
// Uses penalties for missing critical signals + bonuses for positive ones.

export interface LegitimacyResult {
  legitimacyScore: number;
  legitimacyBreakdown: LegitimacyBreakdown;
}

export function computeLegitimacy(input: ScorerInput): LegitimacyResult {
  let raw = 0;
  const reasons: string[] = [];

  // ─────────────────────────────────────────────
  // HARD DISQUALIFIERS — return 0 immediately
  // ─────────────────────────────────────────────

  if (input.permanentlyClosed) {
    return {
      legitimacyScore: 0,
      legitimacyBreakdown: { total: 0, reasons: ["DISQUALIFIED: Permanently closed"] },
    };
  }

  // No phone AND no website AND no address = shell listing
  if (!input.phone && !input.website && !input.address) {
    return {
      legitimacyScore: 0,
      legitimacyBreakdown: { total: 0, reasons: ["DISQUALIFIED: No phone, website, or address"] },
    };
  }

  // ─────────────────────────────────────────────
  // PENALTIES (applied first so we can go negative)
  // ─────────────────────────────────────────────

  // Unclaimed listing — strongest ghost signal
  if (!input.isClaimed) {
    raw -= 20;
    reasons.push("Unclaimed listing (-20)");
  }

  // No reviews at all
  const reviews = input.reviewCount ?? 0;
  if (reviews === 0) {
    raw -= 20;
    reasons.push("Zero reviews (-20)");
  }

  // No phone number — core to "will they answer the phone"
  if (!input.phone) {
    raw -= 15;
    reasons.push("No phone number (-15)");
  }

  // No photos — strong ghost indicator
  const photos = input.totalPhotos ?? 0;
  if (photos === 0) {
    raw -= 10;
    reasons.push("No photos (-10)");
  }

  // Review recency — stale reviews mean dead or dying business
  if (input.daysSinceLastReview !== null) {
    if (input.daysSinceLastReview > 730) {
      raw -= 25;
      reasons.push(`Last review ${Math.floor(input.daysSinceLastReview / 365)}yr ago (-25)`);
    } else if (input.daysSinceLastReview > 365) {
      raw -= 15;
      reasons.push("Last review over 1yr ago (-15)");
    }
  } else if (reviews > 0) {
    // Has reviews but no date data — mild penalty for uncertainty
    raw -= 5;
    reasons.push("Review recency unknown (-5)");
  }

  // Suspicious rating: 5.0 with very few reviews = likely fake/friends
  if (input.rating !== null && input.rating >= 4.8 && reviews > 0 && reviews <= 3) {
    raw -= 8;
    reasons.push(`Suspicious rating (${input.rating} from only ${reviews} reviews) (-8)`);
  }

  // ─────────────────────────────────────────────
  // POSITIVE SIGNALS
  // ─────────────────────────────────────────────

  // Review count — higher bar, recency bonus stacks separately
  if (reviews >= 50) {
    raw += 25;
    reasons.push(`${reviews} reviews (+25)`);
  } else if (reviews >= 20) {
    raw += 18;
    reasons.push(`${reviews} reviews (+18)`);
  } else if (reviews >= 10) {
    raw += 12;
    reasons.push(`${reviews} reviews (+12)`);
  } else if (reviews >= 5) {
    raw += 6;
    reasons.push(`${reviews} reviews (+6)`);
  } else if (reviews >= 1) {
    raw += 2;
    reasons.push(`${reviews} review(s) (+2)`);
  }

  // Recency bonus — biggest trust signal (null = skip, future reviews API)
  if (input.daysSinceLastReview !== null) {
    if (input.daysSinceLastReview <= 30) {
      raw += 20;
      reasons.push("Review within last 30 days (+20)");
    } else if (input.daysSinceLastReview <= 90) {
      raw += 15;
      reasons.push("Review within last 90 days (+15)");
    } else if (input.daysSinceLastReview <= 180) {
      raw += 10;
      reasons.push("Review within last 6 months (+10)");
    } else if (input.daysSinceLastReview <= 365) {
      raw += 5;
      reasons.push("Review within last year (+5)");
    }
  }

  // Rating quality — only meaningful with decent review volume
  if (input.rating !== null && reviews >= 5) {
    if (input.rating >= 4.0) {
      raw += 8;
      reasons.push(`${input.rating}★ rating (+8)`);
    } else if (input.rating >= 3.0) {
      raw += 3;
      reasons.push(`${input.rating}★ rating (+3)`);
    }
  }

  // Claimed listing — owner is engaged
  if (input.isClaimed) {
    raw += 15;
    reasons.push("Claimed listing (+15)");
  }

  // Phone number
  if (input.phone) {
    raw += 12;
    reasons.push("Has phone number (+12)");
  }

  // Website
  if (input.website) {
    raw += 10;
    reasons.push("Has website (+10)");
  }

  // Photos
  if (photos >= 20) {
    raw += 15;
    reasons.push(`${photos} photos (+15)`);
  } else if (photos >= 5) {
    raw += 10;
    reasons.push(`${photos} photos (+10)`);
  } else if (photos >= 1) {
    raw += 4;
    reasons.push(`${photos} photo(s) (+4)`);
  }

  // Owner responds to reviews — very strong active signal (future: reviews API)
  if (input.hasOwnerResponses) {
    raw += 10;
    reasons.push("Owner responds to reviews (+10)");
  }

  // Business hours posted
  if (input.hasBusinessHours) {
    raw += 8;
    reasons.push("Business hours listed (+8)");
  }

  // Physical address
  if (input.address) {
    raw += 5;
    reasons.push("Has address (+5)");
  }

  // Social presence — reduced weight, Facebook is not special
  if (input.socialLinkCount >= 2) {
    raw += 5;
    reasons.push(`${input.socialLinkCount} social links (+5)`);
  } else if (input.hasFacebookLink || input.socialLinkCount >= 1) {
    raw += 3;
    reasons.push("Social link (+3)");
  }

  // Secondary signals — low weight, nice to have
  if (input.hasLogo || input.hasMainImage) {
    raw += 3;
    reasons.push("Has logo/image (+3)");
  }
  if (input.hasDescription) {
    raw += 3;
    reasons.push("Has description (+3)");
  }
  if (input.hasAttributes) {
    raw += 2;
    reasons.push("Has attributes (+2)");
  }
  if (input.currentStatus === "open") {
    raw += 3;
    reasons.push("Currently open (+3)");
  }

  // Bonus: Google knowledge graph signals
  if (input.hasPeopleAlsoSearch) {
    raw += 5;
    reasons.push("In Google's 'people also search' (+5)");
  }
  if (input.hasPlaceTopics) {
    raw += 5;
    reasons.push("Has Google place topics from reviews (+5)");
  }

  const clamped = Math.min(100, Math.max(0, raw));
  return {
    legitimacyScore: clamped,
    legitimacyBreakdown: { total: clamped, reasons },
  };
}
