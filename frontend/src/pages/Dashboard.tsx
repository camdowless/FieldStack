import { useState, useMemo } from "react";
import { useLeadStore, SavedLead } from "@/hooks/useLeadStore";
import { LeadStatus } from "@/data/mockBusinesses";
import { LeadScoreBadge } from "@/components/LeadScoreBadge";
import { generateFixActionItems } from "@/data/actionItems";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Search, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

const statusConfig: Record<LeadStatus, { label: string }> = {
  new: { label: "New" },
  contacted: { label: "Contacted" },
  "follow-up": { label: "Follow Up" },
  "not-interested": { label: "Not Interested" },
  "closed-won": { label: "Closed / Won" },
};

const allStatuses: LeadStatus[] = ["new", "contacted", "follow-up", "not-interested", "closed-won"];

const Dashboard = () => {
  const store = useLeadStore();
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let leads = store.savedLeads;
    if (filterStatus !== "all") leads = leads.filter((l) => l.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter((l) => l.business.name.toLowerCase().includes(q) || l.business.category.toLowerCase().includes(q));
    }
    return leads;
  }, [store.savedLeads, filterStatus, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: store.savedLeads.length };
    allStatuses.forEach((s) => { counts[s] = store.savedLeads.filter((l) => l.status === s).length; });
    return counts;
  }, [store.savedLeads]);

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
        {allStatuses.map((s) => (
          <Button key={s} variant={filterStatus === s ? "secondary" : "ghost"} size="sm" onClick={() => setFilterStatus(s)}>
            {statusConfig[s].label} ({statusCounts[s] || 0})
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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((lead) => (
                  <TableRow
                    key={lead.business.id}
                    className="cursor-pointer"
                    onClick={(e) => {
                      // Don't navigate if clicking on interactive elements
                      if ((e.target as HTMLElement).closest('button, select, [role="combobox"], [role="listbox"]')) return;
                      navigate(`/lead/${lead.business.id}`);
                    }}
                  >
                    <TableCell>
                      <span className="font-medium">{lead.business.name}</span>
                      <div className="text-xs text-muted-foreground">{lead.business.category} • {lead.business.city}, {lead.business.state}</div>
                      {(() => {
                        const items = generateFixActionItems(lead.business);
                        const total = items.length;
                        if (total === 0) return null;
                        const done = (lead.completedActions ?? []).filter((id) => items.some((i) => i.id === id)).length;
                        return <div className="text-xs text-muted-foreground mt-0.5">{done} / {total} actions done</div>;
                      })()}
                    </TableCell>
                    <TableCell><LeadScoreBadge score={lead.business.leadScore} size="sm" /></TableCell>
                    <TableCell>
                      <Select value={lead.status} onValueChange={(v) => store.updateStatus(lead.business.id, v as LeadStatus)}>
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allStatuses.map((s) => <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); store.removeLead(lead.business.id); }}>
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
    </div>
  );
};

export default Dashboard;
