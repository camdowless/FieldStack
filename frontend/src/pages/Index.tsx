import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Business } from "@/data/mockBusinesses";
import { formatCategoryLabel } from "@/data/dfsCategories";
import { setSearchResults } from "@/lib/businessCache";
import { useSearchJob, deriveProgressDisplay } from "@/hooks/useSearchJob";
import { useFirebaseLeadStore } from "@/hooks/useFirebaseLeadStore";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import { useCredits } from "@/hooks/useCredits";
import { usePreferences } from "@/hooks/usePreferences";
import { LeadScoreBadge } from "@/components/LeadScoreBadge";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import {
  Search, MapPin, X, Check, Bookmark, BookmarkCheck, ExternalLink, Loader2,
  ArrowLeft, ArrowUp, ArrowDown, Clock, Bookmark as BookmarkIcon, ChevronRight,
  Copy, Download, AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";

const RADIUS_STEPS = [1, 5, 10, 15, 20, 30, 40, 50] as const;
type Radius = (typeof RADIUS_STEPS)[number];
const MAX_RADIUS: Radius = 50;
const MAX_RADIUS_INDEX = RADIUS_STEPS.indexOf(MAX_RADIUS);
const RESULT_LIMIT_OPTIONS = [25, 50, 100, 200] as const;

const LABEL_FILTER_OPTIONS = [
  { value: "opportunity", label: "Opportunity" },
  { value: "low opportunity", label: "Low Opportunity" },
  { value: "no website", label: "No Website" },
  { value: "dead site", label: "Dead Site" },
  { value: "parked", label: "Parked" },
  { value: "defunct", label: "Defunct" },
  { value: "disqualified", label: "Disqualified" },
  { value: "permanently closed", label: "Permanently Closed" },
  { value: "third-party listing", label: "3rd Party" },
] as const;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusCell({ status }: { status: "pass" | "fail" | "na" }) {
  if (status === "pass") return <Check className="h-4 w-4 text-green-500 mx-auto" aria-label="Present" />;
  if (status === "fail") return <X className="h-4 w-4 text-red-500 mx-auto" aria-label="Missing" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground cursor-help" aria-label="N/A">—</span>
      </TooltipTrigger>
      <TooltipContent>N/A — no website detected for this business</TooltipContent>
    </Tooltip>
  );
}

/** Normalize raw API category strings like "Handyman/Handywoman/Handyperson" → "Handyman" */
function cleanCategory(raw: string): string {
  if (!raw) return raw;
  // Take the first value from slash-separated lists
  const first = raw.split("/")[0].trim();
  return first || raw;
}

