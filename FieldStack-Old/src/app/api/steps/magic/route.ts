import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyMagicToken } from '@/lib/magic-link'

// GET — verify token and return step info (no auth required)
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const payload = await verifyMagicToken(token)
  if (!payload) return NextResponse.json({ error: 'Link expired or invalid' }, { status: 401 })

  const step = await prisma.taskStep.findUnique({
    where: { id: payload.stepId },
    include: {
      project: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
  })

  if (!step) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (step.status === 'COMPLETE') {
    return NextResponse.json({ error: 'This task is already complete' }, { status: 410 })
  }

  return NextResponse.json({
    stepType: step.stepType,
    building: step.building,
    floor: step.floor,
    dueDate: step.dueDate,
    projectName: step.project.name,
    assignedTo: step.assignedTo?.name,
    status: step.status,
    notes: step.notes,
  })
}

// POST — apply action (no auth required, token is the auth)
export async function POST(req: NextRequest) {
  const { token, action, note } = await req.json()

  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const payload = await verifyMagicToken(token)
  if (!payload) return NextResponse.json({ error: 'Link expired or invalid' }, { status: 401 })

  const step = await prisma.taskStep.findUnique({ where: { id: payload.stepId } })
  if (!step) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  if (step.status === 'COMPLETE') return NextResponse.json({ error: 'Already complete' }, { status: 410 })

  const updateData: any = {}

  if (action === 'complete') {
    updateData.status = 'COMPLETE'
    updateData.completedAt = new Date()
  } else if (action === 'block') {
    updateData.status = 'BLOCKED'
  }

  if (note) {
    updateData.notes = step.notes ? `${step.notes}\n---\n${note}` : note
  }

  await prisma.taskStep.update({
    where: { id: payload.stepId },
    data: updateData,
  })

  return NextResponse.json({ success: true })
}
