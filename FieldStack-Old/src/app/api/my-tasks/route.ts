import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')

  const where: any = {}

  if (email) {
    const member = await prisma.teamMember.findUnique({ where: { email } })
    if (!member) return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
    where.assignedToId = member.id
  }

  // Exclude completed steps unless explicitly requested
  const includeComplete = req.nextUrl.searchParams.get('includeComplete') === 'true'
  if (!includeComplete) {
    where.status = { not: 'COMPLETE' }
  }

  const steps = await prisma.taskStep.findMany({
    where,
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { taskName: true, gcInstallDate: true } },
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      dependsOn: { select: { id: true, stepType: true, status: true } },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  })

  // Compute overdue flag at read time
  const now = new Date()
  const enriched = steps.map((step) => ({
    ...step,
    isOverdue: step.dueDate != null && step.dueDate < now && step.status !== 'COMPLETE',
  }))

  return NextResponse.json(enriched)
}
