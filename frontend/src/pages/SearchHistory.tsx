import { useState, useCallback, useMemo } from "react";
import { useSavedSearches, type FirestoreSavedSearch } from "@/hooks/useSavedSearches";
import { fetchBusinessesByCids, SearchError } from "@/lib/api";
import { normalizeBusiness } from "@/data/leadTypes";
import { setSearchResults } from "@/lib/businessCache";
import { useFirebaseLeadStore } from "@/hooks/useFirebaseLeadStore";
import { usePreferences } from "@/hooks/usePreferences";
import { LeadScoreBadge } from "@/components/LeadScoreBadge";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Trash2, Search, Clock, X, Loader2, ArrowLeft, Check, ExternalLink,
  Bookmark, BookmarkCheck, Copy,
} from "lucide-react";
import { motion } from "framer-motion";
import { Business } from "@/data/mockBusinesses";

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

function cleanCategory(raw: string): string {
  if (!raw) return raw;
  return raw.split("/")[0].trim() || raw;
}

const SearchHistory = () => {
  const { searches: savedSearches, loading, deleteSearch, clearAllSearches } = useSavedSearches();
  const fbStore = useFirebaseLeadStore();
  const { prefs } = usePreferences();

  // Inline result viewing state
  const [activeSearch, setActiveSearch] = useState<FirestoreSavedSearch | null>(null);
  const [results, setResults] = useState<Business[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string>("");
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  // Apply user's score tolerances to restored search results
  const filteredResults = useMemo(() => {
    return results.filter(
      (b) =>
        (b.legitimacyScore ?? 100) >= prefs.legitimacyScoreMin &&
        (b.leadScore ?? 0) >= prefs.opportunityScoreMin,
    );
  }, [results, prefs.legitimacyScoreMin, prefs.opportunityScoreMin]);

  const restoreSearch = useCallback(async (search: FirestoreSavedSearch) => {
    setActiveSearch(search);
    setResultsLoading(true);
    setResultsError("");
    setResults([]);

    try {
      const response = await fetchBusinessesByCids(search.cids);
      const businesses = response.results.map(normalizeBusiness);
      setSearchResults(businesses);
      setResults(businesses);
    } catch (err) {
      const message = err instanceof SearchError ? err.message : "Failed to load saved search.";
      setResultsError(message);
    } finally {
      setResultsLoading(false);
    }
  }, []);

  const handleBack = () => {
    setActiveSearch(null);
    setResults([]);
    setResultsError("");
    setSelectedBusiness(null);
  };

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(phone);
      setTimeout(() => setCopiedPhone((p) => (p === phone ? null : p)), 1500);
    } catch { /* ignore */ }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
  };

  const describeSearch = (s: FirestoreSavedSearch) => {
    const parts: string[] = [];
    if (s.category) parts.push(s.category);
    if (s.location) parts.push(s.location);
    return parts.length > 0 ? parts.join(" · ") : "All leads";
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── INLINE RESULTS VIEW ──
  if (activeSearch) {
    return (
      <div className="p-6">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-4">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{describeSearch(activeSearch)}</h1>
              <p className="text-sm text-muted-foreground">
                {resultsLoading ? "Loading…" : `${filteredResults.length} leads · searched ${formatDate(activeSearch.createdAt)}`}
              </p>
            </div>
          </div>
        </motion.div>

        {resultsLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {resultsError && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-destructive mb-4">{resultsError}</p>
            <Button onClick={() => restoreSearch(activeSearch)}>Try Again</Button>
          </div>
        )}

        {!resultsLoading && !resultsError && results.length > 0 && filteredResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-muted-foreground">All results filtered out by your score settings.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Minimum opportunity: {prefs.opportunityScoreMin} · Minimum legitimacy: {prefs.legitimacyScoreMin}
            </p>
          </div>
        )}

        {!resultsLoading && !resultsError && filteredResults.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-3 px-3 w-[70px] font-medium">Score</th>
                  <th className="py-3 px-3 min-w-[180px] font-medium">Business</th>
                  <th className="py-3 px-3 min-w-[140px] font-medium">Industry</th>
                  <th className="py-3 px-3 w-[160px] font-medium">Phone</th>
                  <th className="py-3 px-3 w-[100px] font-medium">Website</th>
                  <th className="py-3 px-3 w-[70px] text-center font-medium">HTTPS</th>
                  <th className="py-3 px-3 w-[70px] text-center font-medium">Mobile</th>
                  <th className="py-3 px-3 w-[70px] text-center font-medium">Ads</th>
                  <th className="py-3 px-3 w-[80px] font-medium">SEO</th>
                  <th className="py-3 px-3 w-[70px] font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((b) => {
                  const a = b.analysis;
                  const isSaved = fbStore.isLeadSaved(b.id);
                  return (
                    <tr
                      key={b.id}
                      className="border-b border-border/50 hover:bg-muted/30 group transition-colors cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
                        setSelectedBusiness(b);
                      }}
                    >
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 ${isSaved ? "text-primary bg-primary/10" : ""}`}
                          onClick={() => isSaved ? fbStore.removeLead(b.id) : fbStore.saveLead(b)}
                        >
                          {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
  }

  // ── SEARCH LIST VIEW ──
  return (
    <div className="p-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Search History</h1>
            <p className="text-sm text-muted-foreground">{savedSearches.length} saved searches</p>
          </div>
          {savedSearches.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllSearches} className="text-muted-foreground">
              <X className="h-4 w-4 mr-1" /> Clear All
            </Button>
          )}
        </div>
      </motion.div>

      {savedSearches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clock className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium mb-1">No search history yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Your searches will appear here automatically. Try searching for leads by name, category, or city.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-3 px-3 font-medium">Search</th>
                <th className="py-3 px-3 font-medium w-[100px]">Results</th>
                <th className="py-3 px-3 font-medium w-[120px]">When</th>
                <th className="py-3 px-3 font-medium w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {savedSearches.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-border/50 hover:bg-muted/30 cursor-pointer group transition-colors"
                  onClick={() => restoreSearch(s)}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">{describeSearch(s)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">{s.resultCount} leads</td>
                  <td className="py-3 px-3 text-muted-foreground">{formatDate(s.createdAt)}</td>
                  <td className="py-3 px-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); deleteSearch(s.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SearchHistory;
