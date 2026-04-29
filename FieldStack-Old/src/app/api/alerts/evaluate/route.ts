import { NextRequest, NextResponse } from 'next/server'
import { computeAllAlerts } from '@/lib/alerts'
import { sendAlertEmails } from '@/lib/email'

export async function POST(req: NextRequest) {
  // Verify cron secret
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const alerts = await computeAllAlerts()
  const actionable = alerts.filter((a) => ['CRITICAL', 'WARNING'].includes(a.level))

  if (actionable.length > 0) {
    // Group by project for nicer emails
    const byProject = actionable.reduce((acc, a) => {
      if (!acc[a.projectId]) acc[a.projectId] = { name: a.projectName, alerts: [] }
      acc[a.projectId].alerts.push(a)
      return acc
    }, {} as Record<string, { name: string; alerts: typeof actionable }>)

    for (const { name, alerts: projectAlerts } of Object.values(byProject)) {
      await sendAlertEmails(projectAlerts, name)
    }
  }

  return NextResponse.json({
    evaluated: alerts.length,
    actionable: actionable.length,
    critical: alerts.filter((a) => a.level === 'CRITICAL').length,
    warning: alerts.filter((a) => a.level === 'WARNING').length,
  })
}

// Also allow GET for testing
export async function GET(req: NextRequest) {
  const alerts = await computeAllAlerts()
  return NextResponse.json(alerts)
}
