import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const settings = await prisma.leadTimeSetting.findMany({
    where: { isDefault: true, projectId: null },
    orderBy: { itemType: 'asc' },
  })
  return NextResponse.json(settings)
}

export async function PATCH(req: NextRequest) {
  const settings = await req.json()
  const updated = await Promise.all(
    settings.map((s: any) =>
      prisma.leadTimeSetting.update({
        where: { id: s.id },
        data: { leadTimeWeeks: s.leadTimeWeeks },
      })
    )
  )
  return NextResponse.json(updated)
}
