import { useState } from "react";
import { Plus, FolderOpen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/project/ProjectCard";
import { NewProjectDialog } from "@/components/project/NewProjectDialog";
import { useProjects } from "@/hooks/useProjects";

export default function Projects() {
  const [showNewProject, setShowNewProject] = useState(false);
  const { data: projects, isLoading, isError, error } = useProjects();

  const allProjects = projects ?? [];
  const totalCritical = allProjects.reduce((s, p) => s + p.alertCounts.critical, 0);
  const totalWarning  = allProjects.reduce((s, p) => s + p.alertCounts.warning, 0);
  const active        = allProjects.filter((p) => p.status === "ACTIVE").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track schedules, orders, and alerts across all your projects.
          </p>
        </div>
        <Button onClick={() => setShowNewProject(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {/* Stats row */}
      {allProjects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Active projects" value={active} />
          <StatCard label="Total projects" value={allProjects.length} />
          <StatCard label="Critical alerts" value={totalCritical} highlight={totalCritical > 0 ? "red" : undefined} />
          <StatCard label="Warning alerts" value={totalWarning} highlight={totalWarning > 0 ? "amber" : undefined} />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Failed to load projects."}
          </p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && allProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <FolderOpen className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">No projects yet</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Create your first project to start tracking schedules, orders, and alerts.
            </p>
          </div>
          <Button onClick={() => setShowNewProject(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create first project
          </Button>
        </div>
      )}

      {/* Project list */}
      {!isLoading && !isError && allProjects.length > 0 && (
        <div className="flex flex-col gap-3">
          {allProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <NewProjectDialog open={showNewProject} onOpenChange={setShowNewProject} />
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "red" | "amber";
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${
        highlight === "red" ? "text-red-600 dark:text-red-400" :
        highlight === "amber" ? "text-amber-600 dark:text-amber-400" :
        "text-foreground"
      }`}>
        {value}
      </p>
    </div>
  );
}
