import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const changes = await prisma.scheduleChange.findMany({
    where: { projectId: params.id },
    include: { task: true },
    orderBy: { detectedAt: 'desc' },
  })
  return NextResponse.json(changes)
}
