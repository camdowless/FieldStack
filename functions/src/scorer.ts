import { ScorerInput, BusinessLabel, ScoreBreakdown } from "./types";

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
  };
}

export function score(input: ScorerInput): ScoreResult {
  // No website → always 100 / "no website"
  if (input.website === null) {
    return {
      score: 100,
      label: "no website",
      scoring: buildBreakdown(100, ["No website found (+100)"], input),
    };
  }

  // Dead site: fetch failed or non-200 status code — high opportunity
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

  const clamped = Math.min(100, Math.max(0, raw));
  const label: BusinessLabel = clamped >= 60 ? "opportunity" : "low opportunity";

  return {
    score: clamped,
    label,
    scoring: buildBreakdown(clamped, reasons, input),
  };
}
