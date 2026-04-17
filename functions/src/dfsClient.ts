import {
  BusinessRaw,
  HtmlSignals,
  PageTimingData,
  PageMetaData,
  PageChecks,
  BusinessData,
} from "./types";

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

// ─── Footer / header extraction from custom JS ───────────────────────────────

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

// ─── Extract BusinessData from raw DFS listing ───────────────────────────────

export function extractBusinessData(b: BusinessRaw): BusinessData {
  const emails = (b.contact_info ?? [])
    .filter((c) => c.type === "mail")
    .map((c) => c.value);

  const socialTypes = ["facebook", "instagram", "twitter", "linkedin", "youtube", "pinterest", "tiktok"];
  const socialLinks = (b.contact_info ?? [])
    .filter((c) => socialTypes.includes(c.type))
    .map((c) => ({ type: c.type, value: c.value }));

  return {
    description: b.description,
    isClaimed: b.is_claimed,
    permanentlyClosed: b.permanently_closed,
    additionalCategories: b.additional_categories,
    city: b.address_info?.city ?? null,
    zip: b.address_info?.zip ?? null,
    region: b.address_info?.region ?? null,
    ratingDistribution: b.rating_distribution,
    priceLevel: b.price_level,
    currentStatus: b.work_time?.work_hours?.current_status ?? null,
    emails,
    socialLinks,
    totalPhotos: b.total_photos,
    placeTopics: b.place_topics,
    logo: b.logo,
    mainImage: b.main_image,
    lastUpdatedTime: b.last_updated_time,
    firstSeen: b.first_seen,
    checkUrl: b.check_url,
    latitude: b.latitude ?? null,
    longitude: b.longitude ?? null,
  };
}

// ─── Extract full HtmlSignals from DFS instant pages response ─────────────────

function num(val: unknown): number | null {
  return typeof val === "number" ? val : null;
}
function bool(val: unknown, fallback = false): boolean {
  return typeof val === "boolean" ? val : fallback;
}
function str(val: unknown): string | null {
  return typeof val === "string" ? val : null;
}

function extractPageTiming(page: Record<string, unknown>): PageTimingData | null {
  const pt = page.page_timing as Record<string, unknown> | undefined;
  if (!pt) return null;
  return {
    timeToInteractive: num(pt.time_to_interactive),
    domComplete: num(pt.dom_complete),
    largestContentfulPaint: num(pt.largest_contentful_paint),
    firstInputDelay: num(pt.first_input_delay),
    cumulativeLayoutShift: num(pt.cumulative_layout_shift),
    connectionTime: num(pt.connection_time),
    timeToSecureConnection: num(pt.time_to_secure_connection),
    waitingTime: num(pt.waiting_time),
    downloadTime: num(pt.download_time),
    durationTime: num(pt.duration_time),
  };
}

function extractPageMeta(page: Record<string, unknown>): PageMetaData | null {
  const meta = page.meta as Record<string, unknown> | undefined;
  if (!meta) return null;
  const content = (meta.content ?? {}) as Record<string, unknown>;
  return {
    title: str(meta.title),
    description: str(meta.description),
    generator: str(meta.generator),
    canonical: str(meta.canonical),
    internalLinksCount: num(meta.internal_links_count),
    externalLinksCount: num(meta.external_links_count),
    imagesCount: num(meta.images_count),
    imagesSize: num(meta.images_size),
    scriptsCount: num(meta.scripts_count),
    scriptsSize: num(meta.scripts_size),
    stylesheetsCount: num(meta.stylesheets_count),
    stylesheetsSize: num(meta.stylesheets_size),
    titleLength: num(meta.title_length),
    descriptionLength: num(meta.description_length),
    socialMediaTags: (meta.social_media_tags as Record<string, string>) ?? null,
    contentWordCount: num(content.plain_text_word_count),
    automatedReadabilityIndex: num(content.automated_readability_index),
    fleschKincaidReadabilityIndex: num(content.flesch_kincaid_readability_index),
    descriptionToContentConsistency: num(content.description_to_content_consistency),
    titleToContentConsistency: num(content.title_to_content_consistency),
  };
}

