import { Business } from "./mockBusinesses";

export function generateColdEmail(b: Business): string {
  const issues = getIssuesList(b);
  const ratingLine = b.googleRating > 0
    ? `I came across ${b.name} while researching ${b.category.toLowerCase()} businesses in ${b.city || "your area"}, and I was really impressed by your ${b.googleRating}★ rating from ${b.reviewCount} reviews — your customers clearly love what you do.`
    : `I came across ${b.name} while researching ${b.category.toLowerCase()} businesses in ${b.city || "your area"} and wanted to reach out.`;

  return `Subject: Quick question about ${b.name}'s online presence

Hi there,

${ratingLine}

I'm a freelance web developer who specializes in helping local businesses like yours attract more customers online. While looking at your online presence, I noticed a few areas where you might be leaving money on the table:

${issues.map((i) => `• ${i}`).join("\n")}

I'd love to spend 15 minutes showing you exactly how we could fix these issues and help you get more customers finding you online. Would you be open to a quick call this week?

Best regards,
[Your Name]
Freelance Web Developer
[Your Phone] | [Your Email]`;
}

export function generateColdCallScript(b: Business): string {
  const issues = getIssuesList(b);
  const cityRef = b.city || "your area";
  return `COLD CALL SCRIPT — ${b.name}
${"=".repeat(40)}

INTRO:
"Hi, is this the owner or manager of ${b.name}? Great! My name is [Your Name], and I help ${b.category.toLowerCase()} businesses in ${cityRef} get more customers through their online presence."

HOOK:
"I was actually looking at ${b.name} online, and I noticed a few things that could be costing you customers. Do you have 2 minutes?"

KEY TALKING POINTS:
${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

CLOSE:
"I'd love to put together a quick proposal showing exactly what I'd fix and how much more business it could bring you. Can I send that over? What email would be best?"

OBJECTION HANDLING:
- "I'm too busy" → "I totally understand. That's exactly why I handle everything — you won't need to lift a finger. Can I send a quick overview to your email?"
- "I'm not interested" → "No problem at all. If you ever want a free audit of your online presence, feel free to reach out. Have a great day!"
- "How much does it cost?" → "It really depends on the scope, but I typically work with businesses your size for [range]. The ROI usually pays for itself within the first month."`;
}

export type ActionSeverity = "critical" | "medium" | "low";

export interface FixActionItem {
  id: string;
  severity: ActionSeverity;
  text: string;
}

export function generateFixActionItems(b: Business): FixActionItem[] {
  const a = b.analysis;
  const items: FixActionItem[] = [];
  const push = (id: string, severity: ActionSeverity, text: string) => items.push({ id, severity, text });

  if (!a.hasWebsite) push("build-website", "critical", "Build a professional website — this is the #1 priority");
  if (b.fetchFailed && a.hasWebsite) push("site-unreachable", "critical", `Website is unreachable${b.statusCode ? ` (HTTP ${b.statusCode})` : ""} — restore site or rebuild`);
  if (!a.hasHttps && a.hasWebsite) push("install-ssl", "critical", "Install SSL certificate and enable HTTPS");
  if (!a.mobileFriendly && a.hasWebsite && !b.fetchFailed) push("mobile-friendly", "critical", "Make website responsive/mobile-friendly");
  if (a.isExpiredDomain) push("renew-domain", "critical", "Domain has expired — renew or migrate");
  if (a.loadTimeMs > 3000 && a.hasWebsite) push("page-speed", "medium", `Optimize page load speed (currently ${(a.loadTimeMs / 1000).toFixed(1)}s, target < 2s)`);
  if (a.deprecatedHtmlTags > 0 && a.hasWebsite) push("deprecated-html", "medium", `Remove ${a.deprecatedHtmlTags} deprecated HTML tags`);
  if (a.hasWebsite && a.seoScore > 0 && a.seoScore < 70) push("seo", "medium", `Improve SEO (Lighthouse score ${a.seoScore}/100)`);
  if (a.copyrightYear && a.copyrightYear < 2023) push("copyright-year", "medium", `Update copyright year from ${a.copyrightYear} to current year`);
  if (b.isClaimed === false) push("claim-gbp", "medium", "Claim Google Business Profile to control listing");
  if (!a.hasOnlineAds) push("setup-ads", "low", "Set up Google Ads or Meta Ads for local targeting");
  if (!a.hasMarketingAgency) push("propose-agency", "low", "No marketing agency detected — propose ongoing marketing services");

  return items;
}

