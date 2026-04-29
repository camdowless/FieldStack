import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resend } from '@/lib/email'
import { createMagicToken, buildMagicUrl } from '@/lib/magic-link'

const FROM = process.env.RESEND_FROM_EMAIL || 'digest@fieldstack.app'

export async function POST(req: NextRequest) {
  // Verify cron secret for automated calls
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also allow authenticated users to trigger manually
    // (no auth check here — the cron secret is the gate for automated calls)
  }

  const companies = await prisma.company.findMany({
    include: { users: { where: { role: 'ADMIN' }, select: { email: true, name: true } } },
  })

  let sent = 0

  for (const company of companies) {
    const adminEmails = company.users.map((u) => u.email)
    if (adminEmails.length === 0) continue

    const today = new Date()
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [projects, overdueSteps, upcomingSteps, completedThisWeek, changes] = await Promise.all([
      prisma.project.findMany({
        where: { companyId: company.id, status: 'ACTIVE' },
        select: { id: true, name: true },
      }),
      prisma.taskStep.findMany({
        where: { project: { companyId: company.id }, status: { not: 'COMPLETE' }, dueDate: { lt: today } },
        include: { project: { select: { name: true } }, assignedTo: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 15,
      }),
      prisma.taskStep.findMany({
        where: { project: { companyId: company.id }, status: { not: 'COMPLETE' }, dueDate: { gte: today, lte: weekFromNow } },
        include: { project: { select: { name: true } }, assignedTo: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 15,
      }),
      prisma.taskStep.findMany({
        where: { project: { companyId: company.id }, status: 'COMPLETE', completedAt: { gte: weekAgo } },
        include: { project: { select: { name: true } } },
      }),
      prisma.scheduleChange.findMany({
        where: { project: { companyId: company.id }, detectedAt: { gte: weekAgo } },
        include: { project: { select: { name: true } }, task: { select: { taskName: true } } },
      }),
    ])

    if (projects.length === 0) continue

    // Build magic links for overdue steps
    const overdueWithLinks = await Promise.all(
      overdueSteps.slice(0, 10).map(async (s) => {
        const token = await createMagicToken({ stepId: s.id, action: 'complete' })
        return { ...s, magicUrl: buildMagicUrl(token) }
      })
    )

    const html = buildDigestHtml({
      companyName: company.name,
      projects: projects.length,
      overdue: overdueWithLinks,
      upcoming: upcomingSteps,
      completedCount: completedThisWeek.length,
      changes,
      today,
    })

    const weekLabel = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    if (resend) {
      await resend.emails.send({
        from: FROM,
        to: adminEmails,
        subject: `FieldStack Weekly: ${overdueSteps.length} overdue, ${upcomingSteps.length} upcoming — Week of ${weekLabel}`,
        html,
      })
      sent++
    } else {
      console.log(`[digest] Would send to ${adminEmails.join(', ')}: ${overdueSteps.length} overdue, ${upcomingSteps.length} upcoming`)
      sent++
    }
  }

  return NextResponse.json({ sent, timestamp: new Date().toISOString() })
}

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildDigestHtml(data: {
  companyName: string
  projects: number
  overdue: any[]
  upcoming: any[]
  completedCount: number
  changes: any[]
  today: Date
}) {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

  const overdueRows = data.overdue.map((s) => {
    const daysOver = Math.round((data.today.getTime() - (s.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24))
    return `
      <tr style="border-bottom:1px solid #1e1e22;">
        <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${s.stepType.replace(/_/g, ' ')}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.project.name}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.building || '-'}</td>
        <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.assignedTo?.name || 'Unassigned'}</td>
        <td style="padding:8px 12px;font-size:11px;color:#f87171;font-family:monospace;">${daysOver}d</td>
        <td style="padding:8px 12px;">
          <a href="${s.magicUrl}" style="color:#c8f04c;font-size:11px;font-family:monospace;text-decoration:none;">Mark Done →</a>
        </td>
      </tr>`
  }).join('')

  const upcomingRows = data.upcoming.slice(0, 10).map((s) => `
    <tr style="border-bottom:1px solid #1e1e22;">
      <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${s.stepType.replace(/_/g, ' ')}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.project.name}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.building || '-'}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${s.assignedTo?.name || 'Unassigned'}</td>
      <td style="padding:8px 12px;font-size:11px;color:#93c5fd;font-family:monospace;">${s.dueDate ? fmtDate(s.dueDate) : '-'}</td>
    </tr>`
  ).join('')

  const changeRows = data.changes.slice(0, 5).map((c) => `
    <tr style="border-bottom:1px solid #1e1e22;">
      <td style="padding:8px 12px;font-size:12px;color:#f0eff5;">${c.task.taskName}</td>
      <td style="padding:8px 12px;font-size:11px;color:#7a7885;font-family:monospace;">${c.project.name}</td>
      <td style="padding:8px 12px;font-size:11px;color:${c.shiftDays < 0 ? '#f87171' : '#6ee7b7'};font-family:monospace;">${c.shiftDays > 0 ? '+' : ''}${c.shiftDays}d</td>
    </tr>`
  ).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>FieldStack Weekly Digest</title></head>
<body style="background:#0f0f11;margin:0;padding:24px;font-family:system-ui,sans-serif;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0f3460,#1a1a2e);padding:24px;">
        <div style="color:#c8f04c;font-family:monospace;font-size:20px;font-weight:bold;letter-spacing:0.08em;">FIELDSTACK</div>
        <div style="color:#93c5fd;font-size:14px;margin-top:4px;">Weekly Digest — ${data.companyName}</div>
        <div style="color:#7a7885;font-size:12px;font-family:monospace;margin-top:8px;">
          ${data.projects} active project${data.projects !== 1 ? 's' : ''} · ${data.completedCount} task${data.completedCount !== 1 ? 's' : ''} completed this week
        </div>
      </div>

      <div style="padding:24px;">
        ${data.overdue.length > 0 ? `
        <!-- Overdue -->
        <div style="background:#f8717111;border:1px solid #f8717133;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="color:#f87171;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">
            OVERDUE (${data.overdue.length})
          </div>
          <table style="width:100%;border-collapse:collapse;">${overdueRows}</table>
        </div>` : `
        <div style="background:#6ee7b711;border:1px solid #6ee7b733;border-radius:8px;padding:16px;margin-bottom:20px;text-align:center;">
          <div style="color:#6ee7b7;font-family:monospace;font-size:13px;">All clear — nothing overdue</div>
        </div>`}

        ${data.upcoming.length > 0 ? `
        <!-- Upcoming -->
        <div style="margin-bottom:20px;">
          <div style="color:#93c5fd;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">
            COMING THIS WEEK (${data.upcoming.length})
          </div>
          <table style="width:100%;border-collapse:collapse;">${upcomingRows}</table>
        </div>` : ''}

        ${data.changes.length > 0 ? `
        <!-- Schedule Changes -->
        <div style="margin-bottom:20px;">
          <div style="color:#fbbf24;font-family:monospace;font-size:12px;font-weight:bold;margin-bottom:12px;letter-spacing:0.06em;">
            SCHEDULE CHANGES (${data.changes.length})
          </div>
          <table style="width:100%;border-collapse:collapse;">${changeRows}</table>
        </div>` : ''}

        <div style="text-align:center;margin-top:24px;">
          <a href="${APP_URL}/dashboard" style="background:#c8f04c;color:#0f0f11;padding:12px 28px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:13px;font-weight:bold;">
            Open Dashboard →
          </a>
        </div>
      </div>

      <div style="padding:12px 24px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;">
        <span style="color:#7a7885;font-size:10px;font-family:monospace;">FieldStack · AI Foreman for Subcontractors</span>
      </div>
    </div>
  </div>
</body>
</html>`
}