function extractPageChecks(page: Record<string, unknown>): PageChecks | null {
  const c = page.checks as Record<string, unknown> | undefined;
  if (!c) return null;
  return {
    isHttps: bool(c.is_https),
    isHttp: bool(c.is_http),
    isWww: bool(c.is_www),
    isRedirect: bool(c.is_redirect),
    is4xxCode: bool(c.is_4xx_code),
    is5xxCode: bool(c.is_5xx_code),
    isBroken: bool(c.is_broken),
    noContentEncoding: bool(c.no_content_encoding),
    highLoadingTime: bool(c.high_loading_time),
    highWaitingTime: bool(c.high_waiting_time),
    noDoctype: bool(c.no_doctype),
    hasHtmlDoctype: bool(c.has_html_doctype),
    noH1Tag: bool(c.no_h1_tag),
    noTitle: bool(c.no_title),
    noDescription: bool(c.no_description),
    noFavicon: bool(c.no_favicon),
    noImageAlt: bool(c.no_image_alt),
    noImageTitle: bool(c.no_image_title),
    titleTooLong: bool(c.title_too_long),
    titleTooShort: bool(c.title_too_short),
    hasMetaTitle: bool(c.has_meta_title),
    deprecatedHtmlTags: bool(c.deprecated_html_tags),
    duplicateMetaTags: bool(c.duplicate_meta_tags),
    duplicateTitleTag: bool(c.duplicate_title_tag),
    lowContentRate: bool(c.low_content_rate),
    highContentRate: bool(c.high_content_rate),
    lowCharacterCount: bool(c.low_character_count),
    lowReadabilityRate: bool(c.low_readability_rate),
    irrelevantDescription: bool(c.irrelevant_description),
    irrelevantTitle: bool(c.irrelevant_title),
    hasMetaRefreshRedirect: bool(c.has_meta_refresh_redirect),
    hasRenderBlockingResources: bool(c.has_render_blocking_resources),
    httpsToHttpLinks: bool(c.https_to_http_links),
    seoFriendlyUrl: bool(c.seo_friendly_url),
    hasFlash: bool(c.flash),
    hasFrame: bool(c.frame),
    loremIpsum: bool(c.lorem_ipsum),
    hasMicromarkup: bool(c.has_micromarkup),
    sizeGreaterThan3mb: bool(c.size_greater_than_3mb),
  };
}

export function extractHtmlSignals(
  url: string,
  page: Record<string, unknown>,
  statusCode: number | null = 200
): HtmlSignals {
  const checks = (page.checks ?? {}) as Record<string, unknown>;
  const resourceTags = (page.resource_tags ?? {}) as Record<string, unknown>;
  const scripts = Array.isArray(resourceTags.scripts)
    ? (resourceTags.scripts as Array<Record<string, unknown>>)
    : [];
  const lastModified = (page.last_modified ?? {}) as Record<string, unknown>;

  // Use pageMeta.contentWordCount (plain_text_word_count) — the top-level words_count
  // is unreliable and returns 0 on JS-heavy sites.
  const pageMeta = extractPageMeta(page);
  const wordCount = pageMeta?.contentWordCount ?? 0;
  const hasMetaDescription = !(checks.no_description === true);
  const hasFavicon = !(checks.no_favicon === true);
  const deprecatedTagCount =
    typeof checks.deprecated_tags === "number" ? checks.deprecated_tags : 0;

  // HTTPS: check final URL + DFS is_https check
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

  const hasAgencyFooter = AGENCY_FOOTER_PATTERNS.some((pattern) =>
    pattern.test(footerText)
  );

  return {
    statusCode,
    fetchFailed: false,
    onpageScore: num(page.onpage_score),
    totalDomSize: num(page.total_dom_size),
    pageSize: num(page.size),
    encodedSize: num(page.encoded_size),
    server: str(page.server),
    contentEncoding: str(page.content_encoding),
    mediaType: str(page.media_type),
    finalUrl,
    isHttps,
    redirectedToHttps,
    wordCount,
    hasMetaDescription,
    hasFavicon,
    deprecatedTagCount,
    copyrightYear,
    headerText,
    footerText,
    hasAdPixel,
    hasAgencyFooter,
    hasBrokenResources: bool(page.broken_resources),
    hasBrokenLinks: bool(page.broken_links),
    lastModifiedHeader: str(lastModified.header),
    lastModifiedSitemap: str(lastModified.sitemap),
    lastModifiedMetaTag: str(lastModified.meta_tag),
    pageTiming: extractPageTiming(page),
    pageMeta,
    pageChecks: extractPageChecks(page),
  };
}

