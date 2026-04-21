/**
 * Rate limit stress tester — rendered inside the System Admin page (admin role only).
 * Fires rapid sequential requests to each endpoint and shows status codes inline.
 */
import { useState } from "react";
import { auth } from "@/lib/firebase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Result {
  n: number;
  status: number;
  body: string;
}

async function getToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in");
  return token;
}

async function hitSearch(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ keyword: "plumber", location: "10001", radius: 5, limit: 1 }),
  });
  return { status: res.status, body: JSON.stringify(await res.json().catch(() => ({}))) };
}

async function hitReport(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cid: "test-cid", businessName: "Test Biz", reason: "other" }),
  });
  return { status: res.status, body: JSON.stringify(await res.json().catch(() => ({}))) };
}

async function hitReportOversizedCid(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cid: "x".repeat(51), businessName: "Test Biz", reason: "other" }),
  });
  return { status: res.status, body: JSON.stringify(await res.json().catch(() => ({}))) };
}

async function hitReportOversizedName(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cid: "valid-cid", businessName: "x".repeat(201), reason: "other" }),
  });
  return { status: res.status, body: JSON.stringify(await res.json().catch(() => ({}))) };
}

async function hitBusinesses(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch("/api/businesses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cids: ["1234567890"] }),
  });
  return { status: res.status, body: JSON.stringify(await res.json().catch(() => ({}))) };
}

interface TestConfig {
  label: string;
  description: string;
  count: number;
  fn: (token: string) => Promise<{ status: number; body: string }>;
}

const TESTS: TestConfig[] = [
  { label: "Search", description: "limit: 3/min — fires 5 requests, expect 3 × 200 then 2 × 429", count: 5, fn: hitSearch },
  { label: "Submit Report", description: "limit: 10/min — fires 12 requests, expect 10 × 200 then 2 × 429", count: 12, fn: hitReport },
  { label: "Get Businesses by CIDs", description: "limit: 30/min — fires 32 requests, expect 30 × 200 then 2 × 429", count: 32, fn: hitBusinesses },
  { label: "Report: oversized cid (51 chars)", description: "cid > 50 chars — expect 400", count: 1, fn: hitReportOversizedCid },
  { label: "Report: oversized businessName (201 chars)", description: "businessName > 200 chars — expect 400", count: 1, fn: hitReportOversizedName },
];

function StatusBadge({ status }: { status: number }) {
  const cls =
    status === 429 ? "bg-amber-500/15 text-amber-600 border-amber-500/30" :
    status >= 200 && status < 300 ? "bg-green-500/15 text-green-600 border-green-500/30" :
    "bg-red-500/15 text-red-600 border-red-500/30";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-mono font-semibold ${cls}`}>
      {status}
    </span>
  );
}

export function DevRateLimitTester() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [activeTest, setActiveTest] = useState<TestConfig | null>(null);

  const run = async (test: TestConfig) => {
    setResults([]);
    setActiveTest(test);
    setRunning(true);

    let token: string;
    try {
      token = await getToken();
    } catch (e) {
      alert((e as Error).message);
      setRunning(false);
      return;
    }

    for (let i = 1; i <= test.count; i++) {
      const r = await test.fn(token);
      setResults((prev) => [...prev, { n: i, ...r }]);
    }
    setRunning(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Rate Limit Tester</CardTitle>
        <CardDescription>Fire rapid requests to verify per-user Firestore-backed rate limits are enforced correctly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          {TESTS.map((t) => (
            <div key={t.label} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={running}
                onClick={() => run(t)}
                className="shrink-0"
              >
                {running && activeTest?.label === t.label ? "Firing…" : `Fire ${t.count}`}
              </Button>
            </div>
          ))}
        </div>

        {(results.length > 0 || running) && (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">{activeTest?.label} results</p>
            <div className="max-h-56 overflow-y-auto flex flex-col gap-1 font-mono text-xs">
              {results.map((r) => (
                <div key={r.n} className="flex items-start gap-2">
                  <span className="text-muted-foreground w-5 text-right shrink-0">#{r.n}</span>
                  <StatusBadge status={r.status} />
                  <span className="text-muted-foreground truncate">{r.body}</span>
                </div>
              ))}
              {running && <span className="text-muted-foreground animate-pulse">firing…</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
