/**
 * TeamPage — manage team members and notification preferences.
 */

import { useState } from "react";
import { useTeam } from "@/hooks/useTeam";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { apiCreateTeamMember, apiUpdateTeamMember, apiDeleteTeamMember } from "@/lib/fieldstackApi";
import type { TeamMember, TeamRole } from "@/types/fieldstack";
import { TEAM_ROLE_LABELS } from "@/types/fieldstack";

const ROLES: TeamRole[] = ["OWNER", "SUPERVISOR", "PURCHASING", "INSTALLER", "DRAFTING"];

export default function TeamPage() {
  const { team, loading } = useTeam();
  const [showAdd, setShowAdd] = useState(false);
  const [editMember, setEditMember] = useState<TeamMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDeleteTeamMember(deleteTarget.id);
      toast.success("Team member removed.");
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to remove team member.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage team members and notification preferences.</p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Member
          </Button>
        </div>
      </motion.div>

      {loading && (
        <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading team...
        </div>
      )}

      {!loading && team.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground mb-4">No team members yet.</p>
            <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> Add First Member
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && team.length > 0 && (
        <div className="flex flex-col gap-3">
          {team.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex items-start justify-between gap-4 py-4 px-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{m.name}</span>
                    <Badge variant="outline" className="text-xs">{TEAM_ROLE_LABELS[m.role]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{m.email}</div>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className={m.notifyOnCritical ? "text-emerald-600" : ""}>
                      {m.notifyOnCritical ? "✓" : "✗"} Critical alerts
                    </span>
                    <span className={m.notifyOnOrderReminder ? "text-emerald-600" : ""}>
                      {m.notifyOnOrderReminder ? "✓" : "✗"} Order reminders
                    </span>
                    <span className={m.notifyOnScheduleChange ? "text-emerald-600" : ""}>
                      {m.notifyOnScheduleChange ? "✓" : "✗"} Schedule changes
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditMember(m)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(m)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddMemberDialog open={showAdd} onOpenChange={setShowAdd} />
      {editMember && <EditMemberDialog member={editMember} onClose={() => setEditMember(null)} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!deleting && !v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{deleteTarget?.name}</strong> from the team. They will no longer receive notifications.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("SUPERVISOR");
  const [notifyCritical, setNotifyCritical] = useState(true);
  const [notifyOrder, setNotifyOrder] = useState(true);
  const [notifyChange, setNotifyChange] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiCreateTeamMember({
        name: name.trim(),
        email: email.trim(),
        role,
        notifyOnCritical: notifyCritical,
        notifyOnOrderReminder: notifyOrder,
        notifyOnScheduleChange: notifyChange,
      });
      toast.success("Team member added.");
      onOpenChange(false);
      setName(""); setEmail(""); setRole("SUPERVISOR");
    } catch {
      toast.error("Failed to add team member.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{TEAM_ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" required />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Notifications</Label>
            {[
              { label: "Critical alerts", value: notifyCritical, set: setNotifyCritical },
              { label: "Order reminders", value: notifyOrder, set: setNotifyOrder },
              { label: "Schedule changes", value: notifyChange, set: setNotifyChange },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm">{label}</span>
                <Switch checked={value} onCheckedChange={set} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !name.trim() || !email.trim()}>
              {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Add Member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ member, onClose }: { member: TeamMember; onClose: () => void }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<TeamRole>(member.role);
  const [notifyCritical, setNotifyCritical] = useState(member.notifyOnCritical);
  const [notifyOrder, setNotifyOrder] = useState(member.notifyOnOrderReminder);
  const [notifyChange, setNotifyChange] = useState(member.notifyOnScheduleChange);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiUpdateTeamMember(member.id, {
        name: name.trim(),
        role,
        notifyOnCritical: notifyCritical,
        notifyOnOrderReminder: notifyOrder,
        notifyOnScheduleChange: notifyChange,
      });
      toast.success("Team member updated.");
      onClose();
    } catch {
      toast.error("Failed to update team member.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!loading && !v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Team Member</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{TEAM_ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Notifications</Label>
            {[
              { label: "Critical alerts", value: notifyCritical, set: setNotifyCritical },
              { label: "Order reminders", value: notifyOrder, set: setNotifyOrder },
              { label: "Schedule changes", value: notifyChange, set: setNotifyChange },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm">{label}</span>
                <Switch checked={value} onCheckedChange={set} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
