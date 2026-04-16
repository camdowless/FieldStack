import { useState, useMemo } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import type { PlaceResult, AnalyzedResult } from "./types";
import * as XLSX from "xlsx";

const FUNCTION_URL = import.meta.env.VITE_FUNCTIONS_URL || "";

type SortField = "leadScore" | "zipCode" | "name" | "types" | "summary" | "address" | "phone" | "website";
type SortDir = "asc" | "desc";

function ScoreBadge({ score, isExcluded }: { score: number; isExcluded: boolean }) {
  if (isExcluded) return <span className="score-badge excluded">—</span>;
  const cls = score >= 60 ? "hot" : score >= 30 ? "warm" : "cold";
  return <span className={`score-badge ${cls}`}>{score}</span>;
}

function Flag({ value, trueLabel, falseLabel, nullLabel = "?" }: {
  value: boolean | null;
  trueLabel: string;
  falseLabel: string;
  nullLabel?: string;
}) {
  if (value === null) return <span className="flag neutral">{nullLabel}</span>;
  return <span className={`flag ${value ? "good" : "bad"}`}>{value ? trueLabel : falseLabel}</span>;
}

export default function Dashboard() {
  const [zipInput, setZipInput] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [analyzed, setAnalyzed] = useState<AnalyzedResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [error, setError] = useState("");
  const [filterText, setFilterText] = useState("");
  const [hideExcluded, setHideExcluded] = useState(true);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const isAnalyzed = analyzed.length > 0;
  const displayResults: (PlaceResult | AnalyzedResult)[] = isAnalyzed ? analyzed : results;

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "leadScore" ? "desc" : "asc");
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return <span className="sort-icon muted">⇅</span>;
    return <span className="sort-icon active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setAnalyzed([]);

    const zipCodes = zipInput
      .split(/[,\s]+/)
      .map((z) => z.trim())
      .filter((z) => /^\d{5}$/.test(z));

    if (zipCodes.length === 0) {
      setError("Enter at least one valid 5-digit zip code");
      return;
    }

    setLoading(true);
    setLoadingStatus(`Searching ${zipCodes.length} zip code${zipCodes.length > 1 ? "s" : ""}...`);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${FUNCTION_URL}/searchPlaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ zipCodes, businessType: businessType.trim() || undefined, maxPages: 10 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Search failed");
      }

      const data = await res.json();
      setResults(data.results);
      setSortField("name");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  };

  const handleAnalyze = async () => {
    if (results.length === 0) return;
    setError("");
    setAnalyzing(true);
    setLoadingStatus(`Analyzing ${results.length} businesses — checking websites, Wayback Machine...`);

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${FUNCTION_URL}/analyzeLeads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ places: results }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Analysis failed");
      }

      const data = await res.json();
      setAnalyzed(data.results);
      setSortField("leadScore");
      setSortDir("desc");
      setCurrentPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
      setLoadingStatus("");
    }
  };

  const filteredAndSorted = useMemo(() => {
    let list = displayResults as AnalyzedResult[];

    if (hideExcluded && isAnalyzed) {
      list = list.filter((r) => !r.analysis?.isExcluded);
    }

    if (filterText) {
      const lower = filterText.toLowerCase();
      list = list.filter((r) =>
        r.name.toLowerCase().includes(lower) ||
        r.address.toLowerCase().includes(lower) ||
        r.phone.includes(lower) ||
        r.types.join(" ").toLowerCase().includes(lower) ||
        r.summary.toLowerCase().includes(lower) ||
        r.website.toLowerCase().includes(lower) ||
        r.zipCode.includes(lower)
      );
    }

    return [...list].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === "leadScore") {
        aVal = a.analysis?.leadScore ?? -1;
        bVal = b.analysis?.leadScore ?? -1;
        return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
      }

      if (sortField === "types") {
        aVal = a.types.join(", ").toLowerCase();
        bVal = b.types.join(", ").toLowerCase();
      } else {
        aVal = (((a as unknown) as Record<string, string>)[sortField] || "").toLowerCase();
        bVal = (((b as unknown) as Record<string, string>)[sortField] || "").toLowerCase();
      }
      const cmp = (aVal as string).localeCompare(bVal as string);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [displayResults, filterText, sortField, sortDir, hideExcluded, isAnalyzed]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedResults = filteredAndSorted.slice(startIndex, startIndex + pageSize);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const getPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safeCurrentPage > 3) pages.push("...");
      const start = Math.max(2, safeCurrentPage - 1);
      const end = Math.min(totalPages - 1, safeCurrentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (safeCurrentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  const exportToExcel = () => {
    const rows = filteredAndSorted.map((r) => {
      const a = (r as AnalyzedResult).analysis;
      return {
        "Zip Code": r.zipCode,
        "Business Name": r.name,
        "Type": r.types.join(", ").replace(/_/g, " "),
        "Summary": r.summary,
        "Address": r.address,
        "Phone": r.phone,
        "Website": r.website,
        "Lead Score": a?.leadScore ?? "",
        "Score Reasons": a?.scoreReasons.join(" | ") ?? "",
        "Excluded": a?.isExcluded ? "Yes" : "No",
        "Exclude Reason": a?.excludeReason ?? "",
        "HTTPS": a == null || a.isHttps === null ? "" : a.isHttps ? "Yes" : "No",
        "Mobile Friendly": a == null || a.isMobileFriendly === null ? "" : a.isMobileFriendly ? "Yes" : "No",
        "Copyright Year": a?.copyrightYear ?? "",
        "Last Wayback Crawl": a?.lastWaybackSeen ?? "",
        "Never Crawled": a == null || a.neverCrawled === null ? "" : a.neverCrawled ? "Yes" : "No",
        "Has Google Ads Tag": a?.hasGoogleAds == null ? "" : a.hasGoogleAds ? "Yes" : "No",
        "Currently Open": r.openNow === null ? "Unknown" : r.openNow ? "Yes" : "No",
        "Hours": r.weekdayHours.join(" | "),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key as keyof typeof r] || "").length).slice(0, 50)),
    }));
    ws["!cols"] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, `leads_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="dashboard">
      <header>
        <h1>Lead Finder</h1>
        <button onClick={() => signOut(auth)} className="sign-out">Sign Out</button>
      </header>

      <form onSubmit={handleSearch} className="search-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="zipCodes">Zip Codes (comma or space separated)</label>
            <input
              id="zipCodes"
              type="text"
              placeholder="90210, 10001, 60601"
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="businessType">Business Type (optional)</label>
            <input
              id="businessType"
              type="text"
              placeholder="e.g. restaurants, dentists, plumbers"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading || analyzing} className="search-btn">
            {loading ? <span>Searching<span className="loading-dots" /></span> : "Search"}
          </button>
        </div>
        {(loading || analyzing) && loadingStatus && (
          <p className="loading-status"><span className="spinner sm" />{loadingStatus}</p>
        )}
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {results.length > 0 && (
        <div className="results-header">
          <div className="results-meta">
            <span>{filteredAndSorted.length} of {displayResults.length} results</span>
            {!isAnalyzed && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="analyze-btn"
              >
                {analyzing
                  ? <span><span className="spinner sm" /> Analyzing<span className="loading-dots" /></span>
                  : `Analyze ${results.length} Leads`}
              </button>
            )}
            {isAnalyzed && (
              <span className="analyzed-badge">✓ Analyzed</span>
            )}
            <button onClick={exportToExcel} className="export-btn">
              Download Excel
            </button>
          </div>
          <div className="filter-row">
            {isAnalyzed && (
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={hideExcluded}
                  onChange={(e) => { setHideExcluded(e.target.checked); setCurrentPage(1); }}
                />
                Hide excluded
              </label>
            )}
            <div className="search-input-wrapper">
              <span className="search-icon" aria-hidden="true">🔍</span>
              <input
                type="text"
                placeholder="Search all results..."
                value={filterText}
                onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }}
                aria-label="Search results"
              />
            </div>
          </div>
        </div>
      )}

      <div className="results-table-wrapper">
        {filteredAndSorted.length > 0 && (
          <table className="results-table">
            <thead>
              <tr>
                {isAnalyzed && (
                  <th onClick={() => handleSort("leadScore")} className="sortable">Score {sortIndicator("leadScore")}</th>
                )}
                <th onClick={() => handleSort("zipCode")} className="sortable">Zip {sortIndicator("zipCode")}</th>
                <th onClick={() => handleSort("name")} className="sortable">Name {sortIndicator("name")}</th>
                <th onClick={() => handleSort("types")} className="sortable">Type {sortIndicator("types")}</th>
                <th onClick={() => handleSort("address")} className="sortable">Address {sortIndicator("address")}</th>
                <th onClick={() => handleSort("phone")} className="sortable">Phone {sortIndicator("phone")}</th>
                <th onClick={() => handleSort("website")} className="sortable">Website {sortIndicator("website")}</th>
                {isAnalyzed && (
                  <>
                    <th>HTTPS</th>
                    <th>Mobile</th>
                    <th>Ads</th>
                    <th>Last Crawled</th>
                    <th>Signals</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedResults.map((r, i) => {
                const ar = r as AnalyzedResult;
                const a = ar.analysis;
                return (
                  <tr key={`${r.name}-${r.address}-${startIndex + i}`} className={a?.isExcluded ? "row-excluded" : ""}>
                    {isAnalyzed && (
                      <td>
                        <ScoreBadge score={a?.leadScore ?? 0} isExcluded={a?.isExcluded ?? false} />
                      </td>
                    )}
                    <td>{r.zipCode}</td>
                    <td>{r.name}</td>
                    <td className="type-cell">{r.types.join(", ").replace(/_/g, " ")}</td>
                    <td>{r.address}</td>
                    <td>{r.phone || "—"}</td>
                    <td>
                      {r.website ? (
                        <a href={r.website} target="_blank" rel="noopener noreferrer">Link</a>
                      ) : <span className="no-website">None</span>}
                    </td>
                    {isAnalyzed && (
                      <>
                        <td><Flag value={a?.isHttps ?? null} trueLabel="✓" falseLabel="✗" /></td>
                        <td><Flag value={a?.isMobileFriendly ?? null} trueLabel="✓" falseLabel="✗" /></td>
                        <td>
                          {a == null || a.hasGoogleAds === null
                            ? <span className="flag neutral">?</span>
                            : a.hasGoogleAds
                              ? <span className="flag ads">Ads</span>
                              : <span className="flag neutral">—</span>}
                        </td>
                        <td className="wayback-cell">
                          {a?.neverCrawled
                            ? <span className="flag bad">Never</span>
                            : a?.lastWaybackSeen
                              ? <span className={(a.waybackAgeYears ?? 0) > 2 ? "flag bad" : "flag neutral"}>
                                  {a.lastWaybackSeen}
                                </span>
                              : "—"}
                        </td>
                        <td className="reasons-cell" title={a?.scoreReasons.join("\n")}>
                          {a?.isExcluded
                            ? <span className="excluded-reason">{a.excludeReason}</span>
                            : (a?.scoreReasons.length ?? 0) > 0
                              ? <span className="reasons-preview">{a!.scoreReasons.length} signal{a!.scoreReasons.length !== 1 ? "s" : ""}</span>
                              : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {filteredAndSorted.length > 0 && (
        <div className="pagination">
          <div className="pagination-info">
            Showing {startIndex + 1}–{Math.min(startIndex + pageSize, filteredAndSorted.length)} of {filteredAndSorted.length}
          </div>
          <div className="pagination-controls">
            <button className="page-btn" onClick={() => setCurrentPage(1)} disabled={safeCurrentPage === 1} aria-label="First page">«</button>
            <button className="page-btn" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} aria-label="Previous page">‹</button>
            {getPageNumbers().map((page, idx) =>
              page === "..." ? (
                <span key={`ellipsis-${idx}`} className="page-ellipsis">…</span>
              ) : (
                <button
                  key={page}
                  className={`page-btn ${safeCurrentPage === page ? "active" : ""}`}
                  onClick={() => setCurrentPage(page)}
                  aria-label={`Page ${page}`}
                  aria-current={safeCurrentPage === page ? "page" : undefined}
                >
                  {page}
                </button>
              )
            )}
            <button className="page-btn" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} aria-label="Next page">›</button>
            <button className="page-btn" onClick={() => setCurrentPage(totalPages)} disabled={safeCurrentPage === totalPages} aria-label="Last page">»</button>
          </div>
          <div className="page-size-select">
            <label htmlFor="pageSize">Rows:</label>
            <select id="pageSize" value={pageSize} onChange={(e) => handlePageSizeChange(Number(e.target.value))}>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
