import { useSavedSearches } from "@/hooks/useSavedSearches";
import { Button } from "@/components/ui/button";
import { Trash2, Search, Clock, X, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

const SearchHistory = () => {
  const { searches: savedSearches, loading, deleteSearch, clearAllSearches } = useSavedSearches();
  const navigate = useNavigate();

  const restoreSearch = (search: typeof savedSearches[0]) => {
    const params = new URLSearchParams();
    params.set("restore", search.id);
    navigate(`/?${params.toString()}`);
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

  const describeSearch = (s: typeof savedSearches[0]) => {
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
