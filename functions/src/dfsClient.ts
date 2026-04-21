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
  /website by/i,
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
    permanentlyClosed: b.work_time?.work_hours?.current_status === "closed_forever",
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

  // HTTPS: check final URL + DFS is_https check.
  // Note: we crawl https:// directly (normalized in fetchInstantPages), so
  // finalUrl will be https:// if the site supports it. redirectedToHttps is
  // only meaningful when the *original stored URL* was http:// and the crawl
  // confirmed https works — use page.checks.is_redirect to distinguish a real
  // redirect from our own URL normalization.
  const finalUrl = typeof page.url === "string" ? page.url : url;
  const dfsIsHttps = checks.is_https === true;
  const isHttps = finalUrl.startsWith("https://") || dfsIsHttps;
  // Only flag redirectedToHttps if DFS itself observed a redirect (is_redirect=true),
  // meaning the server actually issued a 3xx, not just that we changed http→https.
  const redirectedToHttps = !url.startsWith("https://") && isHttps && checks.is_redirect === true;

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

/**
 * Build a signal stub for sites DFS can reach (task 20000) but can't crawl —
 * bot protection, JS-heavy SPA, Cloudflare challenge, etc.
 * fetchFailed=false so the scorer treats it as a live-but-uncrawlable site
 * rather than a dead one.
 */
