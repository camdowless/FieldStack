import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeProjectAlerts } from '@/lib/alerts'
import { sendAlertEmails, sendScheduleChangeEmails } from '@/lib/email'
import { runEscalation } from '@/lib/escalation'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Compute and send order alerts
  const alerts = await computeProjectAlerts(params.id)
  const actionable = alerts.filter((a) => ['CRITICAL', 'WARNING'].includes(a.level))

  let alertEmailResult = 'no actionable alerts'
  if (actionable.length > 0) {
    try {
      await sendAlertEmails(actionable, project.name)
      alertEmailResult = `sent ${actionable.length} alert(s)`
    } catch (e: any) {
      alertEmailResult = `failed: ${e.message}`
    }
  }

  // Send unsent schedule change notifications
  const unsentChanges = await prisma.scheduleChange.findMany({
    where: { projectId: params.id, notificationsSent: false },
    include: { task: true },
  })

  let changeEmailResult = 'no unsent changes'
  if (unsentChanges.length > 0) {
    try {
      await sendScheduleChangeEmails(unsentChanges, project.name)
      await prisma.scheduleChange.updateMany({
        where: { id: { in: unsentChanges.map((c) => c.id) } },
        data: { notificationsSent: true },
      })
      changeEmailResult = `sent ${unsentChanges.length} change(s)`
    } catch (e: any) {
      changeEmailResult = `failed: ${e.message}`
    }
  }

  // Run step escalation
  let escalationResult = { reminders: 0, overdue: 0, critical: 0 }
  try {
    escalationResult = await runEscalation()
  } catch (e: any) {
    console.error('Escalation error:', e)
  }

  return NextResponse.json({
    alerts: alertEmailResult,
    changes: changeEmailResult,
    escalation: escalationResult,
    resendConfigured: !!process.env.RESEND_API_KEY,
  })
}
