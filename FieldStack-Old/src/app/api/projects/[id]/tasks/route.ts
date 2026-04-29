import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tasks = await prisma.task.findMany({
    where: { projectId: params.id },
    include: { orderItems: true },
    orderBy: { gcInstallDate: 'asc' },
  })
  return NextResponse.json(tasks)
}
