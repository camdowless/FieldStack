import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncProcoreSchedule } from '@/lib/procore'

/**
 * Procore webhook receiver
 * Called when schedule is updated in Procore
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Procore sends a verification challenge on webhook setup
    if (body.challenge) {
      return NextResponse.json({ challenge: body.challenge })
    }

    const { resource_name, event_type, resource_id, project_id } = body

    // Only process schedule-related events
    if (resource_name !== 'Schedule' && resource_name !== 'Tasks') {
      return NextResponse.json({ ignored: true })
    }

    console.log(`Procore webhook: ${resource_name} ${event_type} on project ${project_id}`)

    // Find our project by gcProjectId
    const project = await prisma.project.findFirst({
      where: {
        gcProjectId: String(project_id),
        gcPlatform: 'PROCORE',
        autoSyncEnabled: true,
      },
    })

    if (!project) {
      console.log(`No matching project for Procore project ${project_id}`)
      return NextResponse.json({ ignored: true, reason: 'no matching project' })
    }

    // Debounce: don't sync if last sync was within 5 minutes
    if (project.procoreLastSync) {
      const minutesSinceSync = (Date.now() - project.procoreLastSync.getTime()) / 60000
      if (minutesSinceSync < 5) {
        console.log(`Skipping sync for ${project.name} — last sync ${minutesSinceSync.toFixed(1)} min ago`)
        return NextResponse.json({ debounced: true })
      }
    }

    // Run the full sync pipeline
    const result = await syncProcoreSchedule(project.id)
    console.log(`Procore sync for ${project.name}:`, result)

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('Procore webhook error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
