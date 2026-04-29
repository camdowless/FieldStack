import { prisma } from './prisma'
import { parseScheduleWithClaude } from './parser'
import { sendScheduleChangeEmails } from './email'
import { computeProjectAlerts } from './alerts'
import { sendAlertEmails } from './email'

const PROCORE_API_BASE = 'https://api.procore.com/rest/v1.0'

interface ProcoreTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

/**
 * Exchange an auth code for tokens (OAuth2 flow)
 */
export async function exchangeProcoreCode(code: string): Promise<ProcoreTokens> {
  const res = await fetch('https://login.procore.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.PROCORE_CLIENT_ID,
      client_secret: process.env.PROCORE_CLIENT_SECRET,
      redirect_uri: `${process.env.NEXTAUTH_URL}/api/webhooks/procore/callback`,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || 'Procore auth failed')
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

/**
 * Refresh an expired token
 */
async function refreshToken(refreshToken: string): Promise<ProcoreTokens> {
  const res = await fetch('https://login.procore.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.PROCORE_CLIENT_ID,
      client_secret: process.env.PROCORE_CLIENT_SECRET,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Token refresh failed')
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }
}

/**
 * Get a valid access token for a project, refreshing if needed
 */
async function getValidToken(project: any): Promise<string | null> {
  if (!project.procoreAccessToken) return null

  // Check if expired (with 5 min buffer)
  if (project.procoreTokenExpiry && project.procoreTokenExpiry.getTime() < Date.now() + 300000) {
    if (!project.procoreRefreshToken) return null

    try {
      const tokens = await refreshToken(project.procoreRefreshToken)
      await prisma.project.update({
        where: { id: project.id },
        data: {
          procoreAccessToken: tokens.access_token,
          procoreRefreshToken: tokens.refresh_token,
          procoreTokenExpiry: new Date(tokens.expires_at),
        },
      })
      return tokens.access_token
    } catch {
      console.error(`Failed to refresh Procore token for project ${project.id}`)
      return null
    }
  }

  return project.procoreAccessToken
}

/**
 * Fetch the schedule from Procore and return raw text
 */
export async function fetchProcoreSchedule(projectId: string): Promise<{
  rawText: string
  fileName: string
} | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project || project.gcPlatform !== 'PROCORE' || !project.gcProjectId) return null

  const token = await getValidToken(project)
  if (!token) {
    console.log(`No valid Procore token for project ${projectId}`)
    return null
  }

  try {
    // Fetch schedule items from Procore
    const res = await fetch(
      `${PROCORE_API_BASE}/projects/${project.gcProjectId}/schedule/tasks`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    if (!res.ok) {
      console.error(`Procore API error: ${res.status} ${res.statusText}`)
      return null
    }

    const tasks = await res.json()

    // Convert Procore tasks to a text format our parser understands
    const lines = tasks.map((t: any) =>
      `${t.id}\t${t.name}\t${t.assigned_to?.name || ''}\t${t.start_date || ''}\t${t.finish_date || ''}\t${t.location?.name || ''}`
    )

    const header = `Procore Schedule Export\nProject: ${project.name}\nExported: ${new Date().toISOString()}\n\nID\tTask Name\tResource\tStart\tEnd\tLocation\n`
    const rawText = header + lines.join('\n')

    return {
      rawText,
      fileName: `procore-sync-${new Date().toISOString().slice(0, 10)}.txt`,
    }
  } catch (e) {
    console.error('Procore fetch error:', e)
    return null
  }
}

/**
 * Full sync pipeline: fetch from Procore, parse, detect changes, alert
 */
export async function syncProcoreSchedule(projectId: string): Promise<{
  success: boolean
  tasksCreated?: number
  orderItemsCreated?: number
  chainsCreated?: number
  changesDetected?: number
  error?: string
}> {
  const scheduleData = await fetchProcoreSchedule(projectId)
  if (!scheduleData) {
    return { success: false, error: 'Could not fetch schedule from Procore' }
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  if (!project) return { success: false, error: 'Project not found' }

  // Determine version
  const lastUpload = await prisma.scheduleUpload.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
  })
  const version = (lastUpload?.version ?? 0) + 1

  // Save upload record
  const upload = await prisma.scheduleUpload.create({
    data: {
      projectId,
      fileName: scheduleData.fileName,
      rawText: scheduleData.rawText,
      version,
    },
  })

  // Parse with Claude
  const result = await parseScheduleWithClaude(
    scheduleData.rawText,
    projectId,
    upload.id
  )

  // Send change notifications
  if (version > 1) {
    const newChanges = await prisma.scheduleChange.findMany({
      where: { projectId, notificationsSent: false },
      include: { task: true },
    })
    if (newChanges.length > 0) {
      try {
        await sendScheduleChangeEmails(newChanges, project.name)
        await prisma.scheduleChange.updateMany({
          where: { id: { in: newChanges.map((c) => c.id) } },
          data: { notificationsSent: true },
        })
      } catch (e) {
        console.error('Failed to send change emails:', e)
      }
    }
  }

  // Send alerts
  const alerts = await computeProjectAlerts(projectId)
  const actionable = alerts.filter((a) => ['CRITICAL', 'WARNING'].includes(a.level))
  if (actionable.length > 0) {
    try {
      await sendAlertEmails(actionable, project.name)
    } catch (e) {
      console.error('Failed to send alert emails:', e)
    }
  }

  // Update last sync time
  await prisma.project.update({
    where: { id: projectId },
    data: { procoreLastSync: new Date() },
  })

  return {
    success: true,
    ...result,
  }
}
