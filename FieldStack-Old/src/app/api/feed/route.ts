import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCompanyId } from '@/lib/session'

// GET — get feed entries, optionally filtered by project
export async function GET(req: NextRequest) {
  const companyId = await requireCompanyId()
  const projectId = req.nextUrl.searchParams.get('projectId')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30')

  const where: any = { companyId }
  if (projectId) where.projectId = projectId

  const entries = await prisma.feedEntry.findMany({
    where,
    orderBy: { emailDate: 'desc' },
    take: limit,
    include: {
      project: { select: { name: true } },
    },
  })

  return NextResponse.json(entries)
}
