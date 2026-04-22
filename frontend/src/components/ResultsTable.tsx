import { Business } from "@/data/mockBusinesses";
import { LeadScoreBadge } from "./LeadScoreBadge";
import { StatusChip, deriveSiteStatus, type SiteStatus } from "./StatusChip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bookmark, BookmarkCheck, ExternalLink, Lock, Smartphone, Megaphone,
  ArrowUp, ArrowDown, Star, Search, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LeadDetailPanel } from "./LeadDetailPanel";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

function cleanCategory(raw: string): string {
  if (!raw) return raw;
  return raw.split("/")[0].trim() || raw;
}

type SortDir = "asc" | "desc";
const DEFAULT_SORT_COL = "score";
const DEFAULT_SORT_DIR: SortDir = "desc";

const STATUS_FILTER_OPTIONS: { value: SiteStatus; label: string }[] = [
  { value: "no website", label: "No Website" },
  { value: "dead site", label: "Dead Site" },
  { value: "active", label: "Active" },
];

interface SelectionProps {
  selectedIds: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAll: (filtered: Business[]) => void;
}

interface ResultsTableProps {
  results: Business[];
  isLeadSaved: (id: string) => boolean;
  onSaveLead: (business: Business) => void;
  onRemoveLead: (id: string) => void;
  /** If provided, renders checkbox column with bulk select */
  selection?: SelectionProps;
  /** If provided, uses external detail panel state instead of internal */
  onSelectBusiness?: (business: Business) => void;
  /** Called whenever filtered count changes so parent can display it */
  onFilteredCountChange?: (count: number) => void;
  /** When true, shows a running progress indicator and animates new rows */
  isLoading?: boolean;
}

