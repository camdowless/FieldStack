import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncProcoreSchedule } from '@/lib/procore'

/**
 * Nightly cron: sync all Procore-connected projects
 * Runs at 6am CT (11:00 UTC) via Vercel Cron
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projects = await prisma.project.findMany({
    where: {
      gcPlatform: 'PROCORE',
      autoSyncEnabled: true,
      procoreAccessToken: { not: null },
      status: 'ACTIVE',
    },
  })

  console.log(`Procore nightly sync: ${projects.length} projects`)

  const results = []
  for (const project of projects) {
    try {
      const result = await syncProcoreSchedule(project.id)
      results.push({ projectId: project.id, name: project.name, ...result })
    } catch (e: any) {
      results.push({ projectId: project.id, name: project.name, success: false, error: e.message })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
