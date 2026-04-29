import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCreateProject } from "@/hooks/useProjects";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [gcName, setGcName] = useState("");
  const [gcEmail, setGcEmail] = useState("");
  const { mutateAsync, isPending } = useCreateProject();
  const { toast } = useToast();
  const navigate = useNavigate();

  const reset = () => { setName(""); setAddress(""); setGcName(""); setGcEmail(""); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !gcName.trim()) return;
    try {
      const { id } = await mutateAsync({
        name: name.trim(),
        address: address.trim(),
        gcName: gcName.trim(),
        gcEmail: gcEmail.trim() || undefined,
      });
      toast({ title: "Project created", description: name.trim() });
      reset();
      onOpenChange(false);
      navigate(`/projects/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      toast({ title: "Failed to create project", description: msg, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isPending) { reset(); onOpenChange(v); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-name">Project name *</Label>
            <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sunset Condos – Phase 2" disabled={isPending} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-addr">Address *</Label>
            <Input id="proj-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Austin TX" disabled={isPending} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-gc">GC name *</Label>
            <Input id="proj-gc" value={gcName} onChange={(e) => setGcName(e.target.value)} placeholder="Acme Construction" disabled={isPending} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="proj-gc-email">GC email</Label>
            <Input id="proj-gc-email" type="email" value={gcEmail} onChange={(e) => setGcEmail(e.target.value)} placeholder="pm@acmeconstruction.com" disabled={isPending} />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim() || !address.trim() || !gcName.trim()}>
              {isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Creating…</> : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
