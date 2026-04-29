import { prisma } from './prisma'
import { EscalationLevel, StepStatus, TeamRole } from '@prisma/client'
import { addDays } from 'date-fns'
import { resend } from './email'
import { createMagicToken, buildMagicUrl } from './magic-link'

const FROM = process.env.RESEND_FROM_EMAIL || 'alerts@fieldstack.app'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

const STEP_LABELS: Record<string, string> = {
  SHOP_DRAWINGS: 'Shop Drawings',
  SUBMISSIONS: 'Submissions',
  ORDER_MATERIALS: 'Order Materials',
  CONFIRM_DELIVERY: 'Confirm Delivery',
  INSTALL: 'Install',
  PUNCH_LIST: 'Punch List',
}

interface EscalationResult {
  reminders: number
  overdue: number
  critical: number
}

export async function runEscalation(): Promise<EscalationResult> {
  const now = new Date()
  const in3Days = addDays(now, 3)
  const twoDaysAgo = addDays(now, -2)

  let reminders = 0
  let overdue = 0
  let critical = 0

  // Get all non-complete steps with due dates
  const steps = await prisma.taskStep.findMany({
    where: {
      status: { not: StepStatus.COMPLETE },
      dueDate: { not: null },
      project: { status: 'ACTIVE' },
    },
    include: {
      project: { select: { name: true } },
      task: { select: { taskName: true } },
      assignedTo: { select: { name: true, email: true, role: true } },
      escalations: { select: { level: true, sentAt: true }, orderBy: { sentAt: 'desc' } },
    },
  })

  // Find owner for critical escalations
  const owner = await prisma.teamMember.findFirst({ where: { role: TeamRole.OWNER } })
  // Find supervisors for overdue escalations
  const supervisors = await prisma.teamMember.findMany({ where: { role: TeamRole.SUPERVISOR } })

  for (const step of steps) {
    if (!step.dueDate || !step.assignedTo) continue

    const daysUntilDue = Math.ceil((step.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const lastEscalation = step.escalations[0]

    // Check if we already sent this level today
    const alreadySentToday = lastEscalation &&
      lastEscalation.sentAt.toDateString() === now.toDateString()

    if (alreadySentToday) continue

    const stepLabel = STEP_LABELS[step.stepType] || step.stepType
    const location = [step.building, step.floor].filter(Boolean).join(' / ') || 'General'

    // CRITICAL: 2+ days overdue → escalate to owner
    if (daysUntilDue <= -2 && lastEscalation?.level !== EscalationLevel.CRITICAL) {
      if (owner) {
        await sendEscalationEmail({
          to: owner.email,
          level: 'CRITICAL',
          stepLabel,
          location,
          projectName: step.project.name,
          assigneeName: step.assignedTo.name,
          daysOverdue: Math.abs(daysUntilDue),
          stepId: step.id,
          projectId: step.projectId,
        })
        await prisma.escalationLog.create({
          data: { taskStepId: step.id, level: EscalationLevel.CRITICAL, sentTo: owner.email },
        })
        critical++
      }
    }
    // OVERDUE: past due → escalate to supervisor + assignee
    else if (daysUntilDue < 0 && lastEscalation?.level !== EscalationLevel.OVERDUE) {
      const recipients = [
        step.assignedTo.email,
        ...supervisors.map((s) => s.email),
      ]
      for (const email of [...new Set(recipients)]) {
        await sendEscalationEmail({
          to: email,
          level: 'OVERDUE',
          stepLabel,
          location,
          projectName: step.project.name,
          assigneeName: step.assignedTo.name,
          daysOverdue: Math.abs(daysUntilDue),
          stepId: step.id,
          projectId: step.projectId,
        })
      }
      await prisma.escalationLog.create({
        data: { taskStepId: step.id, level: EscalationLevel.OVERDUE, sentTo: step.assignedTo.email },
      })
      overdue++
    }
    // REMINDER: due within 3 days → remind assignee
    else if (daysUntilDue <= 3 && daysUntilDue >= 0 && !lastEscalation) {
      await sendEscalationEmail({
        to: step.assignedTo.email,
        level: 'REMINDER',
        stepLabel,
        location,
        projectName: step.project.name,
        assigneeName: step.assignedTo.name,
        daysOverdue: 0,
        dueInDays: daysUntilDue,
        stepId: step.id,
        projectId: step.projectId,
      })
      await prisma.escalationLog.create({
        data: { taskStepId: step.id, level: EscalationLevel.REMINDER, sentTo: step.assignedTo.email },
      })
      reminders++
    }
  }

  return { reminders, overdue, critical }
}

interface EscalationEmailParams {
  to: string
  level: string
  stepLabel: string
  location: string
  projectName: string
  assigneeName: string
  daysOverdue: number
  dueInDays?: number
  stepId: string
  projectId: string
}

async function sendEscalationEmail(params: EscalationEmailParams) {
  const { to, level, stepLabel, location, projectName, assigneeName, daysOverdue, dueInDays, stepId, projectId } = params

  // Generate magic link for one-click completion
  const token = await createMagicToken({ stepId, action: 'complete' })
  const magicUrl = buildMagicUrl(token)

  const subject = level === 'CRITICAL'
    ? `[CRITICAL] ${stepLabel} for ${location} is ${daysOverdue} days overdue — ${projectName}`
    : level === 'OVERDUE'
      ? `[OVERDUE] ${stepLabel} for ${location} was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago — ${projectName}`
      : `[REMINDER] ${stepLabel} for ${location} due in ${dueInDays} day${dueInDays !== 1 ? 's' : ''} — ${projectName}`

  const color = level === 'CRITICAL' ? '#f87171' : level === 'OVERDUE' ? '#fbbf24' : '#93c5fd'

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#17171a;color:#f0eff5;padding:24px;border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:11px;font-family:monospace;letter-spacing:0.1em;color:${color};text-transform:uppercase;margin-bottom:12px">${level}</div>
      <h2 style="margin:0 0 8px;font-size:16px;font-weight:600">${stepLabel}</h2>
      <p style="color:#7a7885;font-size:13px;margin:0 0 16px">${location} · ${projectName}</p>
      <div style="background:#0f0f11;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px">
        <div style="margin-bottom:4px"><span style="color:#7a7885">Assigned to:</span> ${assigneeName}</div>
        <div><span style="color:#7a7885">Status:</span> <span style="color:${color}">${level === 'REMINDER' ? `Due in ${dueInDays} day${dueInDays !== 1 ? 's' : ''}` : `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`}</span></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${magicUrl}" style="display:inline-block;background:#c8f04c;color:#0f0f11;padding:8px 20px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:12px;font-weight:600">Mark Done →</a>
        <a href="${APP_URL}/projects/${projectId}?tab=Workflow" style="display:inline-block;background:transparent;color:#93c5fd;padding:8px 20px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:12px;border:1px solid #93c5fd33">View in FieldStack</a>
      </div>
    </div>`

  if (!resend) {
    console.log(`[ESCALATION SKIPPED] ${level} → ${to}: ${subject}`)
    return
  }

  try {
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch (e) {
    console.error(`Failed to send escalation email to ${to}:`, e)
  }
}
