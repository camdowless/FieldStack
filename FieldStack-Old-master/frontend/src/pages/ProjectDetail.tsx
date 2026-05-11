import { useParams, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, Building2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useProjectDetail } from "@/hooks/useProjectDetail";
import { OverviewTab } from "@/components/project/OverviewTab";
import { UploadTab } from "@/components/project/UploadTab";
import { OrdersTab } from "@/components/project/OrdersTab";
import { ChangesTab } from "@/components/project/ChangesTab";
import { TasksTab } from "@/components/project/TasksTab";
import { FeedTab } from "@/components/project/FeedTab";

const TABS = ["overview", "upload", "orders", "changes", "tasks", "feed"] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETE: "Complete",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETE: "outline",
};

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get("tab") as Tab) ?? "overview";

  const {
    project,
    projectLoading,
    alerts,
    alertsLoading,
    tasks,
    orderItems,
    scheduleChanges,
    feedEntries,
    scheduleUploads,
    liveLoading,
  } = useProjectDetail(projectId ?? "");

  const handleTabChange = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Project not found.</p>
        <Link to="/projects" className="text-sm text-primary mt-2 inline-block hover:underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  const criticalCount = alerts.filter((a) => a.level === "CRITICAL").length;
  const warningCount = alerts.filter((a) => a.level === "WARNING").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to="/projects"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All projects
      </Link>

      {/* Project header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold tracking-tight">{project.name}</h1>
            <Badge variant={STATUS_VARIANTS[project.status] ?? "outline"}>
              {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{project.address}</p>
          <p className="text-sm text-muted-foreground">
            GC: {project.gcName}
            {project.gcEmail && <> · <a href={`mailto:${project.gcEmail}`} className="hover:underline">{project.gcEmail}</a></>}
          </p>
        </div>

        {/* Alert summary */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {criticalCount > 0 && (
            <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 border border-red-200 px-2 py-0.5 text-xs font-semibold">
              {criticalCount} Critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border border-amber-200 px-2 py-0.5 text-xs font-semibold">
              {warningCount} Warning
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="overview">
            Overview
            {criticalCount + warningCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500 text-white text-xs w-4 h-4 flex items-center justify-center">
                {Math.min(9, criticalCount + warningCount)}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="orders">
            Orders {orderItems.length > 0 && <span className="ml-1 text-muted-foreground text-xs">({orderItems.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="changes">
            Changes {scheduleChanges.length > 0 && <span className="ml-1 text-muted-foreground text-xs">({scheduleChanges.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks {tasks.length > 0 && <span className="ml-1 text-muted-foreground text-xs">({tasks.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="feed">Feed</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab alerts={alerts} loading={alertsLoading} />
        </TabsContent>
        <TabsContent value="upload">
          <UploadTab projectId={project.id} uploads={scheduleUploads} />
        </TabsContent>
        <TabsContent value="orders">
          <OrdersTab orderItems={orderItems} projectId={project.id} />
        </TabsContent>
        <TabsContent value="changes">
          <ChangesTab changes={scheduleChanges} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTab tasks={tasks} />
        </TabsContent>
        <TabsContent value="feed">
          <FeedTab entries={feedEntries} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