export function generateAdCampaignOutline(b: Business): string {
  const cityRef = b.city || "the local area";
  const ratingLine = b.googleRating > 0 ? `★ ${b.googleRating} Rated | ` : "";
  return `# Ad Campaign Outline — ${b.name}

## Campaign Objective
Drive local foot traffic and online inquiries for ${b.name} in ${cityRef}.

## Recommended Platforms
1. **Google Ads** — Search ads targeting "${b.category.toLowerCase()} near me", "${b.category.toLowerCase()} in ${cityRef}"
2. **Meta (Facebook/Instagram)** — Local awareness ads with a 10-mile radius
3. **Google Business Profile** — Optimize listing, respond to reviews, post updates

## Budget Recommendation
- **Starter**: $500/month (Google Ads only)
- **Growth**: $1,200/month (Google + Meta)
- **Premium**: $2,500/month (Full-service with content creation)

## Target Audience
- Location: ${cityRef}${b.state ? `, ${b.state}` : ""} + 15 mile radius
- Demographics: Adults 25-65
- Interests: ${b.category}-related services

## Ad Copy Examples
**Google Search Ad:**
"${b.name} — Trusted ${b.category} in ${cityRef} | ${ratingLine}Call Now"

**Meta Ad:**
"Looking for a great ${b.category.toLowerCase()} in ${cityRef}? ${b.name}${b.reviewCount > 0 ? ` has been serving the community with ${b.reviewCount}+ happy customers.` : "."} Book today!"

## Pricing for Your Services
- Campaign setup: $300-500 (one-time)
- Monthly management: $200-400/month
- Ad creative/copywriting: $150-250/month
- Monthly reporting & optimization: included

## Expected Results (Month 1-3)
- 500-2,000 impressions/month
- 50-200 clicks/month
- 5-20 qualified leads/month
- Estimated ROI: 3-5x ad spend`;
}

function getIssuesList(b: Business): string[] {
  const a = b.analysis;
  const issues: string[] = [];
  if (!a.hasWebsite) issues.push("You don't have a website — 97% of consumers search online before visiting a business");
  if (a.hasWebsite && b.fetchFailed) issues.push(`Your website is unreachable${b.statusCode ? ` (returns HTTP ${b.statusCode})` : ""} — potential customers can't find or trust you`);
  if (a.hasWebsite && !a.hasHttps) issues.push("Your site shows as 'Not Secure' — this scares away potential customers");
  if (a.hasWebsite && a.seoScore > 0 && a.seoScore < 40) issues.push(`Your SEO score is only ${a.seoScore}/100 — you're likely invisible on Google`);
  if (a.hasWebsite && a.loadTimeMs > 3000) issues.push(`Your site takes ${(a.loadTimeMs / 1000).toFixed(1)}s to load — visitors leave after 3s`);
  if (!a.hasOnlineAds) issues.push("You're not running any online ads while your competitors are");
  if (a.copyrightYear && a.copyrightYear < 2022) issues.push(`Your website copyright shows ${a.copyrightYear} — it looks abandoned`);
  if (b.isClaimed === false) issues.push("Your Google Business Profile is unclaimed — you're missing free visibility");
  if (issues.length === 0) issues.push("Your online presence could use some modernization to stay competitive");
  return issues;
}
