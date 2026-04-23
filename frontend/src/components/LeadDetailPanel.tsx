import type { Business } from "@/data/mockBusinesses";
import {
  generateColdEmail, generateColdCallScript,
} from "@/data/actionItems";
import { useFirebaseLeadStore, LEAD_STATUSES } from "@/hooks/useFirebaseLeadStore";
import { useLeadStore } from "@/hooks/useLeadStore";
import { useAuth } from "@/contexts/AuthContext";
import { LeadScoreBadge } from "@/components/LeadScoreBadge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bookmark, BookmarkCheck, MapPin, Phone, Star, Globe,
  Shield, ShieldOff, Gauge, Code, Search as SearchIcon,
  TrendingDown, ExternalLink, Clock, AlertTriangle,
  Copy, CheckCircle2, XCircle, Mail, Server, Info, Pencil,
  StickyNote, Images, Loader2, RefreshCw, ChevronDown,
} from "lucide-react";
import { ReportButton } from "@/components/ReportDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useRef, useEffect } from "react";
import { toast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/data/mockBusinesses";
import { fetchBusinessPhotos } from "@/lib/api";
import { reevaluateBusiness } from "@/lib/api";
import { normalizeBusiness } from "@/data/leadTypes";
import { updateCachedBusiness } from "@/lib/businessCache";
import JSZip from "jszip";
import { canGenerateScripts } from "@/lib/planFeatures";
import { useCredits } from "@/hooks/useCredits";
import { usePlanConfig } from "@/hooks/usePlans";

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusRow({ icon: Icon, label, value, status }: { icon: any; label: string; value: string; status: "good" | "warning" | "critical" | "neutral" }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-1">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{value}</span>
        {status === "good" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === "warning" && <AlertTriangle className="h-4 w-4 text-yellow-500" />}
        {status === "critical" && <XCircle className="h-4 w-4 text-red-500" />}
      </div>
    </div>
  );
}

// Legitimacy score label thresholds
function getLegitimacyLabel(score: number): string {
  if (score >= 71) return "Likely Legitimate";
  if (score >= 41) return "Moderate";
  return "Iffy";
}

