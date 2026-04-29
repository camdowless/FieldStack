import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { syncProcoreSchedule } from '@/lib/procore'

/**
 * Manual trigger: sync schedule from Procore for this project
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (project.gcPlatform !== 'PROCORE') {
    return NextResponse.json({ error: 'Project is not connected to Procore' }, { status: 400 })
  }

  if (!project.procoreAccessToken) {
    return NextResponse.json({ error: 'Procore not authenticated. Connect via Settings.' }, { status: 400 })
  }

  const result = await syncProcoreSchedule(params.id)
  return NextResponse.json(result)
}
