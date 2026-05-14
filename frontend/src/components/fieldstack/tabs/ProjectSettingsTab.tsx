/**
 * ProjectSettingsTab — edit project details, GC info, Procore integration (stub).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ExternalLink, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiUpdateProject, apiSyncProcore, apiGetProcoreAuthUrl } from "@/lib/fieldstackApi";
import type { Project } from "@/types/fieldstack";

interface Props {
  project: Project;
}

export function ProjectSettingsTab({ project }: Props) {
  const [name, setName] = useState(project.name);
  const [address, setAddress] = useState(project.address);
  const [gcName, setGcName] = useState(project.gcName);
  const [gcContact, setGcContact] = useState(project.gcContact ?? "");
  const [gcEmail, setGcEmail] = useState(project.gcEmail ?? "");
  const [gcPlatform, setGcPlatform] = useState(project.gcPlatform ?? "NONE");
  const [gcProjectUrl, setGcProjectUrl] = useState(project.gcProjectUrl ?? "");
  const [gcProjectUrlError, setGcProjectUrlError] = useState(false);
  const [autoSync, setAutoSync] = useState(project.autoSyncEnabled);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function handleSave() {
    // Validate URL — clear it if it's not a valid http/https URL
    let resolvedUrl: string | null = null;
    if (gcProjectUrl.trim()) {
      try {
        const parsed = new URL(gcProjectUrl.trim());
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          resolvedUrl = parsed.toString();
          setGcProjectUrl(resolvedUrl);
          setGcProjectUrlError(false);
        } else {
          setGcProjectUrl("");
          setGcProjectUrlError(true);
        }
      } catch {
        setGcProjectUrl("");
        setGcProjectUrlError(true);
      }
    } else {
      setGcProjectUrlError(false);
    }

    setSaving(true);
    try {
      await apiUpdateProject(project.id, {
        name: name.trim(),
        address: address.trim(),
        gcName: gcName.trim(),
        gcContact: gcContact.trim() || undefined,
        gcEmail: gcEmail.trim() || undefined,
        gcPlatform: gcPlatform === "NONE" ? undefined : gcPlatform || undefined,
        gcProjectUrl: resolvedUrl,
        autoSyncEnabled: autoSync,
      });
      toast.success("Project settings saved.");
    } catch {
      toast.error("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleProcoreConnect() {
    try {
      const { url } = await apiGetProcoreAuthUrl(project.id);
      window.open(url, "_blank");
    } catch {
      toast.info("Procore integration coming soon.");
    }
  }

  async function handleProcoreSync() {
    setSyncing(true);
    try {
      const result = await apiSyncProcore(project.id);
      toast.success(`Procore sync complete: ${result.tasksCreated} tasks created, ${result.tasksUpdated} updated.`);
    } catch {
      toast.info("Procore sync coming soon.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Project details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Project Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ps-name">Project name</Label>
            <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-address">Address</Label>
            <Input id="ps-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ps-gc">GC name</Label>
              <Input id="ps-gc" value={gcName} onChange={(e) => setGcName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-platform">GC platform</Label>
              <Select value={gcPlatform} onValueChange={setGcPlatform}>
                <SelectTrigger id="ps-platform">
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
            <div className="space-y-1.5">
              <Label htmlFor="ps-contact">GC contact</Label>
              <Input id="ps-contact" value={gcContact} onChange={(e) => setGcContact(e.target.value)} placeholder="John Smith" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps-email">GC email</Label>
              <Input id="ps-email" type="email" value={gcEmail} onChange={(e) => setGcEmail(e.target.value)} placeholder="jsmith@gc.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ps-url">GC project URL</Label>
            <div className="flex gap-2">
              <Input
                id="ps-url"
                type="url"
                value={gcProjectUrl}
                onChange={(e) => { setGcProjectUrl(e.target.value); setGcProjectUrlError(false); }}
                placeholder="https://app.procore.com/projects/12345/schedule"
                className={gcProjectUrlError ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {gcProjectUrl && !gcProjectUrlError && (
                <a
                  href={gcProjectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-9 w-9 shrink-0 rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
                  title="Open in browser"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            {gcProjectUrlError && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                Invalid URL — must start with http:// or https://. Field was cleared.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Procore integration */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Procore Integration</CardTitle>
            <Badge variant="outline" className="text-xs text-muted-foreground">Coming Soon</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Connect to Procore to automatically sync the GC schedule. Tasks will be pulled directly from Procore instead of requiring manual uploads.
          </p>

          {project.procoreAccessToken ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-emerald-600">Connected to Procore</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={autoSync}
                    onCheckedChange={setAutoSync}
                    id="auto-sync"
                  />
                  <Label htmlFor="auto-sync" className="text-sm cursor-pointer">Auto-sync schedule</Label>
                </div>
                <Button size="sm" variant="outline" onClick={handleProcoreSync} disabled={syncing} className="gap-1.5">
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync Now
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={handleProcoreConnect} className="gap-2">
              <ExternalLink className="h-4 w-4" /> Connect Procore
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