// Web health row component (concise)
function WebHealthRow({
  icon: Icon,
  label,
  value,
  status,
  badge,
}: {
  icon: any;
  label: string;
  value: string;
  status: "good" | "bad" | "neutral";
  badge?: string;
}) {
  const dotColor =
    status === "bad" ? "bg-red-500" : status === "good" ? "bg-green-500" : "bg-muted-foreground/40";
  return (
    <div className="flex items-center justify-between py-2 px-1">
      <div className="flex items-center gap-2.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm">{label}</span>
        {badge && (
          <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 leading-none">{badge}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{value}</span>
        <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
      </div>
    </div>
  );
}

function CopyableBlock({ title, content }: { title: string; content: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast({ title: "Copied!", description: `${title} copied to clipboard.` });
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="whitespace-pre-wrap text-sm text-muted-foreground bg-muted/50 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs leading-relaxed">{content}</pre>
      </CardContent>
    </Card>
  );
}

function parseEmailScript(text: string): { subject: string; body: string } {
  const match = text.match(/^\s*Subject:\s*(.+?)\n([\s\S]*)$/);
  if (match) return { subject: match[1].trim(), body: match[2].replace(/^\s*\n/, "") };
  return { subject: "", body: text };
}

interface ScriptBlockProps {
  title: string;
  content: string;
  editable?: boolean;
  isEditing?: boolean;
  onToggleEdit?: () => void;
  onChange?: (text: string) => void;
  showGmail?: boolean;
}

function ScriptBlock({ title, content, editable, isEditing, onToggleEdit, onChange, showGmail }: ScriptBlockProps) {
  const { subject, body } = parseEmailScript(content);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    toast({ title: "Copied!", description: `${title} copied to clipboard.` });
  };

  const openInGmail = () => {
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <div className="flex items-center gap-1">
            {editable && (
              <Button variant="ghost" size="sm" onClick={onToggleEdit} className="gap-1">
                {isEditing ? <CheckCircle2 className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                {isEditing ? "Done" : "Edit"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1">
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-secondary/50 px-6 py-5">
          {isEditing ? (
            <Textarea
              value={content}
              onChange={(e) => onChange?.(e.target.value)}
              className="min-h-[320px] bg-background text-sm leading-[1.6] font-sans resize-y"
            />
          ) : (
            <div className="font-sans text-sm leading-[1.6] text-foreground">
              {subject && (
                <p className="font-bold text-[14px] mb-3">{subject}</p>
              )}
              <div className="whitespace-pre-wrap">{body}</div>
            </div>
          )}
        </div>
        {showGmail && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={openInGmail} className="gap-2">
              <Mail className="h-4 w-4" /> Draft in Gmail
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // US number: strip leading 1 and format as (XXX) XXX-XXXX
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return raw; // fallback to original if not a standard US number
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface LeadDetailPanelProps {
  business: Business;
  onUpdate?: (updated: Business) => void;
}

export function LeadDetailPanel({ business, onUpdate }: LeadDetailPanelProps) {
  const fbStore = useFirebaseLeadStore();
  const store = useLeadStore();
  const { plan } = useCredits();
  const planConfig = usePlanConfig(plan);
  const { role } = useAuth();
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [localEmailDraft, setLocalEmailDraft] = useState<string | null>(null);
  const [isDownloadingPhotos, setIsDownloadingPhotos] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [legitimacyOpen, setLegitimacyOpen] = useState(false);
  const [opportunityOpen, setOpportunityOpen] = useState(false);

  // Notes state with debounced save
  const savedRecord = fbStore.getSavedLead(business.id);
  const isSaved = fbStore.isLeadSaved(business.id);
  const [localNotes, setLocalNotes] = useState(savedRecord?.notes ?? "");
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local notes when savedRecord changes (e.g. real-time update)
  useEffect(() => {
    if (savedRecord) setLocalNotes(savedRecord.notes);
  }, [savedRecord?.notes]);

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => {
      fbStore.updateNotes(business.id, value);
    }, 800);
  };

  const { analysis: a } = business;

  const generatedEmail = generateColdEmail(business);
  const emailContent = (isSaved ? store.getSavedLead(business.id)?.customEmailScript : localEmailDraft) ?? generatedEmail;
  const handleEmailChange = (text: string) => {
    if (isSaved) {
      store.updateEmailScript(business.id, text);
    } else {
      setLocalEmailDraft(text);
    }
  };

  const seoGauge = a.hasWebsite && a.seoScore > 0 ? a.seoScore : null;
  const designGauge = a.hasWebsite && a.designScore > 0 ? a.designScore : null;
  const speedGauge = a.hasWebsite && a.loadTimeMs > 0 ? Math.max(0, Math.min(100, 100 - Math.round(a.loadTimeMs / 100))) : null;

  const handleDownloadPhotos = async () => {
    setIsDownloadingPhotos(true);
    try {
      const photos = await fetchBusinessPhotos(business.id);
      if (photos.length === 0) {
        toast({ title: "No photos found", description: "This business has no photos on Google." });
        return;
      }

      const zip = new JSZip();
      const safeName = business.name.replace(/[^a-z0-9]/gi, "_");

      for (const photo of photos) {
        zip.file(`${safeName}_photo_${photo.index}.${photo.ext}`, photo.data, { base64: true });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = `${safeName}_photos.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      toast({ title: `Downloaded ${photos.length} photo${photos.length === 1 ? "" : "s"}`, description: `Saved as ${safeName}_photos.zip` });
    } catch (err) {
      toast({ title: "Failed to fetch photos", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsDownloadingPhotos(false);
    }
  };

  const ratingDist = business.ratingDistribution;
  const ratingTotal = ratingDist ? Object.values(ratingDist).reduce((s, n) => s + n, 0) : 0;

  const handleReevaluate = async () => {
    setIsReevaluating(true);
    try {
      const { result } = await reevaluateBusiness(business.id);
      const updated = normalizeBusiness(result);
      onUpdate?.(updated);
      // Propagate to in-memory search cache and saved lead doc
      updateCachedBusiness(updated);
      fbStore.updateScore(business.id, updated.leadScore, updated.label ?? null, {
        legitimacyScore: updated.legitimacyScore,
        hasWebsite: updated.analysis.hasWebsite,
        hasHttps: updated.analysis.hasHttps,
        mobileFriendly: updated.analysis.mobileFriendly,
        hasOnlineAds: updated.analysis.hasOnlineAds,
        seoScore: updated.analysis.seoScore,
      });
      toast({ title: "Re-evaluated", description: `Score updated to ${updated.leadScore}` });
    } catch (err) {
      toast({ title: "Re-evaluation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsReevaluating(false);
    }
  };

  const addressLine = [business.address, business.city, business.state, business.zip].filter(Boolean).join(", ");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-4 min-w-0 flex-1">
          {business.logo && (
            <img
              src={business.logo}
              alt={business.name}
              className="h-14 w-14 rounded-xl object-cover border bg-muted shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge variant="secondary">{business.category.split("/")[0].trim()}</Badge>
              <LeadScoreBadge score={business.leadScore} size="lg" />
              {business.currentStatus && (
                <Badge variant={business.currentStatus === "open" ? "default" : "outline"} className="text-xs">
                  {business.currentStatus === "open" ? "Open now" : "Closed"}
                </Badge>
              )}
              {business.isClaimed && (
                <Badge variant="outline" className="text-xs gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Claimed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-extrabold">{business.name}</h2>
              <ReportButton cid={business.id} businessName={business.name} websiteUrl={business.analysis.websiteUrl} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          {addressLine && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{addressLine}</span>}
          {business.phone && <a href={`tel:${business.phone}`} className="flex items-center gap-1 hover:text-foreground transition-colors"><Phone className="h-4 w-4" />{formatPhone(business.phone)}</a>}
          {business.googleRating > 0 && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              {business.googleRating} ({business.reviewCount} reviews)
            </span>
          )}
          {a.websiteUrl && <a href={a.websiteUrl.startsWith("http") ? a.websiteUrl : `https://${a.websiteUrl}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors"><Globe className="h-4 w-4" /><span className="underline">{a.websiteUrl}</span></a>}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={isSaved ? "secondary" : "default"}
            size="sm"
            className={!isSaved ? "gradient-bg text-white" : ""}
            onClick={() => isSaved ? fbStore.removeLead(business.id) : fbStore.saveLead(business)}
          >
            {isSaved ? <BookmarkCheck className="h-4 w-4 mr-1.5" /> : <Bookmark className="h-4 w-4 mr-1.5" />}
            {isSaved ? "Saved" : "Save Lead"}
          </Button>
          {isSaved && savedRecord && (
            <Select
              value={savedRecord.status}
              onValueChange={(v) => fbStore.updateStatus(business.id, v as LeadStatus)}
            >
              <SelectTrigger className="w-[160px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {business.checkUrl && (
            <a href={business.checkUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="gap-1">
                <ExternalLink className="h-3.5 w-3.5" /> Google Maps
              </Button>
            </a>
          )}
          {(business.totalPhotos ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleDownloadPhotos}
              disabled={isDownloadingPhotos}
            >
              {isDownloadingPhotos
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Images className="h-3.5 w-3.5" />}
              {isDownloadingPhotos ? "Downloading..." : `Download Photos${business.totalPhotos ? ` (${business.totalPhotos})` : ""}`}
            </Button>
          )}
        </div>

        {role === "admin" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={handleReevaluate}
              disabled={isReevaluating}
              title="Re-fetch website data and recalculate score"
            >
              {isReevaluating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {isReevaluating ? "Re-evaluating..." : "Re-evaluate"}
            </Button>
          </div>
        )}
        {/* Notes */}
        {isSaved && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <StickyNote className="h-4 w-4" /> Notes
                </CardTitle>
                {savedRecord?.notesEditedAt && (
                  <span className="text-xs text-muted-foreground">
                    Edited {new Date(savedRecord.notesEditedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Add notes about this lead..."
                value={localNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                className="min-h-[100px] resize-y"
                maxLength={2000}
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="analysis" className="space-y-4">
        <TabsList>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="scripts">Outreach Scripts</TabsTrigger>
        </TabsList>

        <TabsContent value="analysis" className="space-y-4">
          {business.description && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{business.description}</p>
                {business.additionalCategories && business.additionalCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {business.additionalCategories.map((c) => (
                      <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 1. Legitimacy Score — collapsible, closed by default */}
          <Card>
            <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setLegitimacyOpen((v) => !v)}>
              <div className="flex items-start justify-between gap-4">
                <CardTitle className="text-base flex items-center gap-2 shrink-0">
                  <Shield className="h-4 w-4" /> Legitimacy Score
                  <TooltipProvider>
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[220px] text-xs">
                        Based on review count, listing age, claimed status, website presence, HTTPS, and ad pixel detection. Higher = more trustworthy business.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    (business.legitimacyScore ?? 0) >= 71 ? "text-green-500" :
                    (business.legitimacyScore ?? 0) >= 41 ? "text-yellow-500" : "text-red-500"
                  )}>
                    {business.legitimacyScore ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground leading-none">
                    {getLegitimacyLabel(business.legitimacyScore ?? 0)}
                  </span>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", legitimacyOpen && "rotate-180")} />
                </div>
              </div>
              {/* Progress bar always visible */}
              <div className="relative h-2 w-full rounded-full overflow-hidden bg-muted mt-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${business.legitimacyScore ?? 0}%`,
                    background: (() => {
                      const s = business.legitimacyScore ?? 0;
                      if (s >= 71) return "#22c55e";
                      if (s >= 41) return "#eab308";
                      return "#ef4444";
                    })(),
                  }}
                />
              </div>
            </CardHeader>
            <div className={cn(
              "grid transition-all duration-300 ease-in-out",
              legitimacyOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}>
              <div className="overflow-hidden">
                {business.legitimacyReasons && business.legitimacyReasons.length > 0 && (
                  <CardContent className="pt-2 pb-4">
                    <ul className="space-y-1.5">
                      {business.legitimacyReasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className={cn(
                            "mt-1.5 h-1.5 w-1.5 rounded-full shrink-0",
                            r.startsWith("-") || r.includes("(-") ? "bg-red-500" : "bg-green-500"
                          )} />
                          <span className="text-muted-foreground">{r}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                )}
              </div>
            </div>
          </Card>

          {/* 2. Marketing agency warning banner (conditional) */}
          {a.hasMarketingAgency && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
              <span>Marketing agency detected — this business may already have representation</span>
            </div>
          )}

          {/* 3. Web Health */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Web Health</CardTitle>
            </CardHeader>
            <CardContent>
              {!a.hasWebsite ? (
                <p className="text-sm text-muted-foreground py-2">No website found</p>
              ) : (
                <div className="divide-y divide-border">
                  {(() => {
                    const domainAgeBadge = a.websiteAge ? `~${a.websiteAge}yr` : undefined;
                    const rows: Array<{ icon: any; label: string; value: string; status: "good" | "bad" | "neutral"; badge?: string }> = [
                      {
                        icon: Globe,
                        label: "Website",
                        value: a.websiteUrl ?? "Yes",
                        status: "good",
                        badge: domainAgeBadge,
                      },
                      {
                        icon: a.hasHttps ? Shield : ShieldOff,
                        label: "HTTPS",
                        value: a.hasHttps ? "Secure" : "Not Secure",
                        status: a.hasHttps ? "good" : "bad",
                      },
                      {
                        icon: Gauge,
                        label: "Mobile Friendly",
                        value: a.mobileFriendly ? "Yes" : "No",
                        status: a.mobileFriendly ? "good" : "bad",
                      },
                      {
                        icon: Code,
                        label: "Deprecated HTML",
                        value: a.deprecatedHtmlTags > 0 ? `${a.deprecatedHtmlTags} tags` : "None",
                        status: a.deprecatedHtmlTags > 3 ? "bad" : "good",
                      },
                      {
                        icon: TrendingDown,
                        label: "Ad Pixel",
                        value: a.hasOnlineAds ? "Detected" : "Not found",
                        status: a.hasOnlineAds ? "good" : "bad",
                      },
                      {
                        icon: SearchIcon,
                        label: "SEO Score",
                        value: seoGauge != null ? `${seoGauge}/100` : "N/A",
                        status: seoGauge == null ? "neutral" : seoGauge < 50 ? "bad" : "good",
                      },
                      {
                        icon: Gauge,
                        label: "Performance",
                        value: designGauge != null ? `${designGauge}/100` : "N/A",
                        status: designGauge == null ? "neutral" : designGauge < 50 ? "bad" : "good",
                      },
                      {
                        icon: Clock,
                        label: "Load Speed",
                        value: a.loadTimeMs > 0 ? `${(a.loadTimeMs / 1000).toFixed(1)}s` : "N/A",
                        status: a.loadTimeMs === 0 ? "neutral" : a.loadTimeMs > 5000 ? "bad" : "good",
                      },
                      ...(business.server || business.mediaType || business.pageSize ? [
                        {
                          icon: Server,
                          label: "Server",
                          value: business.server || "—",
                          status: "neutral" as const,
                        },
                        {
                          icon: Code,
                          label: "Media Type",
                          value: business.mediaType || "—",
                          status: "neutral" as const,
                        },
                        {
                          icon: Gauge,
                          label: "Page Size",
                          value: formatBytes(business.pageSize),
                          status: "neutral" as const,
                        },
                      ] : []),
                    ];
                    return rows.map((r) => (
                      <WebHealthRow key={r.label} icon={r.icon} label={r.label} value={r.value} status={r.status} badge={r.badge} />
                    ));
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 4. Opportunity Score */}
          <Card>
            <CardHeader className="pb-1 cursor-pointer select-none" onClick={() => setOpportunityOpen((v) => !v)}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Opportunity Score
                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground inline-block ml-1.5 align-middle" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[220px] text-xs">
                          Measures how much room there is to improve this business's digital presence — missing website, weak SEO, no ads, poor reviews, and more all increase the score.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </CardTitle>
                  <CardDescription>Higher score = more room to help</CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    business.leadScore >= 70 ? "text-green-500" :
                    business.leadScore >= 40 ? "text-yellow-500" : "text-red-500"
                  )}>
                    {business.leadScore}
                  </span>
                  {business.reasons && business.reasons.length > 0 && (
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", opportunityOpen && "rotate-180")} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative h-3 w-full rounded-full overflow-hidden bg-muted">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                  style={{
                    width: `${business.leadScore}%`,
                    background: business.leadScore >= 70 ? "#22c55e" : business.leadScore >= 40 ? "#eab308" : "#ef4444",
                  }}
                />
              </div>
            </CardContent>
            <div className={cn(
              "grid transition-all duration-300 ease-in-out",
              opportunityOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            )}>
              <div className="overflow-hidden">
                {business.reasons && business.reasons.length > 0 && (
                  <CardContent className="pt-0">
                    <ul className="space-y-1.5">
                      {business.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                          <span className="text-muted-foreground">{r}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                )}
              </div>
            </div>
          </Card>

          {/* 5. Rating & Reviews */}
          {(business.googleRating > 0 || (ratingDist && ratingTotal > 0)) && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Reviews</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={cn(
                            "h-4 w-4",
                            s <= Math.round(business.googleRating)
                              ? "fill-yellow-400 text-yellow-400"
                              : "fill-muted text-muted-foreground/30"
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-medium">{business.googleRating || "—"}</span>
                    <span className="text-sm text-muted-foreground">({business.reviewCount} reviews)</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {business.reviewCount >= 5 && ratingDist && ratingTotal > 0 ? (
                  [5, 4, 3, 2, 1].map((star) => {
                    const count = ratingDist[String(star)] ?? 0;
                    const pct = ratingTotal > 0 ? (count / ratingTotal) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-3 text-sm">
                        <span className="w-8 flex items-center gap-0.5">
                          {star}<Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        </span>
                        <Progress value={pct} className="h-2 flex-1" />
                        <span className="w-8 text-right text-muted-foreground">{count}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">Breakdown available at 5+ reviews</p>
                )}
                <div className="pt-2 divide-y divide-border">
                  <StatusRow icon={CheckCircle2} label="Listing Claimed" value={business.isClaimed ? "Yes" : "No"} status={business.isClaimed ? "good" : "warning"} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* 6. Business Hours — simplified */}
          {business.currentStatus && (
            <div className="flex items-center gap-2 text-sm px-1">
              <span className={cn(
                "h-2 w-2 rounded-full shrink-0",
                business.currentStatus === "open" ? "bg-green-500" : "bg-muted-foreground/50"
              )} />
              <span className={business.currentStatus === "open" ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}>
                {business.currentStatus === "open" ? "Open now" : "Closed now"}
              </span>
            </div>
          )}

          {business.emails && business.emails.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Mail className="h-4 w-4" /> Contact Emails</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {business.emails.map((e) => (
                    <li key={e}>
                      <a href={`mailto:${e}`} className="text-sm text-primary hover:underline">{e}</a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

        </TabsContent>

        <TabsContent value="scripts" className="space-y-4">
          {planConfig && canGenerateScripts(planConfig) ? (
            <>
              <ScriptBlock
                title="Cold Email Script"
                content={emailContent}
                editable
                isEditing={isEditingEmail}
                onToggleEdit={() => setIsEditingEmail((v) => !v)}
                onChange={handleEmailChange}
                showGmail
              />
              <CopyableBlock title="Cold Call Script" content={generateColdCallScript(business)} />
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <p className="text-muted-foreground text-sm">
                  Upgrade to Agency or Pro to access AI script generation.
                </p>
                <Button asChild size="sm">
                  <a href="/billing">Upgrade Plan</a>
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
