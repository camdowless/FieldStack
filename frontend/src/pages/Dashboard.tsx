import { useState, useMemo } from "react";
import { useFirebaseLeadStore, SavedLeadDoc, LEAD_STATUSES } from "@/hooks/useFirebaseLeadStore";
import { LeadStatus } from "@/data/mockBusinesses";
import { LeadScoreBadge } from "@/components/LeadScoreBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router-dom";
import { Search, Trash2, Loader2, StickyNote } from "lucide-react";
import { motion } from "framer-motion";
import { LeadDetailSheet } from "@/components/LeadDetailSheet";

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

const Dashboard = () => {
  const store = useFirebaseLeadStore();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedCid, setSelectedCid] = useState<string | null>(null);

  // Sorted by savedAt desc (already from Firestore query), then filtered
  const filtered = useMemo(() => {
    let leads = store.savedLeads;
    if (filterStatus !== "all") leads = leads.filter((l) => l.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(
        (l) =>
          l.businessName.toLowerCase().includes(q) ||
          l.category.toLowerCase().includes(q) ||
          l.city.toLowerCase().includes(q),
      );
    }
    return leads;
  }, [store.savedLeads, filterStatus, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: store.savedLeads.length };
    LEAD_STATUSES.forEach((s) => {
      counts[s.value] = store.savedLeads.filter((l) => l.status === s.value).length;
    });
    return counts;
  }, [store.savedLeads]);

  if (store.loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold mb-1">Saved Leads</h1>
        <p className="text-sm text-muted-foreground mb-6">Track and manage your saved leads.</p>
      </motion.div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant={filterStatus === "all" ? "secondary" : "ghost"} size="sm" onClick={() => setFilterStatus("all")}>
          All ({statusCounts.all})
        </Button>
        {LEAD_STATUSES.map((s) => (
          <Button key={s.value} variant={filterStatus === s.value ? "secondary" : "ghost"} size="sm" onClick={() => setFilterStatus(s.value)}>
            {s.label} ({statusCounts[s.value] || 0})
          </Button>
        ))}
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Filter saved leads..." className="pl-10 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {store.savedLeads.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">No saved leads yet. Search and save leads to track them here.</p>
          <Link to="/"><Button className="gradient-bg text-white">Go to Search</Button></Link>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">No leads match your filters.</p>
        </Card>
      ) : (
        <Card className="card-glow overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((lead) => (
                  <TableRow
                    key={lead.cid}
                    className="cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, select, [role="combobox"], [role="listbox"]')) return;
                      setSelectedCid(lead.cid);
                    }}
                  >
                    <TableCell>
                      <span className="font-medium">{lead.businessName}</span>
                      <div className="text-xs text-muted-foreground">
                        {lead.category.split("/")[0].trim()} • {[lead.city, lead.state].filter(Boolean).join(", ")}
                      </div>
                    </TableCell>
                    <TableCell><LeadScoreBadge score={lead.leadScore} size="sm" /></TableCell>
                    <TableCell>
                      <Select
                        value={lead.status}
                        onValueChange={(v) => store.updateStatus(lead.cid, v as LeadStatus)}
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
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {lead.notes ? (
                        <span className="text-xs text-muted-foreground truncate block">
                          <StickyNote className="h-3 w-3 inline mr-1" />
                          {lead.notes.slice(0, 60)}{lead.notes.length > 60 ? "…" : ""}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {relativeDate(lead.savedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); store.removeLead(lead.cid); }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Detail sheet — hydrates full business from cache/API */}
      <LeadDetailSheet cid={selectedCid} onClose={() => setSelectedCid(null)} />
    </div>
  );
};

export default Dashboard;
