import { useState, useCallback, useMemo } from "react";
import { useSavedSearches, type FirestoreSavedSearch } from "@/hooks/useSavedSearches";
import { fetchBusinessesByCids, SearchError } from "@/lib/api";
import { normalizeBusiness } from "@/data/leadTypes";
import { setSearchResults } from "@/lib/businessCache";
import { useFirebaseLeadStore } from "@/hooks/useFirebaseLeadStore";
import { usePreferences } from "@/hooks/usePreferences";
import { ResultsTable } from "@/components/ResultsTable";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCategoryLabel } from "@/data/dfsCategories";
import {
  Trash2, Search, Clock, X, Loader2, ArrowLeft, Coins,
} from "lucide-react";
import { motion } from "framer-motion";
import { Business } from "@/data/mockBusinesses";

const SearchHistory = () => {
  const { searches: savedSearches, loading, deleteSearch, clearAllSearches } = useSavedSearches();
  const fbStore = useFirebaseLeadStore();
  const { prefs } = usePreferences();

  // Inline result viewing state
  const [activeSearch, setActiveSearch] = useState<FirestoreSavedSearch | null>(null);
  const [results, setResults] = useState<Business[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string>("");

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

  const toTitleCase = (s: string) =>
    s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const describeSearch = (s: FirestoreSavedSearch) => {
    const parts: string[] = [];
    if (s.category && s.category !== "businesses") parts.push(formatCategoryLabel(s.category));
    if (s.location) parts.push(toTitleCase(s.location));
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
          <ResultsTable
            results={filteredResults}
            isLeadSaved={(id) => fbStore.isLeadSaved(id)}
            onSaveLead={(b) => fbStore.saveLead(b)}
            onRemoveLead={(id) => fbStore.removeLead(id)}
          />
        )}
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
                <th className="py-3 px-3 font-medium w-[100px]">Credits</th>
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
                  <td className="py-3 px-3">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5 text-muted-foreground w-fit cursor-default" onClick={(e) => e.stopPropagation()}>
                            <Coins className="h-3.5 w-3.5 shrink-0" />
                            <span>1 credit</span>
                          </div>
                        </TooltipTrigger>
                        {s.cost && (
                          <TooltipContent side="right" className="text-xs space-y-1 p-3">
                            <p className="font-medium mb-1">DFS cost breakdown</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                              <span className="text-muted-foreground">Business search</span>
                              <span className="text-right">${s.cost.businessSearch.toFixed(4)}</span>
                              <span className="text-muted-foreground">Instant pages</span>
                              <span className="text-right">${s.cost.instantPages.toFixed(4)}</span>
                              <span className="text-muted-foreground">Lighthouse</span>
                              <span className="text-right">${s.cost.lighthouse.toFixed(4)}</span>
                              <span className="text-muted-foreground">Fresh businesses</span>
                              <span className="text-right">{s.cost.freshBusinesses}</span>
                              <span className="text-muted-foreground">Cached businesses</span>
                              <span className="text-right">{s.cost.cachedBusinesses}</span>
                              <span className="font-medium border-t pt-1">Total DFS</span>
                              <span className="text-right font-medium border-t pt-1">${s.cost.totalDfs.toFixed(4)}</span>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </td>
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
