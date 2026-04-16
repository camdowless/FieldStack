import { BusinessRaw, HtmlSignals } from "./types";

const DFS_BASE = "https://api.dataforseo.com/v3";

const AD_PIXEL_DOMAINS = [
  "googletagmanager.com",
  "google-analytics.com",
  "googleadservices.com",
  "facebook.net",
  "connect.facebook.net",
  "ads.linkedin.com",
  "static.ads-twitter.com",
  "snap.licdn.com",
];

const AGENCY_FOOTER_PATTERNS = [
  /built by/i,
  /designed by/i,
  /powered by/i,
  /web design by/i,
  /developed by/i,
  /created by/i,
  /a .+ agency/i,
];

const PARKING_KEYWORDS = [
  "buy this domain",
  "domain for sale",
  "this domain is for sale",
  "register this domain",
  "domain parking",
  "parked domain",
  "parked by",
  "this page is parked",
  "domain is parked",
  "sedoparking",
  "hugedomains",
  "dan.com",
  "afternic",
];

const CUSTOM_JS = `(function() {
  var bodyText = document.body ? document.body.innerText : '';
  var header = bodyText.substring(0, 500);
  var footer = bodyText.substring(Math.max(0, bodyText.length - 500));
  var match = footer.match(/\\b(19|20)\\d{2}\\b/);
  return JSON.stringify({ headerText: header, footerText: footer, copyrightYear: match ? parseInt(match[0], 10) : null });
})()`;

export function buildAuthHeader(email: string, password: string): string {
  return "Basic " + Buffer.from(email + ":" + password).toString("base64");
}

export interface FooterData {
  headerText: string;
  footerText: string;
  copyrightYear: number | null;
}

export function extractFooterData(customJsResponse: string | null | undefined): FooterData {
  if (!customJsResponse) {
    return { headerText: "", footerText: "", copyrightYear: null };
  }
  try {
    const parsed = JSON.parse(customJsResponse);
    return {
      headerText: typeof parsed.headerText === "string" ? parsed.headerText.toLowerCase() : "",
      footerText: typeof parsed.footerText === "string" ? parsed.footerText.toLowerCase() : "",
      copyrightYear: typeof parsed.copyrightYear === "number" ? parsed.copyrightYear : null,
    };
  } catch {
    return { headerText: "", footerText: "", copyrightYear: null };
  }
}

export function extractHtmlSignals(
  url: string,
  page: Record<string, unknown>,
  statusCode: number | null = 200
): HtmlSignals {
  const meta = (page.meta ?? {}) as Record<string, unknown>;
  const content = (meta.content ?? {}) as Record<string, unknown>;
  const checks = (page.checks ?? {}) as Record<string, unknown>;
  const resourceTags = (page.resource_tags ?? {}) as Record<string, unknown>;
  const scripts = Array.isArray(resourceTags.scripts) ? resourceTags.scripts as Array<Record<string, unknown>> : [];

  const wordCount = typeof content.words_count === "number" ? content.words_count : 0;
  const hasMetaDescription = !(checks.no_description === true);
  const hasFavicon = !(checks.no_favicon === true);
  const deprecatedTagCount = typeof checks.deprecated_tags === "number" ? checks.deprecated_tags : 0;

  // HTTPS detection: check final URL after redirects, and DataForSEO's own is_https check
  const finalUrl = typeof page.url === "string" ? page.url : url;
  const dfsIsHttps = checks.is_https === true;
  const isHttps = finalUrl.startsWith("https://") || dfsIsHttps;
  const redirectedToHttps = !url.startsWith("https://") && isHttps;

  const { headerText, footerText, copyrightYear } = extractFooterData(
    typeof page.custom_js_response === "string" ? page.custom_js_response : null
  );

  const hasAdPixel = scripts.some((script) => {
    const scriptUrl = typeof script.url === "string" ? script.url : "";
    return AD_PIXEL_DOMAINS.some((domain) => scriptUrl.includes(domain));
  });

  const hasAgencyFooter = AGENCY_FOOTER_PATTERNS.some((pattern) => pattern.test(footerText));

  return {
    wordCount,
    hasMetaDescription,
    hasFavicon,
    isHttps,
    deprecatedTagCount,
    copyrightYear,
    headerText,
    footerText,
    hasAdPixel,
    hasAgencyFooter,
    statusCode,
    fetchFailed: false,
    redirectedToHttps,
    finalUrl,
  };
}

export function isParkedDomain(signals: HtmlSignals): boolean {
  // Only classify as parked if we find explicit parking keywords
  // in the page's visible text (header + footer regions).
  const combined = `${signals.footerText} ${signals.headerText ?? ""}`.toLowerCase();
  return PARKING_KEYWORDS.some((kw) => combined.includes(kw));
}

