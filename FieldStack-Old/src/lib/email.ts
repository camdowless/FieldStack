import { Resend } from 'resend'
import { prisma } from './prisma'
import { Alert } from './alerts'
import { createMagicToken, buildMagicUrl } from './magic-link'

export const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM = process.env.RESEND_FROM_EMAIL || 'alerts@fieldstack.app'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

function alertColor(level: string) {
  return { CRITICAL: '#f87171', WARNING: '#fbbf24', INFO: '#93c5fd', VERIFY: '#6ee7b7', ON_TRACK: '#6ee7b7' }[level] || '#6b7280'
}

function buildAlertEmailHtml(alerts: Alert[], projectName?: string): string {
  const critical = alerts.filter((a) => a.level === 'CRITICAL')
  const warning = alerts.filter((a) => a.level === 'WARNING')
  const info = alerts.filter((a) => a.level === 'INFO')
  const verify = alerts.filter((a) => a.level === 'VERIFY')

  const renderRow = (a: Alert) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${alertColor(a.level)};margin-right:8px;"></span>
        <strong style="color:#f0eff5;">${a.title}</strong><br>
        <span style="color:#7a7885;">${a.detail}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;text-align:right;">
        <span style="background:${alertColor(a.level)}22;color:${alertColor(a.level)};padding:2px 8px;border-radius:4px;font-family:monospace;font-size:11px;">${a.level}</span>
      </td>
    </tr>`

  const allRows = [...critical, ...warning, ...info, ...verify].map(renderRow).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FieldStack Alert</title></head>
<body style="background:#0f0f11;margin:0;padding:24px;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <div style="background:#0f3460;padding:20px 24px;">
        <div style="color:#c8f04c;font-family:monospace;font-size:18px;font-weight:bold;letter-spacing:0.08em;">FIELDSTACK</div>
        <div style="color:#93c5fd;font-size:13px;margin-top:4px;">Schedule Alert${projectName ? ` — ${projectName}` : ''}</div>
      </div>
      <div style="padding:20px 24px;">
        ${critical.length > 0 ? `<div style="background:#f8717122;border:1px solid #f8717144;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#f87171;font-size:13px;font-family:monospace;">⚠ ${critical.length} order${critical.length > 1 ? 's' : ''} past due — action required immediately</div>` : ''}
        <table style="width:100%;border-collapse:collapse;">
          ${allRows}
        </table>
        <div style="margin-top:20px;text-align:center;">
          <a href="${APP_URL}/dashboard" style="background:#c8f04c;color:#0f0f11;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">Open FieldStack Dashboard →</a>
        </div>
      </div>
      <div style="padding:12px 24px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
        <span style="color:#7a7885;font-size:11px;font-family:monospace;">FieldStack · Schedule Intelligence Platform</span>
      </div>
    </div>
  </div>
</body>
</html>`
}

function buildScheduleChangeEmailHtml(changes: any[], projectName: string): string {
  const rows = changes.map((c) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#f0eff5;">${c.task?.taskName}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#7a7885;">${c.task?.building} ${c.task?.floor}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#7a7885;">${new Date(c.previousDate).toLocaleDateString()}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;font-family:monospace;font-size:12px;color:#fbbf24;">${new Date(c.newDate).toLocaleDateString()}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1e22;text-align:right;">
        <span style="color:${c.shiftDays > 0 ? '#f87171' : '#6ee7b7'};font-family:monospace;font-size:12px;">${c.shiftDays > 0 ? '+' : ''}${c.shiftDays}d</span>
      </td>
    </tr>`).join('')

  return `
<!DOCTYPE html>
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
          ${changes.length} task${changes.length > 1 ? 's' : ''} shifted since the last schedule upload
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
          <a href="${APP_URL}/dashboard" style="background:#c8f04c;color:#0f0f11;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">Review Changes →</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}

export async function sendAlertEmails(alerts: Alert[], projectName?: string) {
  if (!resend) { console.log('[EMAIL SKIPPED] No Resend API key'); return }
  const critical = alerts.filter((a) => a.level === 'CRITICAL')
  const nonCritical = alerts.filter((a) => ['WARNING', 'INFO', 'VERIFY'].includes(a.level))

  const team = await prisma.teamMember.findMany()

  if (critical.length > 0) {
    const recipients = team.filter((m) => m.notifyOnCritical).map((m) => m.email)
    if (recipients.length > 0) {
      await resend.emails.send({
        from: FROM,
        to: recipients,
        subject: `[CRITICAL] FieldStack: ${critical.length} order${critical.length > 1 ? 's' : ''} past due${projectName ? ` — ${projectName}` : ''}`,
        html: buildAlertEmailHtml(critical, projectName),
      })
    }
  }

  if (nonCritical.length > 0) {
    const recipients = team.filter((m) => m.notifyOnOrderReminder).map((m) => m.email)
    if (recipients.length > 0) {
      await resend.emails.send({
        from: FROM,
        to: recipients,
        subject: `[ACTION NEEDED] FieldStack: ${nonCritical.length} order${nonCritical.length > 1 ? 's' : ''} need attention`,
        html: buildAlertEmailHtml(nonCritical, projectName),
      })
    }
  }
}

export async function sendScheduleChangeEmails(changes: any[], projectName: string) {
  if (!resend) { console.log('[EMAIL SKIPPED] No Resend API key'); return }
  const team = await prisma.teamMember.findMany({ where: { notifyOnScheduleChange: true } })
  const recipients = team.map((m) => m.email)
  if (recipients.length === 0) return

  await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `[SCHEDULE CHANGE] FieldStack: ${changes.length} task${changes.length > 1 ? 's' : ''} shifted — ${projectName}`,
    html: buildScheduleChangeEmailHtml(changes, projectName),
  })
}