/** Build a dead-site HtmlSignals stub for URLs that failed to fetch. */
function deadSiteSignals(url: string, statusCode: number | null): HtmlSignals {
  return {
    statusCode,
    fetchFailed: true,
    onpageScore: null,
    totalDomSize: null,
    pageSize: null,
    encodedSize: null,
    server: null,
    contentEncoding: null,
    mediaType: null,
    finalUrl: null,
    isHttps: url.startsWith("https://"),
    redirectedToHttps: false,
    wordCount: 0,
    hasMetaDescription: false,
    hasFavicon: false,
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

export function isParkedDomain(signals: HtmlSignals): boolean {
  const combined = `${signals.footerText} ${signals.headerText ?? ""}`.toLowerCase();

  // Keyword match in visible text
  if (PARKING_KEYWORDS.some((kw) => combined.includes(kw))) return true;

  // Title-based parking detection
  const title = (signals.pageMeta?.title ?? "").toLowerCase();
  const parkingTitlePatterns = [
    "domain for sale", "buy this domain", "parked domain",
    "this domain is for sale", "domain parking",
    "coming soon", "under construction",
  ];
  if (parkingTitlePatterns.some((p) => title.includes(p))) return true;

  // Known parking script domains in page resources
  const parkingScriptDomains = [
    "sedoparking.com", "bodis.com", "hugedomains.com",
    "afternic.com", "dan.com", "undeveloped.com",
    "parking.reg.ru", "parkingcrew.net",
    "godaddy.com/park", "domaincontrol.com",
  ];
  const footer = signals.footerText.toLowerCase();
  const header = (signals.headerText ?? "").toLowerCase();
  const allText = `${footer} ${header}`;
  if (parkingScriptDomains.some((d) => allText.includes(d))) return true;

  // Low content + parking-like characteristics: very few words, no real content
  const contentWordCount = signals.pageMeta?.contentWordCount ?? 0;
  if (contentWordCount < 10 && signals.pageMeta?.scriptsCount === 0 &&
      signals.pageMeta?.internalLinksCount === 0) {
    // Stub page with no scripts, no links, almost no words — likely parked
    if (title && !title.includes("403") && !title.includes("404")) {
      return true;
    }
  }

  return false;
}

// ─── DFS API calls ────────────────────────────────────────────────────────────

export async function searchBusinesses(
  keyword: string,
  location: string,
  authHeader: string
): Promise<{ items: BusinessRaw[]; cost: number }> {
  const requestBody = [
    {
      categories: [keyword.toLowerCase().replace(/\s+/g, "_")],
      location_coordinate: location.replace(/\s+/g, ""),
      limit: 50,
    },
  ];
  console.log("[searchBusinesses] Request:", {
    url: `${DFS_BASE}/business_data/business_listings/search/live`,
    authHeaderPrefix: authHeader.substring(0, 15) + "...",
    body: JSON.stringify(requestBody).substring(0, 200),
  });

  const response = await fetch(
    `${DFS_BASE}/business_data/business_listings/search/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    }
  );

  console.log(
    "[searchBusinesses] Response status:",
    response.status,
    response.statusText
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.log("[searchBusinesses] Error body:", errorBody);
    throw new Error(
      `DataForSEO business search failed: ${response.status} - ${errorBody}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  const topCost = typeof data.cost === "number" ? data.cost : 0;
  const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
  const result = tasks?.[0]?.result as Array<Record<string, unknown>> | undefined;
  const items = result?.[0]?.items as BusinessRaw[] | undefined;
  return { items: items ?? [], cost: topCost };
}

export async function fetchInstantPages(
  urls: string[],
  authHeader: string
): Promise<{ signals: HtmlSignals[]; cost: number }> {
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
          disable_cookie_popup: true,
        },
      ]),
    })
  );

  const settled = await Promise.allSettled(requests);
  const results: HtmlSignals[] = [];
  let totalCost = 0;

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
      if (typeof data.cost === "number") totalCost += data.cost;
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
      const result = tasks?.[0]?.result as
        | Array<Record<string, unknown>>
        | undefined;
      const items = result?.[0]?.items as
        | Array<Record<string, unknown>>
        | undefined;
      const page = items?.[0];

      if (!page) {
        results.push(deadSiteSignals(urls[i], null));
        continue;
      }

      const pageStatusCode =
        typeof page.status_code === "number" ? page.status_code : null;

      if (pageStatusCode !== null && pageStatusCode !== 200) {
        results.push(deadSiteSignals(urls[i], pageStatusCode));
        continue;
      }

      results.push(extractHtmlSignals(urls[i], page, pageStatusCode));
    } catch {
      results.push(deadSiteSignals(urls[i], null));
    }
  }

  return { signals: results, cost: totalCost };
}

export async function fetchLighthouse(
  urls: string[],
  authHeader: string
): Promise<{ scores: ({ performance: number; seo: number } | null)[]; cost: number }> {
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
  let totalCost = 0;

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
      if (typeof data.cost === "number") totalCost += data.cost;
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
      const result = tasks?.[0]?.result as
        | Array<Record<string, unknown>>
        | undefined;
      const categories = result?.[0]?.categories as
        | Record<string, unknown>
        | undefined;

      const performance = (
        categories?.performance as Record<string, unknown> | undefined
      )?.score;
      const seo = (categories?.seo as Record<string, unknown> | undefined)
        ?.score;

      if (typeof performance !== "number" || typeof seo !== "number") {
        results.push(null);
        continue;
      }

      results.push({ performance, seo });
    } catch {
      results.push(null);
    }
  }

  return { scores: results, cost: totalCost };
}
