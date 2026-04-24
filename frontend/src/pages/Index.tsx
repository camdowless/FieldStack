import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Business } from "@/data/mockBusinesses";
import { setSearchResults } from "@/lib/businessCache";
import { formatCategoryLabel } from "@/data/dfsCategories";
import { useSearchJob, deriveProgressDisplay } from "@/hooks/useSearchJob";
import { useFirebaseLeadStore } from "@/hooks/useFirebaseLeadStore";
import { useSavedSearches } from "@/hooks/useSavedSearches";
import { useCredits } from "@/hooks/useCredits";
import { usePreferences } from "@/hooks/usePreferences";
import { ResultsTable } from "@/components/ResultsTable";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { ResizableSheet } from "@/components/ResizableSheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Search, Bookmark, Loader2,
  ArrowLeft, Clock, Bookmark as BookmarkIcon, ChevronRight,
  Download, AlertTriangle, Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";

const RADIUS_STEPS = [1, 5, 10, 15, 20, 30, 40, 50] as const;
type Radius = (typeof RADIUS_STEPS)[number];
const MAX_RADIUS: Radius = 50;
const MAX_RADIUS_INDEX = RADIUS_STEPS.indexOf(MAX_RADIUS);

// Must mirror the backend getRadiusTier() function exactly
function getRadiusTier(r: number): { creditCost: number; limit: number } {
  if (r <= 5)  return { creditCost: 1, limit: 150 };
  if (r <= 15) return { creditCost: 2, limit: 400 };
  if (r <= 30) return { creditCost: 3, limit: 700 };
  return       { creditCost: 5, limit: 1000 };
}

// Estimated leads = ~15–20% of businesses searched pass all filters
const RADIUS_EST_LEADS: Record<number, string> = {
  1:  "~15–30 leads",
  5:  "~15–30 leads",
  10: "~40–80 leads",
  15: "~40–80 leads",
  20: "~70–140 leads",
  30: "~70–140 leads",
  40: "~100–200 leads",
  50: "~100–200 leads",
};

type ViewState = "empty" | "loading" | "results" | "error" | "rate_limited";

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

