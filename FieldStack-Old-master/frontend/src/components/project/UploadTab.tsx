import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle2, XCircle, Loader2, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getStorage, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { triggerScheduleParse } from "@/lib/fieldstackApi";
import type { ScheduleUploadDoc } from "@/hooks/useProjectDetail";

const ACCEPTED = ".pdf,.xlsx,.xls,.csv,.txt";

interface UploadTabProps {
  projectId: string;
  uploads: ScheduleUploadDoc[];
}

const STATUS_ICONS = {
  DONE: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  FAILED: <XCircle className="h-4 w-4 text-red-500" />,
  PARSING: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  PENDING: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
};

export function UploadTab({ projectId, uploads }: UploadTabProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleFile = async (file: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "xlsx", "xls", "csv", "txt"].includes(ext)) {
      toast({ title: "Unsupported file type", description: "Upload a PDF, XLSX, CSV, or TXT file.", variant: "destructive" });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 50 MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Step 1: Upload to Firebase Storage
      const storage = getStorage();
      const path = `schedules/${projectId}/${Date.now()}_${file.name}`;
      const fileRef = storageRef(storage, path);
      const uploadTask = uploadBytesResumable(fileRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            setUploadProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 80));
          },
          reject,
          resolve
        );
      });

      setUploadProgress(85);
      setUploading(false);
      setParsing(true);

      // Step 2: Trigger Cloud Function to parse
      const result = await triggerScheduleParse(projectId, path, file.name);
      setUploadProgress(100);

      toast({
        title: "Schedule parsed",
        description: `${result.tasksCreated} tasks, ${result.orderItemsCreated} order items created.`,
      });

      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploading(false);
      setParsing(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const isProcessing = uploading || parsing;

  return (
    <div className="py-2 flex flex-col gap-4">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="relative rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors p-8 flex flex-col items-center justify-center gap-3 text-center cursor-pointer"
        onClick={() => !isProcessing && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          disabled={isProcessing}
        />

        {isProcessing ? (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">
              {uploading ? "Uploading…" : "Parsing with AI…"}
            </p>
            <Progress value={uploadProgress} className="w-full max-w-xs" />
            <p className="text-xs text-muted-foreground">
              {parsing ? "Claude is extracting tasks and order items from your schedule." : ""}
            </p>
          </>
        ) : (
          <>
            <CloudUpload className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Drop your schedule here</p>
              <p className="text-xs text-muted-foreground mt-0.5">PDF, XLSX, CSV, or TXT · Max 50 MB</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
              <Upload className="h-3.5 w-3.5" />
              Browse files
            </Button>
          </>
        )}
      </div>

      {/* Upload history */}
      {uploads.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upload history</h3>
          <div className="flex flex-col gap-1.5">
            {uploads.map((upload) => {
              const uploadedAt = new Date(upload.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
              return (
                <div key={upload.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{upload.fileName}</p>
                    <p className="text-xs text-muted-foreground">v{upload.version} · {uploadedAt}</p>
                    {upload.parseResult && (
                      <p className="text-xs text-muted-foreground">
                        {upload.parseResult.tasksCreated} tasks · {upload.parseResult.orderItemsCreated} orders
                      </p>
                    )}
                    {upload.errorMessage && (
                      <p className="text-xs text-red-500">{upload.errorMessage}</p>
                    )}
                  </div>
                  {STATUS_ICONS[upload.status] ?? null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