export function ResultsTable({
  results,
  isLeadSaved,
  onSaveLead,
  onRemoveLead,
  selection,
  onSelectBusiness,
  onFilteredCountChange,
  isLoading = false,
}: ResultsTableProps) {
  const [internalSelected, setInternalSelected] = useState<Business | null>(null);
  const selectedBusiness = onSelectBusiness ? null : internalSelected;
  const handleSelectBusiness = onSelectBusiness ?? setInternalSelected;

  // Track which row IDs have already been seen so we only animate new arrivals
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isLoading) {
      // Reset when a new search starts
      seenIdsRef.current = new Set();
      setNewIds(new Set());
      return;
    }
    const incoming = results.map((b) => b.id).filter((id) => !seenIdsRef.current.has(id));
    if (incoming.length > 0) {
      incoming.forEach((id) => seenIdsRef.current.add(id));
      setNewIds((prev) => {
        const next = new Set(prev);
        incoming.forEach((id) => next.add(id));
        return next;
      });
      // Clear the "new" flag after animation completes
      const timer = setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          incoming.forEach((id) => next.delete(id));
          return next;
        });
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [results, isLoading]);

  // Filter + sort state (owned by this component)
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<SiteStatus>>(new Set());
  const [minReviews, setMinReviews] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<string>(DEFAULT_SORT_COL);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);

  const filteredResults = useMemo(() => {
    let out = [...results];

    if (statusFilter.size > 0) {
      out = out.filter((b) => statusFilter.has(deriveSiteStatus(b.label)));
    }
    if (minReviews > 0) {
      out = out.filter((b) => b.reviewCount >= minReviews);
    }
    if (minRating > 0) {
      out = out.filter((b) => b.googleRating >= minRating);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      out = out.filter(
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
    out.sort((a, b) => {
      const an = a.analysis;
      const bn = b.analysis;
      switch (sortBy) {
        case "score": return cmp(a.leadScore, b.leadScore);
        case "name": return cmp(a.name, b.name);
        case "industry": return cmp(a.category, b.category);
        case "reviews": return cmp(a.reviewCount, b.reviewCount);
        case "seo": return cmp(an.hasWebsite ? an.seoScore : -1, bn.hasWebsite ? bn.seoScore : -1);
        default: return 0;
      }
    });

    return out;
  }, [results, statusFilter, minReviews, minRating, searchQuery, sortBy, sortDir]);

  // Notify parent of filtered count
  useMemo(() => {
    onFilteredCountChange?.(filteredResults.length);
  }, [filteredResults.length, onFilteredCountChange]);

  // Status counts from filtered results (post-filter for review/rating/name, but pre-status-filter)
  const statusCounts = useMemo(() => {
    // Count statuses from results filtered by everything EXCEPT status filter
    let base = [...results];
    if (minReviews > 0) base = base.filter((b) => b.reviewCount >= minReviews);
    if (minRating > 0) base = base.filter((b) => b.googleRating >= minRating);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      base = base.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q) ||
          (b.city || "").toLowerCase().includes(q),
      );
    }
    const counts = new Map<SiteStatus, number>();
    for (const b of base) {
      const s = deriveSiteStatus(b.label);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  }, [results, minReviews, minRating, searchQuery]);

  const toggleSort = (col: string) => {
    if (sortBy !== col) {
      setSortBy(col);
      setSortDir(col === "name" || col === "industry" ? "asc" : "desc");
      return;
    }
    if (sortDir === "desc") {
      setSortDir("asc");
    } else {
      setSortBy(DEFAULT_SORT_COL);
      setSortDir(DEFAULT_SORT_DIR);
    }
  };

  const colCount = 8 + (selection ? 1 : 0);

  const allVisibleSelected = filteredResults.length > 0 && filteredResults.every((b) => selection?.selectedIds.has(b.id));
  const someVisibleSelected = filteredResults.some((b) => selection?.selectedIds.has(b.id));

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

  const hasActiveFilters = statusFilter.size > 0 || minReviews > 0 || minRating > 0 || searchQuery.length > 0;

  return (
    <>
      {/* Running indicator */}
      {isLoading && (
        <div className="relative h-1 w-full rounded-full bg-muted overflow-hidden mb-4">
          <motion.div
            className="absolute inset-y-0 left-0 bg-primary rounded-full"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            style={{ width: "40%" }}
          />
        </div>
      )}

      {/* Filter toolbar */}
      <div className="flex flex-col gap-2 mb-4">
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
        {statusCounts.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTER_OPTIONS.map((l) => {
              const count = statusCounts.get(l.value) ?? 0;
              if (count === 0) return null;
              const active = statusFilter.has(l.value);
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setStatusFilter((prev) => {
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
                  <span className={`${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
                </button>
              );
            })}
            {statusFilter.size > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(new Set())}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Min reviews
            <Input
              type="number"
              min={0}
              className="w-20 h-7 text-xs"
              value={minReviews || ""}
              placeholder="0"
              onChange={(e) => setMinReviews(Number(e.target.value) || 0)}
            />
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Min rating
            <select
              className="h-7 px-2 rounded-md border border-input bg-background text-xs"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
            >
              <option value={0}>Any</option>
              <option value={1}>1+</option>
              <option value={2}>2+</option>
              <option value={3}>3+</option>
              <option value={4}>4+</option>
              <option value={4.5}>4.5+</option>
            </select>
          </label>
          {(minReviews > 0 || minRating > 0) && (
            <button
              type="button"
              onClick={() => { setMinReviews(0); setMinRating(0); }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              {selection && (
                <th className="py-3 px-3 w-[40px]">
                  <Checkbox
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={() => selection.onToggleAll(filteredResults)}
                    aria-label="Select all"
                  />
                </th>
              )}
              <SortHeader col="score" className="w-[60px]">Score</SortHeader>
              <th className="py-3 px-3 font-medium w-[100px]">Status</th>
              <SortHeader col="name" className="min-w-[180px]">Business</SortHeader>
              <SortHeader col="industry" className="min-w-[140px]">Industry</SortHeader>
              <SortHeader col="reviews" className="w-[100px]">Reviews</SortHeader>
              <th className="py-3 px-3 font-medium w-[120px] text-center">Web Health</th>
              <SortHeader col="seo" className="w-[80px]">SEO</SortHeader>
              <th className="py-3 px-3 font-medium w-[70px]"></th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-muted-foreground">
                  {hasActiveFilters ? "No leads match your filters." : "No leads found. Try a different category or location."}
                </td>
              </tr>
            )}
            <AnimatePresence initial={false}>
              {filteredResults.map((b) => {
                const a = b.analysis;
                const isSaved = isLeadSaved(b.id);
                const status = deriveSiteStatus(b.label);
                const checked = selection?.selectedIds.has(b.id) ?? false;
                const isNew = newIds.has(b.id);
                return (
                  <motion.tr
                    key={b.id}
                    layout
                    initial={isNew ? { opacity: 0, y: -8 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="border-b border-border/50 hover:bg-muted/30 group transition-colors cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return;
                      handleSelectBusiness(b);
                    }}
                  >
                  {selection && (
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => selection.onToggleOne(b.id)}
                        aria-label={`Select ${b.name}`}
                      />
                    </td>
                  )}
                  <td className="py-3 px-3">
                    <LeadScoreBadge score={b.leadScore} size="sm" />
                  </td>
                  <td className="py-3 px-3">
                    <StatusChip status={status} />
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
                  <td className="py-3 px-3 text-muted-foreground">
                    {b.reviewCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                        <span className="font-medium text-foreground">{b.googleRating}</span>
                        <span className="opacity-60">({b.reviewCount})</span>
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {a.hasWebsite ? (
                      <div className="flex items-center justify-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center justify-center h-5 w-5 rounded ${a.hasHttps ? "text-green-500" : "text-red-500"}`}>
                              <Lock className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{a.hasHttps ? "HTTPS" : "No HTTPS"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center justify-center h-5 w-5 rounded ${a.mobileFriendly ? "text-green-500" : "text-red-500"}`}>
                              <Smartphone className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{a.mobileFriendly ? "Mobile-friendly" : "Not mobile-friendly"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center justify-center h-5 w-5 rounded ${a.hasOnlineAds ? "text-green-500" : "text-red-500"}`}>
                              <Megaphone className="h-3.5 w-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{a.hasOnlineAds ? "Running ads" : "No ads"}</TooltipContent>
                        </Tooltip>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-center block">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    {a.hasWebsite && a.seoScore > 0 ? (
                      <span className={`font-medium ${a.seoScore >= 70 ? "text-green-500" : a.seoScore >= 40 ? "text-yellow-500" : "text-red-500"}`}>
                        {a.seoScore}/100
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-7 w-7 ${isSaved ? "text-primary bg-primary/10" : ""}`}
                        onClick={() => isSaved ? onRemoveLead(b.id) : onSaveLead(b)}
                      >
                        {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleSelectBusiness(b)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {/* Internal detail sheet — only rendered when no external handler */}
      {!onSelectBusiness && (
        <Sheet open={!!selectedBusiness} onOpenChange={(open) => { if (!open) setInternalSelected(null); }}>
          <SheetContent side="right" className="p-0 sm:max-w-3xl w-full">
            <SheetHeader className="sr-only">
              <SheetTitle>{selectedBusiness?.name ?? "Lead Detail"}</SheetTitle>
              <SheetDescription>Detailed analysis for this business lead</SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-full">
              <div className="p-6">
                {selectedBusiness && <LeadDetailPanel business={selectedBusiness} onUpdate={setInternalSelected} />}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