/** Normalize raw API category strings like "Handyman/Handywoman/Handyperson" → "Handyman" */
function cleanCategory(raw: string): string {
  if (!raw) return raw;
  // Take the first value from slash-separated lists
  const first = raw.split("/")[0].trim();
  return first || raw;
}

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [location, setLocation] = useState(searchParams.get("location") || "");
  const [selectedCategory, setSelectedCategory] = useState<string>(searchParams.get("category") || "all");
  const [radius, setRadius] = useState<Radius>(() => {
    const r = Number(searchParams.get("radius"));
    const parsed = (RADIUS_STEPS as readonly number[]).includes(r) ? (r as Radius) : 10;
    return parsed > MAX_RADIUS ? MAX_RADIUS : parsed;
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filteredCount, setFilteredCount] = useState(0);

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
      case "rate_limited": return "rate_limited";
      case "cancelled": return "results";
      default: return "empty";
    }
  })();

  // Slide-over detail panel
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);

  const fbStore = useFirebaseLeadStore();
  const credits = useCredits();
  const { searches: firestoreSearches, updateLeadCount } = useSavedSearches();

  const { prefs } = usePreferences();

  // Apply preference-level filters (disqualified, legitimacy, opportunity score)
  // All other filtering (name, status, reviews, rating) + sorting is handled by ResultsTable
  const baseResults = useMemo(() => {
    const DISQUALIFIED_LABELS = new Set(["disqualified", "defunct", "permanently closed"]);
    return searchJob.results.filter(
      (b) =>
        !DISQUALIFIED_LABELS.has(b.label ?? "") &&
        b.leadScore !== null &&
        (b.legitimacyScore ?? 100) >= prefs.legitimacyScoreMin &&
        (b.leadScore ?? 0) >= prefs.opportunityScoreMin,
    );
  }, [searchJob.results, prefs.legitimacyScoreMin, prefs.opportunityScoreMin]);

  // Update business cache when results change
  useEffect(() => {
    if (searchJob.results.length > 0) {
      setSearchResults(searchJob.results);
    }
  }, [searchJob.results]);

  // Save leadCount when search completes — use baseResults.length which is the
  // post-filter count the user sees, same source as filteredCount in ResultsTable.
  const prevStatusRef = useRef(searchJob.status);
  useEffect(() => {
    const justCompleted = prevStatusRef.current !== "completed" && searchJob.status === "completed";
    if (justCompleted && searchJob.cost) {
      console.log("[search] Cost breakdown:", searchJob.cost);
    }
    if (justCompleted && searchJob.jobId) {
      updateLeadCount(searchJob.jobId, baseResults.length);
    }
    prevStatusRef.current = searchJob.status;
  }, [searchJob.status, searchJob.cost, searchJob.jobId, baseResults.length, updateLeadCount]);

  const handleSearch = useCallback(() => {
    const keyword = selectedCategory !== "all" ? selectedCategory : "businesses";
    const loc = location.trim();
    const { creditCost } = getRadiusTier(radius);

    if (!loc) {
      toast.error("Please enter a location (zip code or city).");
      return;
    }

    if (credits.remaining < creditCost) {
      toast.error(`This search costs ${creditCost} credits but you only have ${credits.remaining} remaining. Please upgrade your plan.`);
      return;
    }

    searchJob.startSearch({ keyword, location: loc, radius });
    setForceEmpty(false);
  }, [selectedCategory, location, radius, searchJob.startSearch, credits.remaining]);

  // When the hook rehydrates a job (page refresh), mirror params into local
  // form state and clear forceEmpty so the results view is shown.
  const prevActiveParamsRef = useRef(searchJob.activeParams);
  useEffect(() => {
    if (searchJob.activeParams && !prevActiveParamsRef.current) {
      const { keyword, location: loc } = searchJob.activeParams;
      setSelectedCategory(keyword === "businesses" ? "all" : keyword);
      setLocation(loc);
      setForceEmpty(false);
    }
    prevActiveParamsRef.current = searchJob.activeParams;
  }, [searchJob.activeParams]);
  // (e.g. clicking "Lead Search" in sidebar or after logout/login)
  const prevRestoreRef = useRef(searchParams.get("restore"));
  useEffect(() => {
    const restoreId = searchParams.get("restore");
    // If there's no restore param and we previously had one,
    // reset to empty state so stale results don't linger.
    if (!restoreId && prevRestoreRef.current) {
      setForceEmpty(true);
      setLocation("");
      setSelectedCategory("all");
      setRadius(10);
      setSelectedBusiness(null);
      setSelectedIds(new Set());
    }
    prevRestoreRef.current = restoreId;
  }, [searchParams]);

  // Auto-trigger a re-run when navigated from Search History with ?rerun=1
  const rerunFiredRef = useRef(false);
  useEffect(() => {
    if (searchParams.get("rerun") !== "1") return;
    if (rerunFiredRef.current) return;
    rerunFiredRef.current = true;

    const keyword = searchParams.get("keyword") || "businesses";
    const loc = searchParams.get("location") || "";
    const r = Number(searchParams.get("radius")) || 10;
    const snappedRadius = (RADIUS_STEPS as readonly number[]).includes(r) ? (r as Radius) : 10;

    setSelectedCategory(keyword === "businesses" ? "all" : keyword);
    setLocation(loc);
    setRadius(snappedRadius > MAX_RADIUS ? MAX_RADIUS : snappedRadius);
    setForceEmpty(false);

    if (loc) {
      searchJob.startSearch({ keyword, location: loc, radius: snappedRadius });
    }

    // Clean up the rerun params from the URL without a history entry
    setSearchParams({}, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewSearch = useCallback(() => {
    searchJob.reset();
    setForceEmpty(true);
    setLocation("");
    setSelectedCategory("all");
    setRadius(10);
    setSelectedBusiness(null);
    setSelectedIds(new Set());
    // Clear URL params (e.g. ?restore=...) and reset state
    setSearchParams({}, { replace: true });
  }, [setSearchParams, searchJob.reset]);

  // Countdown timer for rate limit cooldown
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (searchJob.status !== "rate_limited" || searchJob.retryAfter == null) {
      setCountdown(null);
      return;
    }
    setCountdown(searchJob.retryAfter);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c == null || c <= 1) {
          clearInterval(interval);
          searchJob.reset();
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [searchJob.status, searchJob.retryAfter]);

  const recentSearches = firestoreSearches.slice(0, 5);
  const savedLeadsCount = fbStore.savedLeads.length;

  const describeRecent = (s: typeof firestoreSearches[number]) => {
    const parts: string[] = [];
    if (s.category) parts.push(s.category);
    if (s.location) parts.push(s.location);
    return parts.length > 0 ? parts.join(" · ") : "All leads";
  };

  const canSearch = !!location.trim();

  const toTitleCase = (s: string) =>
    s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const categoryDisplayLabel = (() => {
    if (!selectedCategory || selectedCategory === "all") return null;
    return formatCategoryLabel(selectedCategory);
  })();

  const searchSummary = [
    categoryDisplayLabel,
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
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-6"
          >
            <Search className="h-8 w-8 text-primary" />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
            className="text-3xl font-bold mb-2"
          >
            Find Your Next Client
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18, ease: "easeOut" }}
            className="text-muted-foreground mb-8"
          >
            Search by zip code or city to discover businesses with weak online presence.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.26, ease: "easeOut" }}
            className="flex flex-col gap-4"
          >
            {/* Row 1: Category + Location */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 text-left">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Category
                </label>
                <CategoryCombobox
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  className="w-full"
                  inputClassName="h-11 text-base"
                  placeholder="e.g. Plumber, HVAC, Landscaper"
                  onKeyDown={(e) => e.key === "Enter" && canSearch && handleSearch()}
                />
              </div>
              <div className="flex-1 text-left">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Location</label>
                <LocationAutocomplete
                  value={location}
                  onChange={setLocation}
                  inputClassName="h-11 text-base"
                  onKeyDown={(e) => e.key === "Enter" && canSearch && handleSearch()}
                />
              </div>
            </div>

            {/* Row 2: Radius slider with estimated lead count */}
            <div className="text-left">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Search Radius: <span className="text-foreground font-semibold">{radius} mi</span>
                </label>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  {RADIUS_EST_LEADS[radius]}
                </span>
              </div>
              <div className="px-1">
                <Slider
                  min={0}
                  max={MAX_RADIUS_INDEX}
                  step={1}
                  value={[indexFromRadius(radius)]}
                  onValueChange={([i]) => setRadius(radiusFromIndex(i))}
                  aria-label="Search radius"
                />
                <div className="flex justify-between mt-1.5">
                  {RADIUS_STEPS.map((r) => (
                    <span
                      key={r}
                      className={`text-[10px] ${
                        radius === r ? "text-foreground font-medium" : "text-muted-foreground"
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: Search button */}
            <div className="mt-1">
              <Button
                size="lg"
                className="h-12 text-base w-full"
                disabled={!canSearch || credits.remaining < getRadiusTier(radius).creditCost}
                onClick={handleSearch}
              >
                <Search className="h-4 w-4 mr-2" />
                Search Leads · {getRadiusTier(radius).creditCost} credit{getRadiusTier(radius).creditCost > 1 ? "s" : ""}
              </Button>
              {credits.remaining < getRadiusTier(radius).creditCost && credits.remaining > 0 && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  You have {credits.remaining} credit{credits.remaining !== 1 ? "s" : ""} — reduce the radius or{" "}
                  <Link to="/billing" className="text-primary underline underline-offset-2">upgrade your plan</Link>.
                </p>
              )}
            </div>

            {/* No credits banner */}
            {credits.remaining === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
              >
                <div className="text-sm">
                  <span className="font-semibold text-destructive">Out of credits.</span>{" "}
                  <span className="text-muted-foreground">Upgrade to keep finding leads.</span>
                </div>
                <Link
                  to="/billing"
                  className="shrink-0 text-xs font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  View plans →
                </Link>
              </motion.div>
            )}
          </motion.div>

          {recentSearches.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.38, ease: "easeOut" }}
              className="mt-8 text-left"
            >
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
                      {(s.leadCount ?? s.resultCount)} lead{(s.leadCount ?? s.resultCount) === 1 ? "" : "s"}
                    </Badge>
                  </Link>
                ))}
              </div>
            </motion.div>
          )}

          {savedLeadsCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: recentSearches.length > 0 ? 0.46 : 0.38, ease: "easeOut" }}
            >
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
            </motion.div>
          )}
        </div>
      </div>
    );
  }

  // ── LOADING STATE (no partial results yet) ──
  if (viewState === "loading" && searchJob.results.length === 0) {
    const cat = categoryDisplayLabel ?? "businesses";
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

  // ── RATE LIMITED STATE ──
  if (viewState === "rate_limited") {
    return (
      <div className="p-6 flex items-center justify-center min-h-[80vh]">
        <div className="w-full max-w-sm text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 mx-auto mb-6">
            <Clock className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">Slow down a little</h2>
          <p className="text-sm text-muted-foreground mb-6">
            You've hit the search limit. Searches are expensive to run, so we cap them at 3 per minute.
          </p>
          <div className="text-4xl font-mono font-bold tabular-nums mb-2">
            {countdown != null ? countdown : "—"}
          </div>
          <p className="text-xs text-muted-foreground mb-6">seconds until you can search again</p>
          <Button variant="outline" size="sm" onClick={handleNewSearch}>
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
  const toggleSelectAll = (filtered: Business[]) => {
    setSelectedIds((prev) => {
      const allSelected = filtered.length > 0 && filtered.every((b) => prev.has(b.id));
      const next = new Set(prev);
      if (allSelected) {
        filtered.forEach((b) => next.delete(b.id));
      } else {
        filtered.forEach((b) => next.add(b.id));
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

  const saveSelected = () => {
    baseResults
      .filter((b) => selectedIds.has(b.id))
      .forEach((b) => fbStore.saveLead(b));
    setSelectedIds(new Set());
  };

  const exportCsv = () => {
    const cols = ["Score", "Label", "Business", "Industry", "HTTPS", "Mobile", "Ads", "SEO"];
    const rows = baseResults
      .filter((b) => selectedIds.has(b.id))
      .map((b) => {
        const a = b.analysis;
        const ternary = (has: boolean, ok: boolean) => (!has ? "N/A" : ok ? "Yes" : "No");
        return [
          b.leadScore,
          b.label || "",
          b.name,
          cleanCategory(b.category),
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
                    ? `Analyzing ${progressDisplay.analyzed} of ${progressDisplay.total} websites… (${baseResults.length} results so far)`
                    : viewState === "loading"
                      ? `Starting search… (${baseResults.length} results so far)`
                      : `${filteredCount} leads found`}
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

        </div>
      </motion.div>

      <ResultsTable
        results={baseResults}
        isLeadSaved={(id) => fbStore.isLeadSaved(id)}
        onSaveLead={(b) => fbStore.saveLead(b)}
        onRemoveLead={(id) => fbStore.removeLead(id)}
        selection={{
          selectedIds,
          onToggleOne: toggleSelectOne,
          onToggleAll: toggleSelectAll,
        }}
        onSelectBusiness={setSelectedBusiness}
        onFilteredCountChange={setFilteredCount}
        isLoading={viewState === "loading"}
      />

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
      <ResizableSheet
        open={!!selectedBusiness}
        onOpenChange={(open) => { if (!open) setSelectedBusiness(null); }}
        title={selectedBusiness?.name ?? "Lead Detail"}
        description="Detailed analysis for this business lead"
      >
        {selectedBusiness && <LeadDetailPanel business={selectedBusiness} onUpdate={setSelectedBusiness} />}
      </ResizableSheet>
    </div>
  );
};

export default Index;
