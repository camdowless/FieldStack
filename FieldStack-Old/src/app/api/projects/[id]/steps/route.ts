import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const steps = await prisma.taskStep.findMany({
    where: { projectId: params.id },
    include: {
      task: { select: { taskName: true, building: true, floor: true, gcInstallDate: true, category: true } },
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      dependsOn: { select: { id: true, stepType: true, status: true, completedAt: true } },
    },
    orderBy: [{ building: 'asc' }, { floor: 'asc' }, { createdAt: 'asc' }],
  })

  const now = new Date()
  const enriched = steps.map((step) => ({
    ...step,
    isOverdue: step.dueDate != null && step.dueDate < now && step.status !== 'COMPLETE',
  }))

  return NextResponse.json(enriched)
}
