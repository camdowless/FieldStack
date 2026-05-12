import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiCreateProject } from "@/lib/fieldstackApi";
import { useNavigate } from "react-router-dom";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [gcName, setGcName] = useState("");
  const [gcContact, setGcContact] = useState("");
  const [gcEmail, setGcEmail] = useState("");
  const [gcPlatform, setGcPlatform] = useState<string>("NONE");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !gcName.trim()) return;
    setLoading(true);
    try {
      const result = await apiCreateProject({
        name: name.trim(),
        address: address.trim(),
        gcName: gcName.trim(),
        gcContact: gcContact.trim() || undefined,
        gcEmail: gcEmail.trim() || undefined,
        gcPlatform: gcPlatform === "NONE" ? undefined : gcPlatform || undefined,
      });
      toast.success("Project created!");
      onOpenChange(false);
      navigate(`/projects/${result.id}`);
      // Reset
      setName(""); setAddress(""); setGcName(""); setGcContact(""); setGcEmail(""); setGcPlatform("NONE");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Project name *</Label>
            <Input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lexington Apartments" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-address">Address *</Label>
            <Input id="proj-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Springfield, IL" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proj-gc">GC name *</Label>
              <Input id="proj-gc" value={gcName} onChange={(e) => setGcName(e.target.value)} placeholder="Turner Construction" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-platform">GC platform</Label>
              <Select value={gcPlatform} onValueChange={setGcPlatform}>
                <SelectTrigger id="proj-platform">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  <SelectItem value="PROCORE">Procore</SelectItem>
                  <SelectItem value="BUILDERTREND">Buildertrend</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proj-contact">GC contact</Label>
              <Input id="proj-contact" value={gcContact} onChange={(e) => setGcContact(e.target.value)} placeholder="John Smith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-email">GC email</Label>
              <Input id="proj-email" type="email" value={gcEmail} onChange={(e) => setGcEmail(e.target.value)} placeholder="jsmith@gc.com" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || !name.trim() || !address.trim() || !gcName.trim()}>
              {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