export async function searchBusinesses(
  keyword: string,
  location: string,
  authHeader: string
): Promise<BusinessRaw[]> {
  const requestBody = [{
    categories: [keyword.toLowerCase().replace(/\s+/g, "_")],
    location_coordinate: location.replace(/\s+/g, ""),
    limit: 50,
  }];
  console.log("[searchBusinesses] Request:", {
    url: `${DFS_BASE}/business_data/business_listings/search/live`,
    authHeaderPrefix: authHeader.substring(0, 15) + "...",
    body: JSON.stringify(requestBody).substring(0, 200),
  });

  const response = await fetch(`${DFS_BASE}/business_data/business_listings/search/live`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log("[searchBusinesses] Response status:", response.status, response.statusText);

  if (!response.ok) {
    const errorBody = await response.text();
    console.log("[searchBusinesses] Error body:", errorBody);
    throw new Error(`DataForSEO business search failed: ${response.status} - ${errorBody}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
  const result = tasks?.[0]?.result as Array<Record<string, unknown>> | undefined;
  const items = result?.[0]?.items as BusinessRaw[] | undefined;
  return items ?? [];
}

/** Build a dead-site HtmlSignals stub for URLs that failed to fetch. */
function deadSiteSignals(url: string, statusCode: number | null): HtmlSignals {
  return {
    wordCount: 0,
    hasMetaDescription: false,
    hasFavicon: false,
    isHttps: url.startsWith("https://"),
    deprecatedTagCount: 0,
    copyrightYear: null,
    headerText: "",
    footerText: "",
    hasAdPixel: false,
    hasAgencyFooter: false,
    statusCode,
    fetchFailed: true,
    redirectedToHttps: false,
    finalUrl: null,
  };
}

export async function fetchInstantPages(
  urls: string[],
  authHeader: string
): Promise<(HtmlSignals)[]> {
  const requests = urls.map((url) =>
    fetch(`${DFS_BASE}/on_page/instant_pages`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          url,
          custom_js: CUSTOM_JS,
          load_resources: true,
          enable_javascript: true,
        },
      ]),
    })
  );

  const settled = await Promise.allSettled(requests);

  const results: HtmlSignals[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "rejected") {
      results.push(deadSiteSignals(urls[i], null));
      continue;
    }

    const response = outcome.value;
    if (!response.ok) {
      results.push(deadSiteSignals(urls[i], null));
      continue;
    }

    try {
      const data = (await response.json()) as Record<string, unknown>;
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
      const result = tasks?.[0]?.result as Array<Record<string, unknown>> | undefined;
      const items = result?.[0]?.items as Array<Record<string, unknown>> | undefined;
      const page = items?.[0];

      if (!page) {
        results.push(deadSiteSignals(urls[i], null));
        continue;
      }

      const pageStatusCode = typeof page.status_code === "number" ? page.status_code : null;

      // Non-200 status means the site is reachable but broken/erroring
      if (pageStatusCode !== null && pageStatusCode !== 200) {
        results.push(deadSiteSignals(urls[i], pageStatusCode));
        continue;
      }

      results.push(extractHtmlSignals(urls[i], page, pageStatusCode));
    } catch {
      results.push(deadSiteSignals(urls[i], null));
    }
  }

  return results;
}

export async function fetchLighthouse(
  urls: string[],
  authHeader: string
): Promise<({ performance: number; seo: number } | null)[]> {
  const requests = urls.map((url) =>
    fetch(`${DFS_BASE}/on_page/lighthouse/live/json`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          url,
          for_mobile: true,
          categories: ["performance", "seo"],
        },
      ]),
    })
  );

  const settled = await Promise.allSettled(requests);

  const results: ({ performance: number; seo: number } | null)[] = [];

  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      results.push(null);
      continue;
    }

    const response = outcome.value;
    if (!response.ok) {
      results.push(null);
      continue;
    }

    try {
      const data = (await response.json()) as Record<string, unknown>;
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
      const result = tasks?.[0]?.result as Array<Record<string, unknown>> | undefined;
      const categories = result?.[0]?.categories as Record<string, unknown> | undefined;

      const performance = (categories?.performance as Record<string, unknown> | undefined)?.score;
      const seo = (categories?.seo as Record<string, unknown> | undefined)?.score;

      if (typeof performance !== "number" || typeof seo !== "number") {
        results.push(null);
        continue;
      }

      results.push({ performance, seo });
    } catch {
      results.push(null);
    }
  }

  return results;
}
