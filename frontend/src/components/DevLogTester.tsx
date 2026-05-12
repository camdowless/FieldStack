/**
 * Logging pipeline tester — rendered inside the System Admin page (admin role only).
 * Provides targeted triggers to verify each part of the structured logging system:
 * - Frontend error reporter (unhandled error, promise rejection, manual report)
 * - ErrorBoundary crash
 * - Backend reportFrontendError endpoint (direct POST)
 *
 * After triggering, check Cloud Logging (or emulator logs) for structured JSON entries.
 */
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { reportError } from "@/lib/errorReporter";
import { functionsBaseUrl } from "@/lib/firebase";
import { Terminal, Zap, AlertTriangle, Bug, Send } from "lucide-react";

// ─── Result log ──────────────────────────────────────────────────────────────

interface LogLine {
  id: number;
  label: string;
  status: "ok" | "error" | "pending";
  detail: string;
}

let lineId = 0;

// ─── Crash component (for ErrorBoundary test) ─────────────────────────────────

function CrashBomb() {
  // Throws synchronously on render — caught by the nearest ErrorBoundary
  throw new Error("[DevLogTester] Intentional ErrorBoundary crash test");
}

// ─── Trigger functions ────────────────────────────────────────────────────────

/** Throws an unhandled error via setTimeout so it bypasses React's error boundary
 *  and hits the window 'error' listener registered by initErrorReporter. */
function triggerUnhandledError() {
  setTimeout(() => {
    throw new Error("[DevLogTester] Intentional unhandled window error");
  }, 0);
}

/** Rejects a promise without a catch handler — hits window 'unhandledrejection'. */
function triggerUnhandledRejection() {
  void Promise.reject(new Error("[DevLogTester] Intentional unhandled promise rejection"));
}

/** Calls reportError directly — the same path ErrorBoundary uses. */
function triggerManualReport() {
  const err = new Error("[DevLogTester] Manual reportError() call");
  reportError(err);
}

/** POSTs directly to the reportFrontendError Cloud Function endpoint. */
async function triggerDirectPost(): Promise<{ status: number; body: string }> {
  const payload = {
    message: "[DevLogTester] Direct POST to reportFrontendError endpoint",
    stack: new Error().stack ?? null,
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };
  const res = await fetch(`${functionsBaseUrl}/reportFrontendError`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: res.status === 204 ? "(204 No Content)" : await res.text() };
}

/** POSTs a malformed payload (no message) — should get 204 + WARNING log. */
async function triggerMalformedPost(): Promise<{ status: number; body: string }> {
  const res = await fetch(`${functionsBaseUrl}/reportFrontendError`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stack: "no message field here", url: window.location.href }),
  });
  return { status: res.status, body: res.status === 204 ? "(204 No Content — WARNING logged)" : await res.text() };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DevLogTester() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [crashBomb, setCrashBomb] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  // Reset crash bomb after it fires so the button can be used again
  useEffect(() => {
    if (crashBomb) {
      const t = setTimeout(() => setCrashBomb(false), 500);
      return () => clearTimeout(t);
    }
  }, [crashBomb]);

  function addLine(label: string, status: LogLine["status"], detail: string) {
    setLines((prev) => [{ id: lineId++, label, status, detail }, ...prev].slice(0, 30));
  }

  async function run(label: string, fn: () => void | Promise<{ status: number; body: string }>) {
    setRunning(label);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "status" in result) {
        const ok = result.status >= 200 && result.status < 300;
        addLine(label, ok ? "ok" : "error", `HTTP ${result.status} — ${result.body}`);
      } else {
        addLine(label, "ok", "Triggered — check Cloud Logging for the structured entry");
      }
    } catch (err) {
      addLine(label, "error", err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  }

  const triggers = [
    {
      group: "Frontend Error Reporter (window listeners)",
      icon: <Zap className="h-4 w-4" />,
      items: [
        {
          label: "Unhandled window error",
          description: "Throws via setTimeout — hits window 'error' listener",
          action: () => run("Unhandled window error", () => { triggerUnhandledError(); }),
        },
        {
          label: "Unhandled promise rejection",
          description: "Rejects without .catch() — hits window 'unhandledrejection'",
          action: () => run("Unhandled promise rejection", () => { triggerUnhandledRejection(); }),
        },
        {
          label: "Manual reportError()",
          description: "Calls reportError() directly — same path as ErrorBoundary",
          action: () => run("Manual reportError()", () => { triggerManualReport(); }),
        },
      ],
    },
    {
      group: "Backend Endpoint (direct POST)",
      icon: <Send className="h-4 w-4" />,
      items: [
        {
          label: "Valid error report",
          description: "POST to /api/report-error — expect 204 + ERROR log in Cloud Logging",
          action: () => run("Valid error report", triggerDirectPost),
        },
        {
          label: "Malformed payload (no message)",
          description: "POST without message field — expect 204 + WARNING log",
          action: () => run("Malformed payload", triggerMalformedPost),
        },
      ],
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Logging Pipeline Tester</CardTitle>
        </div>
        <CardDescription>
          Trigger each part of the structured logging system and verify entries appear in Cloud Logging.
          After firing, filter by <code className="text-xs bg-muted px-1 py-0.5 rounded">DevLogTester</code> in the log explorer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {triggers.map((group, gi) => (
          <div key={gi} className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.icon}
              {group.group}
            </div>
            <div className="space-y-2">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={running !== null}
                    onClick={item.action}
                    className="shrink-0"
                  >
                    {running === item.label ? "Firing…" : "Fire"}
                  </Button>
                </div>
              ))}
            </div>
            {gi < triggers.length - 1 && <Separator />}
          </div>
        ))}

        {/* ErrorBoundary crash — separate section with a warning */}
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Bug className="h-4 w-4" />
            ErrorBoundary
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Trigger ErrorBoundary crash</p>
              <p className="text-xs text-muted-foreground">
                Renders a component that throws — caught by ErrorBoundary, reported via componentDidCatch.
                The page will show the error UI; click "Try again" to recover.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={running !== null || crashBomb}
              onClick={() => {
                addLine("ErrorBoundary crash", "ok", "Crash triggered — check Cloud Logging + ErrorBoundary UI");
                setCrashBomb(true);
              }}
              className="shrink-0"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Crash
            </Button>
          </div>
          {/* Render the crash bomb outside the card so it hits the app-level ErrorBoundary */}
          {crashBomb && <CrashBomb />}
        </div>

        {/* Result log */}
        {lines.length > 0 && (
          <>
            <Separator />
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Results (most recent first)</p>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1 font-mono text-xs">
                {lines.map((line) => (
                  <div key={line.id} className="flex items-start gap-2">
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs ${
                        line.status === "ok"
                          ? "border-green-500/30 text-green-600 bg-green-500/10"
                          : line.status === "error"
                          ? "border-red-500/30 text-red-600 bg-red-500/10"
                          : "border-amber-500/30 text-amber-600 bg-amber-500/10"
                      }`}
                    >
                      {line.status === "ok" ? "✓" : line.status === "error" ? "✗" : "…"}
                    </Badge>
                    <span className="text-muted-foreground shrink-0">{line.label}</span>
                    <span className="text-muted-foreground/70 truncate">{line.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
