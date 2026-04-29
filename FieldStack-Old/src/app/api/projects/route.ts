import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { computeProjectAlerts } from '@/lib/alerts'
import { getCompanyId } from '@/lib/session'

export async function GET() {
  const companyId = await getCompanyId()

  const projects = await prisma.project.findMany({
    where: companyId ? { companyId } : {},
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { tasks: true, orderItems: true, scheduleChanges: true } },
      scheduleUploads: { orderBy: { uploadedAt: 'desc' }, take: 1 },
    },
  })

  const withAlerts = await Promise.all(
    projects.map(async (p) => {
      const alerts = await computeProjectAlerts(p.id)
      const critical = alerts.filter((a) => a.level === 'CRITICAL').length
      const warning = alerts.filter((a) => a.level === 'WARNING').length
      return { ...p, alertCounts: { critical, warning } }
    })
  )

  return NextResponse.json(withAlerts)
}

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId()
  const body = await req.json()
  const { name, address, gcName, gcContact, gcEmail } = body

  if (!name || !address || !gcName) {
    return NextResponse.json({ error: 'name, address, gcName required' }, { status: 400 })
  }

  const project = await prisma.project.create({
    data: { companyId: companyId || 'default', name, address, gcName, gcContact, gcEmail },
  })

  return NextResponse.json(project, { status: 201 })
}
