import type { Business } from "@/data/mockBusinesses";
import {
  generateColdEmail, generateColdCallScript,
  generateFixActionItems, generateAdCampaignOutline,
} from "@/data/actionItems";
import { useFirebaseLeadStore, LEAD_STATUSES } from "@/hooks/useFirebaseLeadStore";
import { useLeadStore } from "@/hooks/useLeadStore";
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
  TrendingDown, ExternalLink, Clock, AlertTriangle, Sparkles,
  Wrench, Copy, CheckCircle2, XCircle, Mail, Server, Info, Pencil,
  StickyNote, Images, Loader2, RefreshCw,
} from "lucide-react";
import { ReportButton } from "@/components/ReportDialog";
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

// Web gap tile component
function WebGapTile({
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
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
      </div>
      <div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium">{label}</span>
          {badge && (
            <span className="text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5 leading-none">{badge}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function ScoreGauge({ label, score, max = 100 }: { label: string; score: number | null; max?: number }) {
  if (score == null) {
    return (
      <div className="text-center">
        <div className="text-2xl font-bold text-muted-foreground">—</div>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        <Progress value={0} className="h-1.5 mt-2" />
      </div>
    );
  }
  const pct = Math.round((score / max) * 100);
  const color = pct >= 70 ? "text-green-500" : pct >= 40 ? "text-yellow-500" : "text-red-500";
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{score}</div>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      <Progress value={pct} className="h-1.5 mt-2" />
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
  const [showPricing, setShowPricing] = useState(true);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [localCompleted, setLocalCompleted] = useState<string[]>([]);
  const [localEmailDraft, setLocalEmailDraft] = useState<string | null>(null);
  const [isDownloadingPhotos, setIsDownloadingPhotos] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);

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
  const fixItems = generateFixActionItems(business);

  const completedActionIds = isSaved ? store.getSavedLead(business.id)?.completedActions ?? [] : localCompleted;
  const handleToggleAction = (actionId: string) => {
    if (isSaved) {
      store.toggleActionComplete(business.id, actionId);
    } else {
      setLocalCompleted((prev) => prev.includes(actionId) ? prev.filter((a) => a !== actionId) : [...prev, actionId]);
    }
  };

  const severityRank: Record<string, number> = { critical: 0, medium: 1, low: 2 };
  const sortedFixItems = [...fixItems].sort((x, y) => {
    const xDone = completedActionIds.includes(x.id) ? 1 : 0;
    const yDone = completedActionIds.includes(y.id) ? 1 : 0;
    if (xDone !== yDone) return xDone - yDone;
    return severityRank[x.severity] - severityRank[y.severity];
  });

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
            <h2 className="text-2xl font-extrabold">{business.name}</h2>
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
          <ReportButton cid={business.id} businessName={business.name} />
        </div>
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
              />
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="analysis" className="space-y-4">
        <TabsList>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
          <TabsTrigger value="actions">Action Items</TabsTrigger>
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

          {/* 1. Legitimacy Score — top, with confidence meter */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" /> Legitimacy Score
              </CardTitle>
              <CardDescription>How likely this is a real, operating business</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "text-3xl font-bold tabular-nums shrink-0",
                  (business.legitimacyScore ?? 0) >= 71 ? "text-green-500" :
                  (business.legitimacyScore ?? 0) >= 41 ? "text-yellow-500" : "text-red-500"
                )}>
                  {business.legitimacyScore ?? 0}
                </div>
                <div className="flex-1 space-y-1.5">
                  {/* Pill-shaped gradient progress bar */}
                  <div className="relative h-3 w-full rounded-full overflow-hidden bg-muted">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
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
                  <p className="text-xs text-muted-foreground">
                    {getLegitimacyLabel(business.legitimacyScore ?? 0)}
                  </p>
                </div>
              </div>
              {business.legitimacyReasons && business.legitimacyReasons.length > 0 && (
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
              )}
            </CardContent>
          </Card>

          {/* 2. Marketing agency warning banner (conditional) */}
          {a.hasMarketingAgency && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-400/40 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-500" />
              <span>Marketing agency detected — this business may already have representation</span>
            </div>
          )}

          {/* 3. Web Gaps grid */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Web Gaps</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const domainAgeBadge = a.websiteAge ? `~${a.websiteAge}yr` : undefined;
                const tiles: Array<{ icon: any; label: string; value: string; status: "good" | "bad" | "neutral"; badge?: string; order: number }> = [
                  {
                    icon: Globe,
                    label: "Has Website",
                    value: a.hasWebsite ? (a.websiteUrl ?? "Yes") : "No website",
                    status: a.hasWebsite ? "good" : "bad",
                    badge: a.hasWebsite ? domainAgeBadge : undefined,
                    order: a.hasWebsite ? 1 : 0,
                  },
                  {
                    icon: a.hasHttps ? Shield : ShieldOff,
                    label: "HTTPS",
                    value: !a.hasWebsite ? "N/A" : a.hasHttps ? "Secure" : "Not Secure",
                    status: !a.hasWebsite ? "neutral" : a.hasHttps ? "good" : "bad",
                    order: !a.hasWebsite ? 2 : a.hasHttps ? 1 : 0,
                  },
                  {
                    icon: Gauge,
                    label: "Mobile Friendly",
                    value: !a.hasWebsite ? "N/A" : a.mobileFriendly ? "Yes" : "No",
                    status: !a.hasWebsite ? "neutral" : a.mobileFriendly ? "good" : "bad",
                    order: !a.hasWebsite ? 2 : a.mobileFriendly ? 1 : 0,
                  },
                  {
                    icon: Code,
                    label: "Deprecated HTML",
                    value: !a.hasWebsite ? "N/A" : a.deprecatedHtmlTags > 0 ? `${a.deprecatedHtmlTags} tags` : "None",
                    status: !a.hasWebsite ? "neutral" : a.deprecatedHtmlTags > 3 ? "bad" : "good",
                    order: !a.hasWebsite ? 2 : a.deprecatedHtmlTags > 3 ? 0 : 1,
                  },
                  {
                    icon: TrendingDown,
                    label: "Ad Pixel",
                    value: !a.hasWebsite ? "N/A" : a.hasOnlineAds ? "Detected" : "Not found",
                    status: !a.hasWebsite ? "neutral" : a.hasOnlineAds ? "good" : "bad",
                    order: !a.hasWebsite ? 2 : a.hasOnlineAds ? 1 : 0,
                  },
                  {
                    icon: SearchIcon,
                    label: "Lighthouse SEO",
                    value: seoGauge != null ? `${seoGauge}/100` : "N/A",
                    status: seoGauge == null ? "neutral" : seoGauge < 50 ? "bad" : "good",
                    order: seoGauge == null ? 2 : seoGauge < 50 ? 0 : 1,
                  },
                  {
                    icon: Gauge,
                    label: "Lighthouse Perf",
                    value: designGauge != null ? `${designGauge}/100` : "N/A",
                    status: designGauge == null ? "neutral" : designGauge < 50 ? "bad" : "good",
                    order: designGauge == null ? 2 : designGauge < 50 ? 0 : 1,
                  },
                  {
                    icon: Clock,
                    label: "Time to Interactive",
                    value: !a.hasWebsite || a.loadTimeMs === 0 ? "N/A" : `${(a.loadTimeMs / 1000).toFixed(1)}s`,
                    status: !a.hasWebsite || a.loadTimeMs === 0 ? "neutral" : a.loadTimeMs > 5000 ? "bad" : "good",
                    order: !a.hasWebsite || a.loadTimeMs === 0 ? 2 : a.loadTimeMs > 5000 ? 0 : 1,
                  },
                ];
                const sorted = [...tiles].sort((a, b) => a.order - b.order);
                return (
                  <div className="grid grid-cols-2 gap-2">
                    {sorted.map((t) => (
                      <WebGapTile key={t.label} icon={t.icon} label={t.label} value={t.value} status={t.status} badge={t.badge} />
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* 4. Opportunity Score */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Opportunity Score</CardTitle>
              <CardDescription>Higher score = more room to help</CardDescription>
            </CardHeader>
            <CardContent>
              {a.hasWebsite ? (
                <div className="grid grid-cols-2 gap-4">
                  <ScoreGauge label="Opportunity" score={business.leadScore} />
                  <ScoreGauge label="SEO" score={seoGauge} />
                  <ScoreGauge label="Performance" score={designGauge} />
                  <ScoreGauge label="Load Speed" score={speedGauge} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <div className="w-full max-w-xs">
                      <ScoreGauge label="Opportunity" score={business.leadScore} />
                    </div>
                  </div>
                  <div className="rounded-md border bg-info text-info-foreground border-info-border px-4 py-3 text-sm">
                    SEO, performance, and load speed will be available once this business has a website.
                  </div>
                </div>
              )}
            </CardContent>
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
                  <StatusRow icon={Star} label="Has Reviews" value={a.recentGoogleReviews ? `${business.reviewCount} reviews` : "None"} status={a.recentGoogleReviews ? "good" : "warning"} />
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

          {(business.server || business.mediaType || business.pageSize) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Server className="h-4 w-4" /> Tech Stack</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                <StatusRow icon={Server} label="Server" value={business.server || "—"} status="neutral" />
                <StatusRow icon={Code} label="Media Type" value={business.mediaType || "—"} status="neutral" />
                <StatusRow icon={Gauge} label="Page Size" value={formatBytes(business.pageSize)} status="neutral" />
              </CardContent>
            </Card>
          )}

          {business.reasons && business.reasons.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> Why this opportunity score</CardTitle>
                <CardDescription>What contributed to the {business.leadScore}/100 opportunity score</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {business.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="actions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Fix Action Items</CardTitle>
              <CardDescription>
                Prioritized technical improvements for this lead
                {fixItems.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    · {completedActionIds.filter((id) => fixItems.some((i) => i.id === id)).length}/{fixItems.length} done
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sortedFixItems.map((item) => {
                  const checked = completedActionIds.includes(item.id);
                  const sevClass =
                    item.severity === "critical"
                      ? "border border-destructive/30 border-l-4 border-l-destructive bg-destructive/5"
                      : item.severity === "medium"
                      ? "border border-yellow-500/30 bg-yellow-500/5"
                      : "border border-border bg-secondary/40";
                  const titleWeight =
                    item.severity === "critical" ? "font-medium text-foreground" : item.severity === "low" ? "font-normal text-muted-foreground" : "font-normal text-foreground";
                  return (
                    <label
                      key={item.id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg p-3 text-sm cursor-pointer transition-opacity",
                        sevClass,
                        checked && "opacity-50"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleToggleAction(item.id)}
                        className="mt-0.5 h-[18px] w-[18px] rounded border-input accent-primary cursor-pointer shrink-0"
                        aria-label={`Mark "${item.text}" as ${checked ? "incomplete" : "done"}`}
                      />
                      <span className={cn("flex-1", titleWeight, checked && "line-through")}>{item.text}</span>
                    </label>
                  );
                })}
                {fixItems.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Nothing to fix — this lead's online presence looks solid.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-bold">Ad Campaign Outline</h3>
            <Button variant="outline" size="sm" onClick={() => setShowPricing(!showPricing)}>
              {showPricing ? "Hide Pricing" : "Show Pricing"}
            </Button>
          </div>
          <CopyableBlock title="Ad Campaign" content={
            showPricing ? generateAdCampaignOutline(business) : generateAdCampaignOutline(business).split("## Pricing for Your Services")[0]
          } />
        </TabsContent>

        <TabsContent value="scripts" className="space-y-4">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