type ViewState = "empty" | "loading" | "results" | "error";
type SortDir = "asc" | "desc";
const DEFAULT_SORT_COL = "score";
const DEFAULT_SORT_DIR: SortDir = "desc";

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, setSearchQuery] = useState("");
  const [location, setLocation] = useState(searchParams.get("location") || "");
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get("category") || "all");
  const [radius, setRadius] = useState<Radius>(() => {
    const r = Number(searchParams.get("radius"));
    const parsed = (RADIUS_STEPS as readonly number[]).includes(r) ? (r as Radius) : 10;
    return parsed > MAX_RADIUS ? MAX_RADIUS : parsed;
  });
  const [resultLimit, setResultLimit] = useState(50);
  const [sortBy, setSortBy] = useState<string>(DEFAULT_SORT_COL);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Job-based search hook
  const searchJob = useSearchJob();
  const progressDisplay = deriveProgressDisplay(searchJob.status, searchJob.progress);

  // Track whether user explicitly reset to empty state
  const [forceEmpty, setForceEmpty] = useState(true);

  // Derive view state from hook status
  const viewState: ViewState = (() => {
    if (forceEmpty && (searchJob.status === "idle" || searchJob.status === "cancelled")) return "empty";
    switch (searchJob.status) {
      case "idle": return "empty";
      case "creating":
      case "running": return "loading";
      case "completed": return "results";
      case "failed": return "error";
      case "cancelled": return "results";
      default: return "empty";
    }
  })();

  // Slide-over detail panel
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);

  const fbStore = useFirebaseLeadStore();
  const credits = useCredits();
  const { searches: firestoreSearches } = useSavedSearches();

  const { prefs } = usePreferences();

  // Client-side filtering of API results (name filter + preferences)
  const filteredResults = useMemo(() => {
    const DISQUALIFIED_LABELS = new Set(["disqualified", "defunct", "permanently closed"]);
    let results = searchJob.results.filter(
      (b) =>
        !DISQUALIFIED_LABELS.has(b.label ?? "") &&
        b.leadScore !== null &&
        (b.legitimacyScore ?? 100) >= prefs.legitimacyScoreMin &&
        (b.leadScore ?? 0) >= prefs.opportunityScoreMin,
    );

    if (labelFilter.size > 0) {
      results = results.filter((b) => labelFilter.has(b.label ?? ""));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      results = results.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (b.city || "").toLowerCase().includes(q),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: string | number | null | undefined, b: string | number | null | undefined) => {
      const av = a ?? (typeof b === "number" ? -Infinity : "");
      const bv = b ?? (typeof a === "number" ? -Infinity : "");
      if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    };
    results.sort((a, b) => {
      const an = a.analysis;
      const bn = b.analysis;
      switch (sortBy) {
        case "score": return cmp(a.leadScore, b.leadScore);
        case "name": return cmp(a.name, b.name);
        case "industry": return cmp(a.category, b.category);
        case "phone": return cmp(a.phone, b.phone);
        case "website": return cmp(an.hasWebsite ? 1 : 0, bn.hasWebsite ? 1 : 0);
        case "https": return cmp(!an.hasWebsite ? -1 : an.hasHttps ? 1 : 0, !bn.hasWebsite ? -1 : bn.hasHttps ? 1 : 0);
        case "mobile": return cmp(!an.hasWebsite ? -1 : an.mobileFriendly ? 1 : 0, !bn.hasWebsite ? -1 : bn.mobileFriendly ? 1 : 0);
        case "ads": return cmp(an.hasOnlineAds ? 1 : 0, bn.hasOnlineAds ? 1 : 0);
        case "seo": return cmp(an.hasWebsite ? an.seoScore : -1, bn.hasWebsite ? bn.seoScore : -1);
        default: return 0;
      }
    });
    return results;
  }, [searchJob.results, searchQuery, sortBy, sortDir, labelFilter, prefs.legitimacyScoreMin, prefs.opportunityScoreMin]);

  // Count each label across all (pre-label-filter) results for the chips
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of searchJob.results) {
      const l = b.label ?? "";
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    return counts;
  }, [searchJob.results]);

  // Update business cache when results change
  useEffect(() => {
    if (searchJob.results.length > 0) {
      setSearchResults(searchJob.results);
    }
  }, [searchJob.results]);

  // Deduct credit when search completes
  const prevStatusRef = useRef(searchJob.status);
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && searchJob.status === "completed") {
      credits.consume(1);
      if (searchJob.cost) {
        console.log("[search] Cost breakdown:", searchJob.cost);
      }
    }
    prevStatusRef.current = searchJob.status;
  }, [searchJob.status, searchJob.cost, credits]);

  const handleSearch = useCallback(() => {
    const keyword = selectedCategory !== "all" ? selectedCategory : "businesses";
    const loc = location.trim();

    if (!loc) {
      toast.error("Please enter a location (zip code or city).");
      return;
    }

    searchJob.startSearch({ keyword, location: loc, radius, limit: resultLimit });
    setForceEmpty(false);
  }, [selectedCategory, location, radius, resultLimit, searchJob.startSearch]);

  // Reset all search state when navigating to this page without a restore param
  // (e.g. clicking "Lead Search" in sidebar or after logout/login)
  const prevRestoreRef = useRef(searchParams.get("restore"));
  useEffect(() => {
    const restoreId = searchParams.get("restore");
    // If there's no restore param and we previously had one,
    // reset to empty state so stale results don't linger.
    if (!restoreId && prevRestoreRef.current) {
      setForceEmpty(true);
      setSearchQuery("");
      setLocation("");
      setSelectedCategory("all");
      setRadius(10);
      setSortBy("score");
      setSortDir("desc");
      setSelectedBusiness(null);
      setSelectedIds(new Set());
    }
    prevRestoreRef.current = restoreId;
  }, [searchParams]);

  const handleNewSearch = useCallback(() => {
    searchJob.reset();
    setForceEmpty(true);
    setSearchQuery("");
    setLocation("");
    setSelectedCategory("all");
    setRadius(10);
    setResultLimit(50);
    setSortBy("score");
    setSortDir("desc");
    setLabelFilter(new Set());
    setSelectedBusiness(null);
    setSelectedIds(new Set());
    // Clear URL params (e.g. ?restore=...) and reset state
    setSearchParams({}, { replace: true });
  }, [setSearchParams, searchJob.reset]);

  const recentSearches = firestoreSearches.slice(0, 5);
  const savedLeadsCount = fbStore.savedLeads.length;

  const describeRecent = (s: typeof firestoreSearches[number]) => {
    const parts: string[] = [];
    if (s.category) parts.push(s.category);
    if (s.location) parts.push(s.location);
    return parts.length > 0 ? parts.join(" · ") : "All leads";
  };

  const toggleSort = (col: string) => {
    if (sortBy !== col) {
      setSortBy(col);
      setSortDir(col === "name" || col === "industry" || col === "phone" || col === "website" ? "asc" : "desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortBy(DEFAULT_SORT_COL);
      setSortDir(DEFAULT_SORT_DIR);
    }
  };

  const SortHeader = ({ col, children, className = "" }: { col: string; children: React.ReactNode; className?: string }) => {
    const active = sortBy === col;
    return (
      <th
        className={`py-3 px-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
        onClick={() => toggleSort(col)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {active && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
        </span>
      </th>
    );
  };

  const canSearch = !!location.trim();

  const toTitleCase = (s: string) =>
    s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const searchSummary = [
    selectedCategory !== "all" ? formatCategoryLabel(selectedCategory) : null,
    location ? toTitleCase(location.trim()) : null,
  ].filter(Boolean).join(" in ");

  // Helper: snap slider index → radius value
  const radiusFromIndex = (i: number) => RADIUS_STEPS[i] ?? 10;
  const indexFromRadius = (r: Radius) => RADIUS_STEPS.indexOf(r);

  // ── EMPTY STATE ──
  if (viewState === "empty") {
    return (
      <div className="p-6 flex items-center justify-center min-h-[80vh]">
        <div className="w-full max-w-xl text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-6">
            <Search className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Find Your Next Client</h1>
          <p className="text-muted-foreground mb-8">
            Search by zip code or city to discover businesses with weak online presence.
          </p>

          <div className="flex flex-col gap-4">
            {/* Row 1: Category + Location */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 text-left">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Category</label>
                <CategoryCombobox
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  className="w-full"
                  inputClassName="h-11 text-base"
                  placeholder="e.g. Landscaper, Plumber"
                  onKeyDown={(e) => e.key === "Enter" && canSearch && handleSearch()}
                />
              </div>
              <div className="flex-1 text-left">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Location</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Zip code or city"
                    className="pl-10 h-11 text-base"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && canSearch && handleSearch()}
                  />
                </div>
              </div>
            </div>

            {/* Row 2: Radius slider */}
            <div className="text-left">
              <label className="text-xs font-medium text-muted-foreground mb-3 block">
                Search Radius: <span className="text-foreground font-semibold">{radius} mi</span>
              </label>
              <div className="px-1">
                <Slider
                  min={0}
                  max={MAX_RADIUS_INDEX}
                  step={1}
                  value={[indexFromRadius(radius)]}
                  onValueChange={([i]) => setRadius(radiusFromIndex(i))}
                  aria-label="Search radius"
                  className="flex-grow"
                  style={{ width: `${((MAX_RADIUS_INDEX) / (RADIUS_STEPS.length - 1)) * 100}%` }}
                />
                <div className="flex justify-between mt-1.5">
                  {RADIUS_STEPS.map((r) => {
                    const disabled = r > MAX_RADIUS;
                    return (
                      <span
                        key={r}
                        className={`text-[10px] ${
                          disabled
                            ? "text-muted-foreground/30 line-through"
                            : radius === r
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                        }`}
                      >
                        {r}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Row 3: Max results + Search button */}
            <div className="flex gap-3 items-end mt-1">
              <div className="text-left shrink-0">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Max Results</label>
                <select
                  value={resultLimit}
                  onChange={(e) => setResultLimit(Number(e.target.value))}
                  className="h-12 px-3 rounded-md border border-input bg-background text-sm"
                  aria-label="Max results"
                >
                  {RESULT_LIMIT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <Button
                size="lg"
                className="h-12 text-base flex-1"
                disabled={!canSearch}
                onClick={handleSearch}
              >
                <Search className="h-4 w-4 mr-2" />
                Search Leads · 1 credit
              </Button>
            </div>
          </div>

          {recentSearches.length > 0 && (
            <div className="mt-8 text-left">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Recent searches
              </h2>
              <div className="flex flex-col gap-2">
                {recentSearches.map((s) => (
                  <Link
                    key={s.id}
                    to="/search-history"
                    className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-muted/50 transition-colors text-left group"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{describeRecent(s)}</p>
                      <p className="text-xs text-muted-foreground">{relativeTime(s.createdAt)}</p>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {s.resultCount} result{s.resultCount === 1 ? "" : "s"}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {savedLeadsCount > 0 && (
            <Link
              to="/dashboard"
              className="mt-3 flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-muted/50 transition-colors text-left group"
            >
              <BookmarkIcon className="h-4 w-4 text-primary shrink-0" />
              <span className="flex-1 text-sm font-medium">
                Saved Leads — {savedLeadsCount} total
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ── LOADING STATE (no partial results yet) ──
  if (viewState === "loading" && searchJob.results.length === 0) {
    const cat = selectedCategory !== "all" ? formatCategoryLabel(selectedCategory) : "businesses";
    const loc = location ? location : "your area";

    let progressMessage: string;
    if (progressDisplay.kind === "analyzing") {
      progressMessage = `Analyzing ${progressDisplay.analyzed} of ${progressDisplay.total} websites…`;
    } else {
      progressMessage = "Starting search…";
    }

    return (
      <div className="p-6 flex items-center justify-center min-h-[80vh]">
        <div className="w-full max-w-sm text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-6" />
          <p className="text-lg font-medium mb-2">Searching {cat} near {loc}…</p>
          <p className="text-sm text-muted-foreground mb-1">
            {progressMessage}
          </p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => searchJob.cancelSearch()}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── ERROR STATE ──
  if (viewState === "error") {
    return (
      <div className="p-6 flex items-center justify-center min-h-[80vh]">
        <div className="w-full max-w-sm text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Search Failed</h2>
          <p className="text-sm text-muted-foreground mb-6">{searchJob.error}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={handleNewSearch}>New Search</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULTS STATE ──
  const allVisibleSelected = filteredResults.length > 0 && filteredResults.every((b) => selectedIds.has(b.id));
  const someVisibleSelected = filteredResults.some((b) => selectedIds.has(b.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredResults.forEach((b) => next.delete(b.id));
      } else {
        filteredResults.forEach((b) => next.add(b.id));
      }
      return next;
    });
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(phone);
      setTimeout(() => setCopiedPhone((p) => (p === phone ? null : p)), 1500);
    } catch {
      /* ignore */
    }
  };

  const saveSelected = () => {
    filteredResults
      .filter((b) => selectedIds.has(b.id))
      .forEach((b) => fbStore.saveLead(b));
    setSelectedIds(new Set());
  };

  const exportCsv = () => {
    const cols = ["Score", "Label", "Business", "Industry", "Phone", "Website", "HTTPS", "Mobile", "Ads", "SEO"];
    const rows = filteredResults
      .filter((b) => selectedIds.has(b.id))
      .map((b) => {
        const a = b.analysis;
        const ternary = (has: boolean, ok: boolean) => (!has ? "N/A" : ok ? "Yes" : "No");
        return [
          b.leadScore,
          b.label || "",
          b.name,
          cleanCategory(b.category),
          b.phone || "",
          a.hasWebsite ? a.websiteUrl || "Yes" : "None",
          ternary(a.hasWebsite, a.hasHttps),
          ternary(a.hasWebsite, a.mobileFriendly),
          a.hasOnlineAds ? "Yes" : (!a.hasWebsite ? "N/A" : "No"),
          a.hasWebsite ? a.seoScore : "N/A",
        ];
      });
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 pb-24">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleNewSearch}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Results for {searchSummary || "all businesses"}</h1>
                <p className="text-sm text-muted-foreground">
                  {viewState === "loading" && progressDisplay.kind === "analyzing"
                    ? `Analyzing ${progressDisplay.analyzed} of ${progressDisplay.total} websites… (${filteredResults.length} results so far)`
                    : viewState === "loading"
                      ? `Starting search… (${filteredResults.length} results so far)`
                      : `${filteredResults.length} leads found`}
                  {searchJob.status === "cancelled" && " (partial — search was cancelled)"}
                  {progressDisplay.kind === "no-results" && " — no businesses found in this area"}
                </p>
              </div>
            </div>
            {viewState === "loading" && (
              <Button variant="ghost" size="sm" onClick={() => searchJob.cancelSearch()}>
                Cancel
              </Button>
            )}
          </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Filter by name..." className="pl-10 h-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")} className="h-9 px-3">
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          )}
        </div>
        {labelCounts.size > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {LABEL_FILTER_OPTIONS.filter((l) => labelCounts.has(l.value)).map((l) => {
              const active = labelFilter.has(l.value);
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setLabelFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.value)) next.delete(l.value); else next.add(l.value);
                    return next;
                  })}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {l.label}
                  <span className={`${active ? "opacity-80" : "opacity-60"}`}>
                    {labelCounts.get(l.value)}
                  </span>
                </button>
              );
            })}
            {labelFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setLabelFilter(new Set())}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}
        </div>
      </motion.div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-3 px-3 w-[40px]">
                <Checkbox
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <SortHeader col="score" className="w-[70px]">Score</SortHeader>
              <SortHeader col="name" className="min-w-[180px]">Business</SortHeader>
              <SortHeader col="industry" className="min-w-[140px]">Industry</SortHeader>
              <SortHeader col="phone" className="w-[160px]">Phone</SortHeader>
              <SortHeader col="website" className="w-[100px]">Website</SortHeader>
              <SortHeader col="https" className="w-[70px] text-center">HTTPS</SortHeader>
              <SortHeader col="mobile" className="w-[70px] text-center">Mobile</SortHeader>
              <SortHeader col="ads" className="w-[70px] text-center">Ads</SortHeader>
              <SortHeader col="seo" className="w-[80px]">SEO</SortHeader>
              <th className="py-3 px-3 font-medium w-[70px]"></th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan={11} className="py-12 text-center text-muted-foreground">
                  No leads found. Try a different category or location.
                </td>
              </tr>
            )}
            {filteredResults.map((b) => {
              const a = b.analysis;
              const isSaved = fbStore.isLeadSaved(b.id);
              const checked = selectedIds.has(b.id);
              return (
                <tr
                  key={b.id}
                  className="border-b border-border/50 hover:bg-muted/30 group transition-colors cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
                    setSelectedBusiness(b);
                  }}
                >
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleSelectOne(b.id)}
                      aria-label={`Select ${b.name}`}
                    />
                  </td>
                  <td className="py-3 px-3">
                    <LeadScoreBadge score={b.leadScore} label={b.label} size="sm" />
                  </td>
                  <td className="py-3 px-3 max-w-[220px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-medium block truncate">{b.name}</span>
                      </TooltipTrigger>
                      {b.name.length > 35 && <TooltipContent>{b.name}</TooltipContent>}
                    </Tooltip>
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">{cleanCategory(b.category)}</td>
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    {b.phone ? (
                      <span className="inline-flex items-center gap-1.5">
                        <a href={`tel:${b.phone}`} className="hover:underline">{b.phone}</a>
                        <Tooltip open={copiedPhone === b.phone ? true : undefined}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => copyPhone(b.phone!)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                              aria-label="Copy phone"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{copiedPhone === b.phone ? "Copied" : "Copy"}</TooltipContent>
                        </Tooltip>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    {a.hasWebsite ? (
                      <a
                        href={a.websiteUrl || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Link
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <StatusCell status={!a.hasWebsite ? "na" : a.hasHttps ? "pass" : "fail"} />
                  </td>
                  <td className="py-3 px-3 text-center">
                    <StatusCell status={!a.hasWebsite ? "na" : a.mobileFriendly ? "pass" : "fail"} />
                  </td>
                  <td className="py-3 px-3 text-center">
                    <StatusCell status={!a.hasWebsite ? "na" : a.hasOnlineAds ? "pass" : "fail"} />
                  </td>
                  <td className="py-3 px-3">
                    {a.hasWebsite && a.seoScore > 0 ? (
                      <span className={`font-medium ${a.seoScore >= 70 ? "text-green-500" : a.seoScore >= 40 ? "text-yellow-500" : "text-red-500"}`}>
                        {a.seoScore}/100
                      </span>
                    ) : (
                      <StatusCell status="na" />
                    )}
                  </td>
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${isSaved ? "text-primary bg-primary/10" : ""}`}
                        onClick={() => isSaved ? fbStore.removeLead(b.id) : fbStore.saveLead(b)}
                      >
                        {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setSelectedBusiness(b)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk action bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur transition-transform duration-300 ${
          selectedIds.size > 0 ? "translate-y-0" : "translate-y-full"
        }`}
        role="region"
        aria-label="Bulk actions"
      >
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveSelected}>
              <Bookmark className="h-4 w-4 mr-1.5" /> Save Selected
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1.5" /> Export CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Deselect All
            </Button>
          </div>
        </div>
      </div>

      {/* Lead detail slide-over */}
      <Sheet open={!!selectedBusiness} onOpenChange={(open) => { if (!open) setSelectedBusiness(null); }}>
        <SheetContent side="right" className="p-0 sm:max-w-3xl w-full">
          <SheetHeader className="sr-only">
            <SheetTitle>{selectedBusiness?.name ?? "Lead Detail"}</SheetTitle>
            <SheetDescription>Detailed analysis for this business lead</SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-full">
            <div className="p-6">
              {selectedBusiness && <LeadDetailPanel business={selectedBusiness} />}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Index;
