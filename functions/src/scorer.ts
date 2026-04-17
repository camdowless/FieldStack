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

function isErrorPage(input: ScorerInput): boolean {
  const signals = input.htmlSignals;
  if (!signals) return false;

  // Tiny DOM size is a strong signal of an error/stub page
  if (signals.totalDomSize !== null && signals.totalDomSize < 500) {
    const title = signals.pageMeta?.title ?? "";
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
  // ─── No website → always 100 / "no website" ──────────────────────────
  if (input.website === null) {
    const reasons: string[] = ["No website found (+100)"];
    let raw = 100;

    // isClaimed boost: claimed = owner is engaged, better prospect
    if (input.isClaimed) {
      raw += 5;
      reasons.push("Google listing claimed — owner is digitally engaged (+5)");
    }

    const clamped = Math.min(100, Math.max(0, raw));
    return {
      score: clamped,
      label: "no website",
      scoring: buildBreakdown(clamped, reasons, input),
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

    return {
      score: 90,
      label: "dead site",
      scoring: buildBreakdown(90, reasons, input),
    };
  }

  // ─── Error page detection (403/404 that returned 200 from DFS) ────────
  if (isErrorPage(input)) {
    const title = input.htmlSignals?.pageMeta?.title ?? "error page";
    const reasons = [`Site serves error page: "${title}" — effectively dead (+90)`];
    return {
      score: 90,
      label: "dead site",
      scoring: buildBreakdown(90, reasons, input),
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

  // ─── Normal scoring ───────────────────────────────────────────────────
  let raw = 0;
  const reasons: string[] = [];

  // HTML signal scoring
  if (input.htmlSignals !== null) {
    const s = input.htmlSignals;

    if (!s.isHttps) {
      raw += 30;
      reasons.push("Not using HTTPS (+30)");
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

  // ─── Business activity signals ──────────────────────────────────────

  // isClaimed modifier
  if (!input.isClaimed) {
    raw += 5;
    reasons.push("Google listing unclaimed — less digitally engaged (+5)");
  } else {
    raw -= 3;
    reasons.push("Google listing claimed — owner is engaged (-3)");
  }

  // currentStatus: "close"
  if (input.currentStatus === "close") {
    raw += 5;
    reasons.push("Business currently listed as closed (+5)");
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
  }

  const clamped = Math.min(100, Math.max(0, raw));
  const label: BusinessLabel = clamped >= 60 ? "opportunity" : "low opportunity";

  return {
    score: clamped,
    label,
    scoring: buildBreakdown(clamped, reasons, input),
  };
}


// ─── Legitimacy Score ─────────────────────────────────────────────────────────
// Answers: "Is this an actual operating business?"
// Independent of the lead/opportunity score.
// Returns 0–100 where higher = more likely legitimate.

export interface LegitimacyResult {
  legitimacyScore: number;
  legitimacyBreakdown: LegitimacyBreakdown;
}

export function computeLegitimacy(input: ScorerInput): LegitimacyResult {
  let raw = 0;
  const reasons: string[] = [];

  // ── Review count (max +20) ──
  const reviews = input.reviewCount ?? 0;
  if (reviews >= 10) {
    raw += 20;
    reasons.push(`${reviews} reviews (+20)`);
  } else if (reviews >= 5) {
    raw += 12;
    reasons.push(`${reviews} reviews (+12)`);
  } else if (reviews >= 1) {
    raw += 5;
    reasons.push(`${reviews} review(s) (+5)`);
  }

  // ── Rating quality (max +10) ──
  if (input.rating !== null && input.rating >= 4.0 && reviews >= 3) {
    raw += 10;
    reasons.push(`${input.rating} rating with ${reviews}+ reviews (+10)`);
  }

  // ── Photos (max +15) ──
  const photos = input.totalPhotos ?? 0;
  if (photos >= 5) {
    raw += 15;
    reasons.push(`${photos} photos (+15)`);
  } else if (photos >= 1) {
    raw += 8;
    reasons.push(`${photos} photo(s) (+8)`);
  }

  // ── Facebook link (max +15) ──
  if (input.hasFacebookLink) {
    raw += 15;
    reasons.push("Has Facebook link (+15)");
  }

  // ── Other social links (max +5, stacks with Facebook) ──
  if (input.socialLinkCount > (input.hasFacebookLink ? 1 : 0)) {
    raw += 5;
    reasons.push(`${input.socialLinkCount} social link(s) (+5)`);
  }

  // ── Claimed listing (max +10) ──
  if (input.isClaimed) {
    raw += 10;
    reasons.push("Listing is claimed (+10)");
  }

  // ── Has address (max +5) ──
  if (input.address) {
    raw += 5;
    reasons.push("Has physical address (+5)");
  }

  // ── Has phone (max +5) ──
  if (input.phone) {
    raw += 5;
    reasons.push("Has phone number (+5)");
  }

  // ── Logo or main image (max +5) ──
  if (input.hasLogo || input.hasMainImage) {
    raw += 5;
    reasons.push("Has logo/image (+5)");
  }

  // ── Attributes filled in (max +3) ──
  if (input.hasAttributes) {
    raw += 3;
    reasons.push("Has listing attributes (+3)");
  }

  // ── Has website (max +5) ──
  if (input.website) {
    raw += 5;
    reasons.push("Has website (+5)");
  }

  // ── Current status open (max +5) ──
  if (input.currentStatus === "open") {
    raw += 5;
    reasons.push("Status: open (+5)");
  }

  // ── Has description (max +2) ──
  if (input.hasDescription) {
    raw += 2;
    reasons.push("Has description (+2)");
  }

  const clamped = Math.min(100, Math.max(0, raw));
  return {
    legitimacyScore: clamped,
    legitimacyBreakdown: { total: clamped, reasons },
  };
}
