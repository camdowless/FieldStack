import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCompanyId } from '@/lib/session'

export async function GET() {
  const companyId = await requireCompanyId()

  const today = new Date()
  const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)

  const [overdueSteps, upcomingSteps, recentChanges, pendingOrders, projects] = await Promise.all([
    prisma.taskStep.findMany({
      where: {
        project: { companyId },
        status: { not: 'COMPLETE' },
        dueDate: { lt: today },
      },
      include: {
        project: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    prisma.taskStep.findMany({
      where: {
        project: { companyId },
        status: { not: 'COMPLETE' },
        dueDate: { gte: today, lte: weekFromNow },
      },
      include: {
        project: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
    }),
    prisma.scheduleChange.findMany({
      where: {
        project: { companyId },
        detectedAt: { gte: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
      include: {
        project: { select: { name: true } },
        task: { select: { taskName: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: 5,
    }),
    prisma.orderItem.findMany({
      where: {
        project: { companyId },
        status: 'NOT_ORDERED',
        orderByDate: { lte: weekFromNow },
      },
      include: {
        project: { select: { name: true } },
        task: { select: { taskName: true, building: true } },
      },
      orderBy: { orderByDate: 'asc' },
      take: 5,
    }),
    prisma.project.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true },
    }),
  ])

  return NextResponse.json({
    date: today.toISOString().split('T')[0],
    activeProjects: projects.length,
    overdue: overdueSteps.map((s) => ({
      project: s.project.name,
      step: s.stepType,
      building: s.building,
      dueDate: s.dueDate,
      daysOverdue: Math.round((today.getTime() - (s.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24)),
      assignedTo: s.assignedTo?.name,
    })),
    upcoming: upcomingSteps.map((s) => ({
      project: s.project.name,
      step: s.stepType,
      building: s.building,
      dueDate: s.dueDate,
      assignedTo: s.assignedTo?.name,
    })),
    recentChanges: recentChanges.map((c) => ({
      project: c.project.name,
      task: c.task.taskName,
      shiftDays: c.shiftDays,
    })),
    ordersNeeded: pendingOrders.map((o) => ({
      project: o.project.name,
      item: o.itemType,
      orderByDate: o.orderByDate,
      task: o.task.taskName,
      building: o.task.building,
    })),
  })
}
