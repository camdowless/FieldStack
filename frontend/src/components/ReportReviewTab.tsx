import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchAdminReports, updateReportStatus, fetchBusinessesByCids, auditDeadSites } from "@/lib/api";
import type { AdminReportGroup, DeadSiteAuditRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Search, ExternalLink, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Flag, Download } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LeadDetailPanel } from "@/components/LeadDetailPanel";
import { normalizeBusiness } from "@/data/leadTypes";
import type { Business } from "@/data/mockBusinesses";

const PAGE_SIZE = 20;

const REASON_LABELS: Record<string, string> = {
  wrong_ranking: "Mistaken ranking",
  wrong_signal: "Incorrect signal",
  incorrect_info: "Wrong info",
  other: "Other",
};

// ─── Detail sheet ─────────────────────────────────────────────────────────────

function ReportDetailSheet({
  group,
  open,
  onOpenChange,
  onToggle,
}: {
  group: AdminReportGroup | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onToggle: (id: string, status: "open" | "closed") => Promise<void>;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [bizLoading, setBizLoading] = useState(false);

  // Fetch business data whenever the sheet opens with a new group
  useEffect(() => {
    if (!open || !group) { setBusiness(null); return; }
    setBizLoading(true);
    fetchBusinessesByCids([group.cid])
      .then((res) => {
        const biz = res.results[0];
        setBusiness(biz ? normalizeBusiness(biz) : null);
      })
      .catch(() => setBusiness(null))
      .finally(() => setBizLoading(false));
  }, [open, group?.cid]);

  if (!group) return null;

  const handleToggle = async (id: string, next: "open" | "closed") => {
    setLoadingId(id);
    await onToggle(id, next);
    setLoadingId(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-0 sm:max-w-5xl w-full flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>{group.businessName} — Reports</SheetTitle>
          <SheetDescription>Business detail and all reports submitted for this business</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: full business detail */}
          <ScrollArea className="flex-1 min-w-0 border-r">
            <div className="p-6">
              {bizLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
                </div>
              ) : business ? (
                <LeadDetailPanel business={business} onUpdate={setBusiness} />
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <p className="text-sm">Business data not found in cache.</p>
                  <p className="text-xs">CID: {group.cid}</p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Right: report breakdown sidebar */}
          <ScrollArea className="w-72 shrink-0">
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Flag className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Reports</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {group.reportCount} total · {group.openCount} open
                </p>
              </div>

              {/* Reason breakdown */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Breakdown</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(group.reasons).map(([r, count]) => (
                    <span key={r} className="inline-flex items-center gap-1 text-xs rounded-full border px-2.5 py-1 bg-muted/50">
                      {REASON_LABELS[r] ?? r}
                      <span className="text-muted-foreground font-medium">×{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Individual reports */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Individual</p>
                <div className="space-y-2">
                  {group.reports.map((r) => {
                    const next = r.status === "open" ? "closed" : "open";
                    return (
                      <div key={r.id} className="rounded-md border p-3 space-y-1.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{REASON_LABELS[r.reason] ?? r.reason}</span>
                          <span className={r.status === "open" ? "text-red-500" : "text-muted-foreground"}>
                            {r.status}
                          </span>
                        </div>
                        {r.details && (
                          <p className="text-muted-foreground leading-relaxed">{r.details}</p>
                        )}
                        <p className="text-muted-foreground">
                          {r.uid}
                          {r.createdAt && <> · {new Date(r.createdAt).toLocaleDateString()}</>}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-7 text-xs"
                          onClick={() => handleToggle(r.id, next)}
                          disabled={loadingId === r.id}
                        >
                          {loadingId === r.id
                            ? <RefreshCw className="h-3 w-3 animate-spin" />
                            : next === "closed" ? "Close report" : "Reopen"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

type SortCol = "businessName" | "reportCount" | "openCount" | "latestAt";
type SortDir = "asc" | "desc";

export function ReportReviewTab() {
  const [groups, setGroups] = useState<AdminReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("latestAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminReportGroup | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checkedCids, setCheckedCids] = useState<Set<string>>(new Set());
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<{ rows: DeadSiteAuditRow[]; cost: number; csvBlob: Blob; filename: string } | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const csvUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminReports(statusFilter);
      setGroups(data.groups);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (reportId: string, status: "open" | "closed") => {
    try {
      await updateReportStatus(reportId, status);
      setGroups((prev) =>
        prev.map((g) => {
          const reports = g.reports.map((r) => r.id === reportId ? { ...r, status } : r);
          const openCount = reports.filter((r) => r.status === "open").length;
          return { ...g, reports, openCount };
        })
      );
      // Keep selected in sync
      setSelected((prev) => {
        if (!prev) return prev;
        const reports = prev.reports.map((r) => r.id === reportId ? { ...r, status } : r);
        return { ...prev, reports, openCount: reports.filter((r) => r.status === "open").length };
      });
    } catch (err) {
      toast({ title: "Failed to update report", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleAudit = async () => {
    const cids = Array.from(checkedCids);
    if (cids.length === 0) return;
    setAuditing(true);
    setAuditResult(null);
    setAuditError(null);
    if (csvUrlRef.current) { URL.revokeObjectURL(csvUrlRef.current); csvUrlRef.current = null; }
    try {
      const { rows, cost } = await auditDeadSites(cids);
      const headers = ["cid", "name", "url", "label", "deathStage", "fetchFailed", "statusCode", "headErrorCode", "dfsTaskStatusCode", "pageTitle", "totalDomSize", "wordCount"];
      const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [
        headers.join(","),
        ...rows.map((r) => headers.map((h) => escape(r[h as keyof typeof r])).join(",")),
      ].join("\n");
      const csvBlob = new Blob([csv], { type: "text/csv" });
      const filename = `dead-site-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      setAuditResult({ rows, cost, csvBlob, filename });
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed — unknown error");
    } finally {
      setAuditing(false);
    }
  };

  const handleDownload = () => {
    if (!auditResult) return;
    if (csvUrlRef.current) URL.revokeObjectURL(csvUrlRef.current);
    const url = URL.createObjectURL(auditResult.csvBlob);
    csvUrlRef.current = url;
    const a = document.createElement("a");
    a.href = url;
    a.download = auditResult.filename;
    a.click();
  };

  const toggleCheck = (cid: string) => {
    setCheckedCids((prev) => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedCids.size === paginated.length) {
      setCheckedCids(new Set());
    } else {
      setCheckedCids(new Set(paginated.map((g) => g.cid)));
    }
  };

  const toggleSort = (col: SortCol) => {    if (sortCol === col) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "businessName" ? "asc" : "desc");
    }
    setPage(1);
  };

  const filtered = useMemo(() => {
    let out = [...groups];
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((g) => g.businessName.toLowerCase().includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      switch (sortCol) {
        case "businessName": return dir * a.businessName.localeCompare(b.businessName);
        case "reportCount": return dir * (a.reportCount - b.reportCount);
        case "openCount": return dir * (a.openCount - b.openCount);
        case "latestAt": return dir * ((a.latestAt ?? 0) - (b.latestAt ?? 0));
      }
    });
    return out;
  }, [groups, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const SortHeader = ({ col, children, className = "" }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <th
      className={`py-3 px-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors text-left ${className}`}
      onClick={() => toggleSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortCol === col && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by business name…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[100px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {checkedCids.size > 0 && (
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={handleAudit} disabled={auditing}>
            {auditing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {auditing ? `Auditing…` : `Audit ${checkedCids.size} site${checkedCids.size !== 1 ? "s" : ""}`}
          </Button>
        )}
        {!loading && (
          <span className="text-sm text-muted-foreground ml-1">
            {filtered.length} business{filtered.length !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      {/* Audit result banner */}
      {auditError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-destructive">{auditError}</p>
          <Button size="sm" variant="ghost" className="h-7 text-muted-foreground shrink-0" onClick={() => setAuditError(null)}>Dismiss</Button>
        </div>
      )}
      {auditResult && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 min-w-0">
            <p className="text-sm font-medium">
              Audit complete — {auditResult.rows.length} URL{auditResult.rows.length !== 1 ? "s" : ""} · DFS cost ${auditResult.cost.toFixed(4)}
            </p>
            {/* Stage distribution */}
            <div className="flex flex-wrap gap-1.5">
              {(() => {
                const counts: Record<string, number> = {};
                for (const r of auditResult.rows) {
                  const stage = r.deathStage || (r.label === "dead site" ? "UNKNOWN" : r.label);
                  counts[stage] = (counts[stage] ?? 0) + 1;
                }
                return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([stage, n]) => (
                  <span key={stage} className="inline-flex items-center gap-1 text-xs rounded-full border px-2.5 py-0.5 bg-background font-mono">
                    {stage || "live"}<span className="text-muted-foreground">×{n}</span>
                  </span>
                ));
              })()}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => setAuditResult(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive py-6">{error}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground bg-muted/30">
                  <th className="py-3 px-3 w-[40px]">
                    <Checkbox
                      checked={paginated.length > 0 && checkedCids.size === paginated.length}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <SortHeader col="businessName" className="min-w-[200px]">Business</SortHeader>
                  <th className="py-3 px-3 font-medium text-left min-w-[180px]">Reasons</th>
                  <SortHeader col="reportCount" className="w-[90px]">Reports</SortHeader>
                  <SortHeader col="openCount" className="w-[80px]">Open</SortHeader>
                  <SortHeader col="latestAt" className="w-[120px]">Latest</SortHeader>
                  <th className="py-3 px-3 w-[60px]" />                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No reports found.
                    </td>
                  </tr>
                )}
                {paginated.map((g) => (
                  <tr
                    key={g.cid}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer group"
                    onClick={() => { setSelected(g); setSheetOpen(true); }}
                  >
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checkedCids.has(g.cid)}
                        onCheckedChange={() => toggleCheck(g.cid)}
                        aria-label={`Select ${g.businessName}`}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-medium block truncate max-w-[240px]">{g.businessName}</span>
                      {g.websiteUrl && (
                        <span className="text-xs text-muted-foreground truncate block max-w-[240px]">{g.websiteUrl}</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(g.reasons).map(([r, count]) => (
                          <span key={r} className="text-xs text-muted-foreground border rounded-full px-2 py-0.5 bg-muted/40">
                            {REASON_LABELS[r] ?? r}{count > 1 ? ` ×${count}` : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-muted-foreground tabular-nums">{g.reportCount}</td>
                    <td className="py-3 px-3 tabular-nums">
                      {g.openCount > 0
                        ? <span className="text-red-500 font-medium">{g.openCount}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="py-3 px-3 text-muted-foreground text-xs">
                      {g.latestAt ? new Date(g.latestAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); setSelected(g); setSheetOpen(true); }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage((p) => p + 1)} disabled={page === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ReportDetailSheet
        group={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onToggle={handleToggle}
      />
    </div>
  );
}
