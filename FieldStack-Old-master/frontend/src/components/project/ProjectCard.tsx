import { Link } from "react-router-dom";
import { MapPin, Building2, ChevronRight, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertBadge } from "./AlertBadge";
import type { ProjectSummary } from "@/lib/fieldstackApi";

interface ProjectCardProps {
  project: ProjectSummary;
}

const STATUS_LABELS: Record<ProjectSummary["status"], string> = {
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETE: "Complete",
};

const STATUS_VARIANTS: Record<ProjectSummary["status"], "default" | "secondary" | "outline"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETE: "outline",
};

export function ProjectCard({ project }: ProjectCardProps) {
  const { critical, warning } = project.alertCounts;
  const hasAlerts = critical > 0 || warning > 0;

  return (
    <Link to={`/projects/${project.id}`} className="block group">
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                    {project.name}
                  </h3>
                  <Badge variant={STATUS_VARIANTS[project.status]} className="text-xs shrink-0">
                    {STATUS_LABELS[project.status]}
                  </Badge>
                </div>

                <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{project.address}</span>
                </div>

                <p className="text-xs text-muted-foreground mt-0.5">
                  GC: <span className="text-foreground">{project.gcName}</span>
                </p>
              </div>
            </div>

            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-hover:text-primary transition-colors" />
          </div>

          {/* Alert counts + upload status */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {critical > 0 && <AlertBadge level="CRITICAL" count={critical} />}
            {warning > 0 && <AlertBadge level="WARNING" count={warning} />}
            {!hasAlerts && <AlertBadge level="ON_TRACK" />}

            {project.latestUpload && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Upload className="h-3 w-3" />
                v{project.latestUpload.version}
                {project.latestUpload.status === "PARSING" && " · Parsing…"}
              </span>
            )}
            {!project.latestUpload && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <Upload className="h-3 w-3" />
                No schedule uploaded
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
