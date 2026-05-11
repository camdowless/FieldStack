/**
 * FieldStack email HTML templates.
 * Dark-themed, monospace aesthetic matching the old app.
 */

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

function alertColor(level: string): string {
  return (
    {
      CRITICAL: "#f87171",
      WARNING: "#fbbf24",
      INFO: "#93c5fd",
      VERIFY: "#6ee7b7",
      ON_TRACK: "#6ee7b7",
    }[level] ?? "#6b7280"
  );
}

// ─── Alert email ──────────────────────────────────────────────────────────────

export interface AlertEmailItem {
  level: string;
  title: string;
  detail: string;
}

export function buildAlertEmailHtml(alerts: AlertEmailItem[], projectName?: string): string {
  const critical = alerts.filter((a) => a.level === "CRITICAL");
  const others = alerts.filter((a) => a.level !== "CRITICAL");

  const renderRow = (a: AlertEmailItem) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${alertColor(a.level)};margin-right:8px;"></span>
        <strong style="color:#f0eff5;">${a.title}</strong><br>
        <span style="color:#7a7885;">${a.detail}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;text-align:right;">
        <span style="background:${alertColor(a.level)}22;color:${alertColor(a.level)};padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px;">${a.level}</span>
      </td>
    </tr>`;

  const allRows = [...critical, ...others].map(renderRow).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FieldStack Alert</title></head>
<body style="background:#0f0f11;margin:0;padding:24px;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <div style="background:#0f3460;padding:20px 24px;">
        <div style="color:#c8f04c;font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:0.08em;">FIELDSTACK</div>
        <div style="color:#93c5fd;font-size:13px;margin-top:4px;">Schedule Alert${projectName ? ` — ${projectName}` : ""}</div>
      </div>
      <div style="padding:20px 24px;">
        ${critical.length > 0 ? `<div style="background:#f8717122;border:1px solid #f8717144;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#f87171;font-size:13px;font-family:monospace;">⚠ ${critical.length} order${critical.length > 1 ? "s" : ""} past due — action required immediately</div>` : ""}
        <table style="width:100%;border-collapse:collapse;">${allRows}</table>
        <div style="margin-top:20px;text-align:center;">
          <a href="${APP_URL}" style="background:#c8f04c;color:#0f0f11;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">Open FieldStack Dashboard →</a>
        </div>
      </div>
      <div style="padding:12px 24px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
        <span style="color:#7a7885;font-size:11px;font-family:monospace;">FieldStack · Schedule Intelligence Platform</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Schedule change email ────────────────────────────────────────────────────

export interface ScheduleChangeItem {
  taskName: string;
  building?: string | null;
  floor?: string | null;
  previousDate: Date;
  newDate: Date;
  shiftDays: number;
}

export function buildScheduleChangeEmailHtml(changes: ScheduleChangeItem[], projectName: string): string {
  const rows = changes
    .map(
      (c) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#f0eff5;">${c.taskName}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#7a7885;">${[c.building, c.floor].filter(Boolean).join(" ")}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#7a7885;">${c.previousDate.toLocaleDateString()}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#fbbf24;">${c.newDate.toLocaleDateString()}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;text-align:right;">
        <span style="color:${c.shiftDays > 0 ? "#f87171" : "#6ee7b7"};font-family:monospace;font-size:12px;">${c.shiftDays > 0 ? "+" : ""}${c.shiftDays}d</span>
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="background:#0f0f11;margin:0;padding:24px;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <div style="background:#0f3460;padding:20px 24px;">
        <div style="color:#c8f04c;font-family:monospace;font-size:18px;font-weight:bold;">FIELDSTACK</div>
        <div style="color:#93c5fd;font-size:13px;margin-top:4px;">Schedule Change Detected — ${projectName}</div>
      </div>
      <div style="padding:20px 24px;">
        <div style="background:#fbbf2422;border:1px solid #fbbf2444;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#fbbf24;font-size:13px;font-family:monospace;">
          ${changes.length} task${changes.length > 1 ? "s" : ""} shifted since the last schedule upload
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="background:#16213e;">
            <th style="padding:8px 12px;text-align:left;font-family:monospace;font-size:11px;color:#7a7885;text-transform:uppercase;">Task</th>
            <th style="padding:8px 12px;text-align:left;font-family:monospace;font-size:11px;color:#7a7885;text-transform:uppercase;">Location</th>
            <th style="padding:8px 12px;text-align:left;font-family:monospace;font-size:11px;color:#7a7885;text-transform:uppercase;">Was</th>
            <th style="padding:8px 12px;text-align:left;font-family:monospace;font-size:11px;color:#7a7885;text-transform:uppercase;">Now</th>
            <th style="padding:8px 12px;text-align:right;font-family:monospace;font-size:11px;color:#7a7885;text-transform:uppercase;">Shift</th>
          </tr>
          ${rows}
        </table>
        <div style="margin-top:20px;text-align:center;">
          <a href="${APP_URL}" style="background:#c8f04c;color:#0f0f11;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">Review Changes →</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ─── Escalation email ─────────────────────────────────────────────────────────

export function buildEscalationEmailHtml(params: {
  level: string;
  stepLabel: string;
  location: string;
  projectName: string;
  assigneeName: string;
  daysOverdue: number;
  dueInDays?: number;
  projectId: string;
  magicUrl: string;
}): { subject: string; html: string } {
  const { level, stepLabel, location, projectName, assigneeName, daysOverdue, dueInDays, projectId, magicUrl } = params;
  const color = level === "CRITICAL" ? "#f87171" : level === "OVERDUE" ? "#fbbf24" : "#93c5fd";

  const subject =
    level === "CRITICAL"
      ? `[CRITICAL] ${stepLabel} for ${location} is ${daysOverdue} days overdue — ${projectName}`
      : level === "OVERDUE"
      ? `[OVERDUE] ${stepLabel} for ${location} was due ${daysOverdue} day${daysOverdue > 1 ? "s" : ""} ago — ${projectName}`
      : `[REMINDER] ${stepLabel} for ${location} due in ${dueInDays} day${dueInDays !== 1 ? "s" : ""} — ${projectName}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#17171a;color:#f0eff5;padding:24px;border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:11px;font-family:monospace;letter-spacing:0.1em;color:${color};text-transform:uppercase;margin-bottom:12px">${level}</div>
      <h2 style="margin:0 0 8px;font-size:16px;font-weight:600">${stepLabel}</h2>
      <p style="color:#7a7885;font-size:13px;margin:0 0 16px">${location} · ${projectName}</p>
      <div style="background:#0f0f11;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px">
        <div style="margin-bottom:4px"><span style="color:#7a7885">Assigned to:</span> ${assigneeName}</div>
        <div><span style="color:#7a7885">Status:</span> <span style="color:${color}">${level === "REMINDER" ? `Due in ${dueInDays} day${dueInDays !== 1 ? "s" : ""}` : `${daysOverdue} day${daysOverdue > 1 ? "s" : ""} overdue`}</span></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${magicUrl}" style="display:inline-block;background:#c8f04c;color:#0f0f11;padding:8px 20px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:12px;font-weight:600">Mark Done →</a>
        <a href="${APP_URL}/projects/${projectId}" style="display:inline-block;background:transparent;color:#93c5fd;padding:8px 20px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:12px;border:1px solid #93c5fd33">View in FieldStack</a>
      </div>
    </div>`;

  return { subject, html };
}

// ─── Weekly digest email ──────────────────────────────────────────────────────

export interface DigestData {
  companyName: string;
  projects: number;
  overdue: Array<{
    stepType: string;
    building?: string | null;
    projectName: string;
    assignedToName?: string | null;
    dueDate?: Date | null;
    daysOverdue: number;
    magicUrl: string;
  }>;
  upcoming: Array<{
    stepType: string;
    building?: string | null;
    projectName: string;
    assignedToName?: string | null;
    dueDate?: Date | null;
  }>;
  completedCount: number;
  changes: Array<{
    taskName: string;
    projectName: string;
    shiftDays: number;
  }>;
  today: Date;
}

export function buildDigestEmailHtml(data: DigestData): string {
  const weekLabel = data.today.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const overdueRows = data.overdue
    .map(
      (s) => `
      <tr style="border-bottom:1px solid #1e1e22;">
        <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${s.stepType.replace(/_/g, " ")}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.projectName}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.building || "-"}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.assignedToName || "Unassigned"}</td>
        <td style="padding:8px 12px;font-size:11px;color:#f87171;font-family:monospace;">${s.daysOverdue}d</td>
        <td style="padding:8px 12px;">
          <a href="${s.magicUrl}" style="color:#c8f04c;font-size:11px;font-family:monospace;text-decoration:none;">Mark Done →</a>
        </td>
      </tr>`
    )
    .join("");

  const upcomingRows = data.upcoming
    .slice(0, 10)
    .map(
      (s) => `
    <tr style="border-bottom:1px solid #1e1e22;">
      <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${s.stepType.replace(/_/g, " ")}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.projectName}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.building || "-"}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.assignedToName || "Unassigned"}</td>
      <td style="padding:8px 12px;font-size:11px;color:#93c5fd;font-family:monospace;">${s.dueDate ? s.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"}</td>
    </tr>`
    )
    .join("");

  const changeRows = data.changes
    .slice(0, 5)
    .map(
      (c) => `
    <tr style="border-bottom:1px solid #1e1e22;">
      <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${c.taskName}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${c.projectName}</td>
      <td style="padding:8px 12px;font-size:11px;color:${c.shiftDays < 0 ? "#f87171" : "#6ee7b7"};font-family:monospace;">${c.shiftDays > 0 ? "+" : ""}${c.shiftDays}d</td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FieldStack Weekly Digest</title></head>
<body style="background:#0f0f11;margin:0;padding:24px;font-family:system-ui,sans-serif;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#0f3460,#1a1a2e);padding:24px;">
        <div style="color:#c8f04c;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:0.08em;">FIELDSTACK</div>
        <div style="color:#93c5fd;font-size:14px;margin-top:4px;">Weekly Digest — ${data.companyName}</div>
        <div style="color:#7a7885;font-size:12px;font-family:monospace;margin-top:8px;">
          ${data.projects} active project${data.projects !== 1 ? "s" : ""} · ${data.completedCount} task${data.completedCount !== 1 ? "s" : ""} completed this week
        </div>
      </div>
      <div style="padding:24px;">
        ${
          data.overdue.length > 0
            ? `<div style="background:#f8717111;border:1px solid #f8717133;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="color:#f87171;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">OVERDUE (${data.overdue.length})</div>
          <table style="width:100%;border-collapse:collapse;">${overdueRows}</table>
        </div>`
            : `<div style="background:#6ee7b711;border:1px solid #6ee7b733;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center;">
          <div style="color:#6ee7b7;font-family:monospace;font-size:13px;">All clear — nothing overdue</div>
        </div>`
        }
        ${
          data.upcoming.length > 0
            ? `<div style="margin-bottom:20px;">
          <div style="color:#93c5fd;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">COMING THIS WEEK (${data.upcoming.length})</div>
          <table style="width:100%;border-collapse:collapse;">${upcomingRows}</table>
        </div>`
            : ""
        }
        ${
          data.changes.length > 0
            ? `<div style="margin-bottom:20px;">
          <div style="color:#fbbf24;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">SCHEDULE CHANGES (${data.changes.length})</div>
          <table style="width:100%;border-collapse:collapse;">${changeRows}</table>
        </div>`
            : ""
        }
        <div style="text-align:center;margin-top:24px;">
          <a href="${APP_URL}" style="background:#c8f04c;color:#0f0f11;padding:12px 28px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">Open Dashboard →</a>
        </div>
      </div>
      <div style="padding:12px 24px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
        <span style="color:#7a7885;font-size:10px;font-family:monospace;">FieldStack · AI Foreman for Subcontractors</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}
