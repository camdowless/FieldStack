/**
 * DocumentsTab — upload history and document management for a project.
 *
 * Documents are stored in Firebase Storage under:
 *   companies/{companyId}/documents/{projectId}/{docId}/{fileName}
 *
 * Metadata is persisted in Firestore:
 *   companies/{companyId}/documents/{docId}
 *
 * All writes go through the documentsApi Cloud Function (tenant-protected).
 * Reads come from a real-time Firestore subscription via useDocuments().
 */

import { useRef, useState } from "react";
import { format } from "date-fns";
import { Timestamp } from "firebase/firestore";
import {
  Upload,
  FileText,
  FileImage,
  FileSpreadsheet,
  File,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useDocuments } from "@/hooks/useDocuments";
import { apiUploadDocument, apiDeleteDocument } from "@/lib/fieldstackApi";
import type { ProjectDocument } from "@/types/fieldstack";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"];
const MAX_FILE_SIZE_MB = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmt(ts: Timestamp | undefined | null): string {
  if (!ts) return "—";
  return format(ts.toDate(), "MMM d, yyyy h:mm a");
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-500" />;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv"))
    return <FileSpreadsheet className="h-4 w-4 text-emerald-500" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function mimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.ms-excel": "XLS",
    "text/plain": "TXT",
    "text/csv": "CSV",
    "image/png": "PNG",
    "image/jpeg": "JPG",
    "image/webp": "WEBP",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  };
  return map[mimeType] ?? mimeType.split("/")[1]?.toUpperCase() ?? "FILE";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DocumentsTab({ projectId }: Props) {
  const { documents, loading } = useDocuments(projectId);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // ── Upload ──────────────────────────────────────────────────────────────────

  function validateFile(f: File): string | null {
    const ext = "." + f.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
    }
    if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`;
    }
    return null;
  }

  async function handleFile(f: File) {
    const err = validateFile(f);
    if (err) {
      toast.error(err);
      return;
    }
    setUploading(true);
    try {
      await apiUploadDocument(projectId, f);
      toast.success(`"${f.name}" uploaded successfully.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  }

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(doc: ProjectDocument) {
    setDeletingId(doc.id);
    setConfirmDelete(null);
    try {
      await apiDeleteDocument(doc.id);
      toast.success(`"${doc.fileName}" deleted.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    } finally {
      setDeletingId(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <Card
        className={`border-2 border-dashed transition-colors cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload document"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
      >
        <CardContent className="flex flex-col items-center justify-center py-10 gap-3 select-none">
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium text-muted-foreground">Uploading…</p>
            </>
          ) : (
            <>
              <Upload className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
              <div className="text-center">
                <p className="text-sm font-medium">
                  {dragOver ? "Drop to upload" : "Drag & drop or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, XLSX, CSV, TXT, images, Word docs · max {MAX_FILE_SIZE_MB} MB
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={ALLOWED_EXTENSIONS.join(",")}
        onChange={onFileInputChange}
        aria-hidden="true"
      />

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading documents…</span>
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <FileText className="h-8 w-8 opacity-30" />
          <p className="text-sm">No documents uploaded yet.</p>
          <p className="text-xs opacity-60">Upload schedules, drawings, submittals, or any project file.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-mono px-1">
            {documents.length} document{documents.length !== 1 ? "s" : ""}
          </p>
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              deleting={deletingId === doc.id}
              onDelete={() => setConfirmDelete(doc)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <strong>{confirmDelete?.fileName}</strong> from storage. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── DocumentRow ──────────────────────────────────────────────────────────────

interface DocumentRowProps {
  doc: ProjectDocument;
  deleting: boolean;
  onDelete: () => void;
}

function DocumentRow({ doc, deleting, onDelete }: DocumentRowProps) {
  const isExpired =
    doc.downloadUrlExpiresAt &&
    doc.downloadUrlExpiresAt.toMillis() < Date.now();

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors group">
      {/* Icon */}
      <div className="shrink-0">
        <FileIcon mimeType={doc.mimeType} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate max-w-xs" title={doc.fileName}>
            {doc.fileName}
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono shrink-0">
            {mimeLabel(doc.mimeType)}
          </Badge>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground font-mono">
          <span>{formatBytes(doc.fileSize)}</span>
          <span>·</span>
          <span>{fmt(doc.uploadedAt)}</span>
          {doc.description && (
            <>
              <span>·</span>
              <span className="truncate max-w-[200px]" title={doc.description}>
                {doc.description}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {isExpired ? (
          <span className="flex items-center gap-1 text-xs text-yellow-600">
            <AlertCircle className="h-3.5 w-3.5" />
            Link expired
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            asChild
            aria-label={`Download ${doc.fileName}`}
          >
            <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" download={doc.fileName}>
              <Download className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          disabled={deleting}
          aria-label={`Delete ${doc.fileName}`}
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Upload success indicator (briefly shown) */}
      {!isExpired && doc.downloadUrl && (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 hidden" aria-hidden="true" />
      )}
    </div>
  );
}
