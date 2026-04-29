import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendSms, twilioConfigured } from '@/lib/sms'

export async function POST(req: NextRequest) {
  const companies = await prisma.company.findMany({
    include: {
      users: { where: { role: 'ADMIN' }, select: { email: true, name: true } },
    },
  })

  let sent = 0

  for (const company of companies) {
    // Get the owner's phone from settings (or skip if not configured)
    // For now, we'll look for a OWNER_PHONE env var or team member with OWNER role
    const owner = await prisma.teamMember.findFirst({
      where: { companyId: company.id, role: 'OWNER' },
    })

    // Use env var as fallback for the owner's phone
    const phone = process.env.OWNER_PHONE || null
    if (!phone) continue

    const today = new Date()
    const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)

    const [overdueSteps, upcomingToday, ordersNeeded] = await Promise.all([
      prisma.taskStep.findMany({
        where: { project: { companyId: company.id }, status: { not: 'COMPLETE' }, dueDate: { lt: today } },
        include: { project: { select: { name: true } }, assignedTo: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 3,
      }),
      prisma.taskStep.findMany({
        where: {
          project: { companyId: company.id },
          status: { not: 'COMPLETE' },
          dueDate: {
            gte: new Date(today.setHours(0, 0, 0, 0)),
            lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
        },
        include: { project: { select: { name: true } }, assignedTo: { select: { name: true } } },
        take: 3,
      }),
      prisma.orderItem.findMany({
        where: {
          project: { companyId: company.id },
          status: 'NOT_ORDERED',
          orderByDate: { lte: weekFromNow },
        },
        include: { task: { select: { taskName: true, building: true } } },
        take: 2,
      }),
    ])

    // Build concise SMS (160 char target per item)
    const items: string[] = []

    for (const s of overdueSteps) {
      const who = s.assignedTo?.name?.split(' ')[0] || '?'
      const days = Math.round((Date.now() - (s.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24))
      items.push(`${who}: ${s.stepType.replace(/_/g, ' ')} ${s.building || ''} ${days}d overdue`)
    }

    for (const s of upcomingToday) {
      const who = s.assignedTo?.name?.split(' ')[0] || '?'
      items.push(`${who}: ${s.stepType.replace(/_/g, ' ')} ${s.building || ''} DUE TODAY`)
    }

    for (const o of ordersNeeded) {
      items.push(`Order ${o.itemType.replace(/_/g, ' ')} for ${o.task.building || 'project'} by ${new Date(o.orderByDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
    }

    if (items.length === 0) continue

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const body = `FieldStack AM:\n${items.slice(0, 3).map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n${APP_URL}/dashboard`

    await sendSms(phone, body)
    sent++
  }

  return NextResponse.json({
    sent,
    twilioConfigured,
    timestamp: new Date().toISOString(),
  })
}