export function uncrawlableSignals(url: string): HtmlSignals {
  return {
    statusCode: null,
    fetchFailed: false,
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

/** Build a dead-site HtmlSignals stub for URLs that failed to fetch. */
export function deadSiteSignals(url: string, statusCode: number | null): HtmlSignals {
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
  authHeader: string,
  limit: number = 50
): Promise<{ items: BusinessRaw[]; cost: number }> {
  const requestBody = [
    {
      categories: [keyword.toLowerCase().replace(/\s+/g, "_")],
      location_coordinate: location.replace(/\s+/g, ""),
      limit,
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

  console.log("[searchBusinesses] Response parsed:", {
    statusCode: data.status_code,
    statusMessage: data.status_message,
    cost: data.cost,
    tasksCount: tasks?.length ?? 0,
    taskStatusCode: tasks?.[0]?.status_code,
    taskStatusMessage: tasks?.[0]?.status_message,
    resultCount: result?.[0]?.total_count ?? 0,
    itemsCount: items?.length ?? 0,
  });

  return { items: items ?? [], cost: topCost };
}

// Task-level status codes from DataForSEO that indicate a transient failure worth retrying
const DFS_RETRYABLE_TASK_CODES = new Set([
  40501, // site_unreachable
  50000, // internal error
  50401, // internal error - timeout
]);

/** Parse a single instant_pages item into HtmlSignals, or return null if it needs a retry. */
function parseInstantPageItem(
  url: string,
  page: Record<string, unknown> | undefined
): HtmlSignals | null {
  if (!page) return null;

  // resource_type === 'broken' with no status_code means the crawler hit a
  // timeout, DNS failure, or SSL error — retry with a different proxy pool.
  if (page.resource_type === "broken" && page.status_code == null) {
    return null;
  }

  const pageStatusCode =
    typeof page.status_code === "number" ? page.status_code : null;

  if (pageStatusCode === 403) {
    // Server is alive but blocking our crawler — not dead.
    return { ...deadSiteSignals(url, 403), fetchFailed: false };
  }

  if (pageStatusCode !== null && pageStatusCode !== 200) {
    return deadSiteSignals(url, pageStatusCode);
  }

  return extractHtmlSignals(url, page, pageStatusCode);
}

interface FetchOnePageResult {
  page: Record<string, unknown> | undefined;
  taskStatusCode: number | null;
  cost: number;
}

// Per-request timeout for DFS instant_pages calls. Keeps total reevaluateBusiness
// execution well under the 120s Cloud Function limit even with 3 passes.
const FETCH_ONE_PAGE_TIMEOUT_MS = 25_000;

/** Fire a single instant_pages request. Returns the page item, task-level status code, and cost. */
async function fetchOnePage(
  url: string,
  authHeader: string,
  opts: { switchPool?: boolean; returnDespiteTimeout?: boolean } = {}
): Promise<FetchOnePageResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_ONE_PAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${DFS_BASE}/on_page/instant_pages`, {
        method: "POST",
        signal: controller.signal,
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
            return_despite_timeout: opts.returnDespiteTimeout ?? true,
            switch_pool: opts.switchPool ?? false,
          },
        ]),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return { page: undefined, taskStatusCode: null, cost: 0 };

    const data = (await response.json()) as Record<string, unknown>;
    const cost = typeof data.cost === "number" ? data.cost : 0;
    const tasks = data.tasks as Array<Record<string, unknown>> | undefined;
    const task = tasks?.[0];
    const taskStatusCode = typeof task?.status_code === "number" ? task.status_code : null;
    const result = task?.result as Array<Record<string, unknown>> | undefined;
    const items = result?.[0]?.items as Array<Record<string, unknown>> | undefined;

    if (taskStatusCode !== null) {
      console.log(`[fetchOnePage] ${url} → task status_code=${taskStatusCode} items=${items?.length ?? 0} switchPool=${opts.switchPool}`);
    }

    return { page: items?.[0], taskStatusCode, cost };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.log(`[fetchOnePage] ${url} → timed out after ${FETCH_ONE_PAGE_TIMEOUT_MS}ms`);
    }
    return { page: undefined, taskStatusCode: null, cost: 0 };
  }
}

/** Returns true if the result warrants a retry (transient DFS error or empty items on a retryable code). */
function shouldRetry(result: FetchOnePageResult): boolean {
  // Empty items with a known retryable task code
  if (result.page === undefined && result.taskStatusCode !== null && DFS_RETRYABLE_TASK_CODES.has(result.taskStatusCode)) {
    return true;
  }
  // Empty items with no task code at all (unknown transient failure)
  if (result.page === undefined && result.taskStatusCode === null) {
    return true;
  }
  // Empty items even on a "success" task code — DFS crawled but got nothing back
  if (result.page === undefined) {
    return true;
  }
  // Page present but resource_type=broken with no status_code
  if (result.page !== undefined && result.page.resource_type === "broken" && result.page.status_code == null) {
    return true;
  }
  return false;
}

/** Resolve the final URL after redirects (e.g. no-www → www). Returns the original if it fails. */
async function resolveRedirect(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    const final = res.url;
    // Only use the resolved URL if it's meaningfully different (different host)
    if (final && new URL(final).hostname !== new URL(url).hostname) {
      console.log(`[resolveRedirect] ${url} → ${final}`);
      return final;
    }
    return url;
  } catch {
    return url;
  }
}

export async function fetchInstantPages(
  urls: string[],
  authHeader: string
): Promise<{ signals: HtmlSignals[]; cost: number }> {
  // Normalize http:// → https:// before crawling. Most sites that have http://
  // stored in Google Maps redirect to https:// anyway, and some crawlers/proxies
  // fail on the redirect chain. We crawl https:// directly and fall back to the
  // original URL only if https fails.
  const crawlUrls = urls.map((url) =>
    url.startsWith("http://") ? url.replace("http://", "https://") : url
  );

  // First pass: fetch all URLs in parallel with return_despite_timeout enabled.
  const firstPass = await Promise.all(
    crawlUrls.map((url) => fetchOnePage(url, authHeader, { returnDespiteTimeout: true }))
  );

  let totalCost = 0;
  const results: (HtmlSignals | null)[] = [];
  const retryIndices: number[] = [];

  for (let i = 0; i < firstPass.length; i++) {
    totalCost += firstPass[i].cost;
    if (shouldRetry(firstPass[i])) {
      retryIndices.push(i);
      results.push(null);
    } else {
      // Pass the original url (not crawlUrl) so HtmlSignals.isHttps reflects
      // the stored URL, but the actual crawl used the normalized https version.
      results.push(parseInstantPageItem(urls[i], firstPass[i].page));
    }
  }

  // Second pass: retry transient failures with switch_pool (different proxy).
  if (retryIndices.length > 0) {
    console.log(
      `[fetchInstantPages] Retrying ${retryIndices.length} site(s) with switch_pool: ${retryIndices.map((i) => crawlUrls[i]).join(", ")}`
    );
    const retryResults = await Promise.all(
      retryIndices.map((i) =>
        fetchOnePage(crawlUrls[i], authHeader, { returnDespiteTimeout: true, switchPool: true })
      )
    );

    const redirectIndices: number[] = [];

    for (let j = 0; j < retryIndices.length; j++) {
      const i = retryIndices[j];
      totalCost += retryResults[j].cost;

      // items=0 on a success code after switch_pool = likely a redirect DFS won't follow
      if (retryResults[j].page === undefined && retryResults[j].taskStatusCode === 20000) {
        redirectIndices.push(i);
        continue;
      }

      const signal = parseInstantPageItem(urls[i], retryResults[j].page);
      if (signal === null) {
        // task 20000 = DFS reached the server but couldn't parse content → live but uncrawlable
        const isTaskSuccess = retryResults[j].taskStatusCode === 20000;
        results[i] = isTaskSuccess ? uncrawlableSignals(urls[i]) : deadSiteSignals(urls[i], null);
        console.log(`[fetchInstantPages] ${crawlUrls[i]} ${isTaskSuccess ? "uncrawlable (task 20000, live)" : "dead"} after retry (taskCode=${retryResults[j].taskStatusCode})`);
      } else {
        results[i] = signal;
      }
    }

    // Third pass: resolve redirects and retry with the final URL
    if (redirectIndices.length > 0) {
      console.log(
        `[fetchInstantPages] Resolving redirects for ${redirectIndices.length} site(s): ${redirectIndices.map((i) => crawlUrls[i]).join(", ")}`
      );
      const resolvedUrls = await Promise.all(redirectIndices.map((i) => resolveRedirect(crawlUrls[i])));
      const redirectResults = await Promise.all(
        resolvedUrls.map((url) => fetchOnePage(url, authHeader, { returnDespiteTimeout: true }))
      );

      for (let k = 0; k < redirectIndices.length; k++) {
        const i = redirectIndices[k];
        totalCost += redirectResults[k].cost;
        const signal = parseInstantPageItem(urls[i], redirectResults[k].page);
        if (signal === null) {
          // task 20000 after redirect resolution = server is live, DFS just can't crawl it
          const isTaskSuccess = redirectResults[k].taskStatusCode === 20000;
          results[i] = isTaskSuccess ? uncrawlableSignals(urls[i]) : deadSiteSignals(urls[i], null);
          console.log(`[fetchInstantPages] ${resolvedUrls[k]} ${isTaskSuccess ? "uncrawlable (task 20000, live)" : "dead"} after redirect resolution`);
        } else {
          results[i] = signal;
        }
      }
    }
  }

  return {
    signals: results as HtmlSignals[],
    cost: totalCost,
  };
}

export async function fetchLighthouse(
  urls: string[],
  authHeader: string
): Promise<{ scores: ({ performance: number; seo: number } | null)[]; cost: number }> {
  // Same http→https normalization as fetchInstantPages
  const crawlUrls = urls.map((url) =>
    url.startsWith("http://") ? url.replace("http://", "https://") : url
  );

  const requests = crawlUrls.map((url) =>
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
