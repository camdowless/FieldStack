/**
 * ItemsPage - canonical example feature demonstrating the full stack pattern.
 *
 * Shows: auth-gated page, real-time Firestore data, CRUD operations,
 * optimistic UI, error handling, and loading states.
 *
 * Replace this with your product's main feature.
 */

import { useState } from "react";
import { useItems } from "@/hooks/useItems";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Pencil, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import type { Item } from "@/lib/api";

export default function ItemsPage() {
  const { items, loading, error, create, update, remove } = useItems();

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit dialog state
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createTitle.trim()) return;
    setCreating(true);
    try {
      await create({ title: createTitle.trim(), description: createDesc.trim() });
      toast.success("Item created.");
      setShowCreate(false);
      setCreateTitle("");
      setCreateDesc("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create item.");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(item: Item) {
    setEditItem(item);
    setEditTitle(item.title);
    setEditDesc(item.description);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editItem || !editTitle.trim()) return;
    setSaving(true);
    try {
      await update(editItem.id, { title: editTitle.trim(), description: editDesc.trim() });
      toast.success("Item updated.");
      setEditItem(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArchive(item: Item) {
    const newStatus = item.status === "active" ? "archived" : "active";
    try {
      await update(item.id, { status: newStatus });
      toast.success(newStatus === "archived" ? "Item archived." : "Item restored.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update item.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      toast.success("Item deleted.");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete item.");
    } finally {
      setDeleting(false);
    }
  }

  const activeItems = items.filter((i) => i.status === "active");
  const archivedItems = items.filter((i) => i.status === "archived");

  return (
    <div className="p-6 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Items</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your items. This is the canonical example feature.
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New Item
          </Button>
        </div>
      </motion.div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {!loading && !error && items.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-muted-foreground mb-4">No items yet. Create your first one.</p>
            <Button onClick={() => setShowCreate(true)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> Create Item
            </Button>
          </CardContent>
        </Card>
      )}

      {activeItems.length > 0 && (
        <div className="space-y-3 mb-6">
          {activeItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onEdit={openEdit}
              onToggleArchive={handleToggleArchive}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {archivedItems.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Archived ({archivedItems.length})
          </h2>
          <div className="space-y-3 opacity-60">
            {archivedItems.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onEdit={openEdit}
                onToggleArchive={handleToggleArchive}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!creating) setShowCreate(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-title">Title</Label>
              <Input
                id="create-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Item title"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-desc">Description</Label>
              <Textarea
                id="create-desc"
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Optional description"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !createTitle.trim()}>
                {creating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(v) => { if (!saving && !v) setEditItem(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditItem(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !editTitle.trim()}>
                {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!deleting && !v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.title}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemRow({
  item,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  item: Item;
  onEdit: (item: Item) => void;
  onToggleArchive: (item: Item) => void;
  onDelete: (item: Item) => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium truncate">{item.title}</span>
            {item.status === "archived" && (
              <Badge variant="secondary" className="text-xs shrink-0">Archived</Badge>
            )}
          </div>
          {item.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(item)} aria-label="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggleArchive(item)} aria-label={item.status === "active" ? "Archive" : "Restore"}>
            {item.status === "active" ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(item)} aria-label="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
