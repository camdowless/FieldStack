/**
 * ProjectDetail — full project page with tabs:
 * Overview | Feed | Workflow | Timeline | Orders | Upload | Changes | Settings
 */

import { useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useProjectData } from "@/hooks/useProjectData";
import { useTeam } from "@/hooks/useTeam";
import { useScheduleJobs } from "@/contexts/ScheduleJobContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, CheckCircle2, PauseCircle, Trash2, Bot } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
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
import { apiUpdateProject, apiDeleteProject, apiSendAlerts } from "@/lib/fieldstackApi";
import { alertColor, alertVariant } from "@/lib/alerts";
import type { Alert, Task, OrderItem, ScheduleChange, TaskStep, FeedEntry } from "@/types/fieldstack";
import { ITEM_TYPE_LABELS, ORDER_STATUS_LABELS, STEP_TYPE_LABELS, FEED_TYPE_LABELS } from "@/types/fieldstack";
import { OverviewTab } from "@/components/fieldstack/tabs/OverviewTab";
import { FeedTab } from "@/components/fieldstack/tabs/FeedTab";
import { WorkflowTab } from "@/components/fieldstack/tabs/WorkflowTab";
import { TimelineTab } from "@/components/fieldstack/tabs/TimelineTab";
import { OrdersTab } from "@/components/fieldstack/tabs/OrdersTab";
import { UploadTab } from "@/components/fieldstack/tabs/UploadTab";
import { ChangesTab } from "@/components/fieldstack/tabs/ChangesTab";
import { ProjectSettingsTab } from "@/components/fieldstack/tabs/ProjectSettingsTab";
import { DocumentsTab } from "@/components/fieldstack/tabs/DocumentsTab";

const TABS = ["Overview", "Feed", "Workflow", "Timeline", "Orders", "Upload", "Documents", "Changes", "Settings"] as const;
type Tab = typeof TABS[number];

function fmt(ts: Timestamp | undefined | null) {
  if (!ts) return "—";
  return format(ts.toDate(), "MMM d, yyyy");
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, tasks, orderItems, changes, steps, feed, alerts, loading, ourTasks, criticalAlerts, warningAlerts } = useProjectData(id);
  const { team } = useTeam();
  const { startJob, isAnalyzing, jobs, dismissJob } = useScheduleJobs();
  const [tab, setTab] = useState<Tab>("Overview");
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pageDragOver, setPageDragOver] = useState(false);
  const dragCounter = useRef(0);

  // Derive upload state from the global job context
  const job = id ? jobs[id] : undefined;
  const uploading = !!job && job.status === "running";
  const uploadResult = job?.status === "done" ? (job.result ?? null) : null;
  const uploadError = job?.status === "error" ? (job.error ?? "") : "";

  async function handleFileDrop(f: File) {
    if (!id || !project) return;
    await startJob(id, project.name, f);
  }

  function onPageDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setPageDragOver(true);
  }
  function onPageDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setPageDragOver(false);
  }
  function onPageDragOver(e: React.DragEvent) { e.preventDefault(); }
  function onPageDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setPageDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileDrop(f);
  }

  async function handleArchive() {
    if (!project || !id) return;
    setArchiving(true);
    const newStatus = project.status === "ACTIVE" ? "ON_HOLD" : "ACTIVE";
    try {
      await apiUpdateProject(id, { status: newStatus });
      toast.success(newStatus === "ON_HOLD" ? "Project put on hold." : "Project reactivated.");
    } catch (err) {
      toast.error("Failed to update project status.");
    } finally {
      setArchiving(false);
    }
  }

  async function handleComplete() {
    if (!id) return;
    try {
      await apiUpdateProject(id, { status: "COMPLETE" });
      toast.success("Project marked complete.");
    } catch (err) {
      toast.error("Failed to update project.");
    }
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      await apiDeleteProject(id);
      toast.success("Project deleted.");
      navigate("/");
    } catch (err) {
      toast.error("Failed to delete project.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading project...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 text-muted-foreground">
        Project not found.{" "}
        <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div
      className="p-6 relative min-h-full"
      onDragEnter={onPageDragEnter}
      onDragLeave={onPageDragLeave}
      onDragOver={onPageDragOver}
      onDrop={onPageDrop}
    >
      {/* Drop overlay */}
      {pageDragOver && (
        <div className="fixed inset-0 z-50 bg-background/90 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-primary rounded-2xl px-20 py-16 text-center bg-primary/5">
            <div className="text-5xl mb-4 opacity-60">📄</div>
            <div className="text-lg font-semibold text-primary mb-2">Drop your schedule</div>
            <div className="text-sm text-muted-foreground">PDF, XLSX, or plain text lookahead</div>
          </div>
        </div>
      )}

      {/* Upload toast is rendered globally by ScheduleJobToast in App.tsx */}

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono mb-3 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> All Projects
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {project.name}
            </h1>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {project.address} · GC: {project.gcName}
              {project.gcContact ? ` · ${project.gcContact}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {project.status === "ACTIVE" && (
              <Button size="sm" variant="outline" className="gap-1.5 text-emerald-600 border-emerald-400/40 hover:bg-emerald-50 dark:hover:bg-emerald-950" onClick={handleComplete}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark Complete
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleArchive} disabled={archiving} className="gap-1.5">
              <PauseCircle className="h-3.5 w-3.5" />
              {project.status === "ON_HOLD" ? "Reactivate" : "Hold"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-5 flex-wrap h-auto gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t} className="relative">
              {t}
              {t === "Overview" && criticalAlerts.length > 0 && (
                <span className="ml-1.5 bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                  {criticalAlerts.length}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="Overview">
          <OverviewTab
            alerts={alerts}
            criticalAlerts={criticalAlerts}
            warningAlerts={warningAlerts}
            ourTasks={ourTasks}
            changes={changes}
            projectId={id!}
            team={team}
            hasTasks={tasks.length > 0}
            onFilePicked={handleFileDrop}
            uploading={uploading}
          />
        </TabsContent>

        <TabsContent value="Feed">
          <FeedTab projectId={id!} feed={feed} />
        </TabsContent>

        <TabsContent value="Workflow">
          <WorkflowTab projectId={id!} steps={steps} team={team} />
        </TabsContent>

        <TabsContent value="Timeline">
          <TimelineTab tasks={tasks} />
        </TabsContent>

        <TabsContent value="Orders">
          <OrdersTab tasks={tasks} orderItems={orderItems} />
        </TabsContent>

        <TabsContent value="Upload">
          <UploadTab
            onFile={handleFileDrop}
            uploading={uploading}
            result={uploadResult}
            error={uploadError}
            onClearResult={() => id && dismissJob(id)}
            onClearError={() => id && dismissJob(id)}
          />
        </TabsContent>

        <TabsContent value="Changes">
          <ChangesTab changes={changes} />
        </TabsContent>

        <TabsContent value="Documents">
          <DocumentsTab projectId={id!} />
        </TabsContent>

        <TabsContent value="Settings">
          <ProjectSettingsTab project={project} />
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={(v) => { if (!deleting) setShowDelete(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{project.name}</strong> and all its tasks, orders, and workflow data. This cannot be undone.
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
              Delete Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
