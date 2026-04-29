import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { onStepComplete } from '@/lib/chain-generator'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()
  const { status, notes, assignedToId, dueDate } = body

  const data: any = {}
  if (status !== undefined) data.status = status
  if (notes !== undefined) data.notes = notes
  if (assignedToId !== undefined) data.assignedToId = assignedToId
  if (dueDate !== undefined) data.dueDate = new Date(dueDate)

  // If marking complete, set completedAt
  if (status === 'COMPLETE') {
    data.completedAt = new Date()
  }

  const step = await prisma.taskStep.update({
    where: { id: params.id },
    data,
    include: {
      assignedTo: { select: { name: true, email: true } },
      project: { select: { name: true } },
    },
  })

  // If completed, trigger downstream step logic
  if (status === 'COMPLETE') {
    await onStepComplete(step.id)
  }

  return NextResponse.json(step)
}
