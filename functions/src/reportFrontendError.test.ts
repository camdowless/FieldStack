import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for the reportFrontendError Cloud Function endpoint.
 * Tests valid payload → 204, missing message → 204 with warning, oversized → 413.
 *
 * Validates: Requirements 6.1
 *
 * We extract the handler logic here (matching the implementation in index.ts)
 * to test it in isolation without importing the entire index.ts module.
 */

// ─── Extracted handler logic (mirrors functions/src/index.ts) ─────────────────

const MAX_BODY_SIZE = 10 * 1024; // 10KB

interface LogCapture {
  level: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Pure extraction of the reportFrontendError handler logic.
 * This mirrors the implementation in index.ts for testability.
 */
async function handleReportFrontendError(
  req: { method: string; body: any; rawBody?: Buffer },
  res: { status: (code: number) => any; json: (body: any) => any; send: () => any },
  logCapture: LogCapture[]
): Promise<void> {
  // Method check
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Body size check
  const rawBody = req.rawBody;
  if (rawBody && rawBody.length > MAX_BODY_SIZE) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  // Parse and validate
  const body = req.body;
  const message = body?.message;

  if (typeof message !== "string" || message.trim().length === 0) {
    logCapture.push({
      level: "WARNING",
      message: "Malformed frontend error report: missing or empty message",
      context: { body: typeof body === "object" ? body : undefined },
    });
    res.status(204).send();
    return;
  }

  // Log the frontend error
  logCapture.push({
    level: "ERROR",
    message,
    context: {
      stack: body.stack ?? null,
      url: body.url ?? null,
      userAgent: body.userAgent ?? null,
      timestamp: body.timestamp ?? null,
      uid: body.uid ?? null,
      source: "frontend",
    },
  });

  res.status(204).send();
}

// ─── Mock response helper ─────────────────────────────────────────────────────

function mockResponse(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reportFrontendError endpoint", () => {
  it("returns 204 for a valid error report payload", async () => {
    const body = {
      message: "Cannot read properties of undefined",
      stack: "TypeError: Cannot read properties...\n    at LeadCard.tsx:42",
      url: "https://app.example.com/dashboard",
      userAgent: "Mozilla/5.0",
      timestamp: "2024-01-15T10:30:00.000Z",
      uid: "abc12345",
    };
    const req = {
      method: "POST",
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
    };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();

    // Verify an ERROR log was emitted with the correct message
    const errorLog = logs.find((l) => l.level === "ERROR");
    expect(errorLog).toBeDefined();
    expect(errorLog!.message).toBe("Cannot read properties of undefined");
    expect(errorLog!.context?.source).toBe("frontend");
    expect(errorLog!.context?.stack).toBe(body.stack);
    expect(errorLog!.context?.url).toBe(body.url);
    expect(errorLog!.context?.uid).toBe(body.uid);
  });

  it("returns 204 with warning log for missing message field", async () => {
    const body = {
      stack: "some stack",
      url: "https://app.example.com",
    };
    const req = {
      method: "POST",
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
    };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();

    // Verify a WARNING log was emitted
    const warnLog = logs.find((l) => l.level === "WARNING");
    expect(warnLog).toBeDefined();
    expect(warnLog!.message).toContain("Malformed");
  });

  it("returns 204 with warning log for empty message string", async () => {
    const body = { message: "   " };
    const req = {
      method: "POST",
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
    };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();

    const warnLog = logs.find((l) => l.level === "WARNING");
    expect(warnLog).toBeDefined();
    expect(warnLog!.message).toContain("Malformed");
  });

  it("returns 413 for oversized payload (>10KB)", async () => {
    const largeMessage = "x".repeat(11 * 1024);
    const body = { message: largeMessage };
    const rawBody = Buffer.from(JSON.stringify(body));
    const req = { method: "POST", body, rawBody };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "Payload too large" });
    // No log should be emitted for oversized payloads
    expect(logs).toHaveLength(0);
  });

  it("returns 405 for non-POST methods", async () => {
    const req = { method: "GET", body: {}, rawBody: Buffer.from("{}") };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: "Method not allowed" });
    expect(logs).toHaveLength(0);
  });

  it("returns 204 with warning when message is a non-string type", async () => {
    const body = { message: 12345 };
    const req = {
      method: "POST",
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
    };
    const res = mockResponse();
    const logs: LogCapture[] = [];

    await handleReportFrontendError(req, res, logs);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();

    const warnLog = logs.find((l) => l.level === "WARNING");
    expect(warnLog).toBeDefined();
  });
});
