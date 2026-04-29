import { prisma } from './prisma'
import { OrderStatus, ItemType } from '@prisma/client'
import { differenceInDays, isPast, isWithinInterval, addDays } from 'date-fns'

export type AlertLevel = 'CRITICAL' | 'WARNING' | 'INFO' | 'ON_TRACK' | 'VERIFY'

export interface Alert {
  id: string
  level: AlertLevel
  title: string
  detail: string
  projectId: string
  projectName: string
  taskId: string
  orderItemId?: string
  installDate: Date
  orderByDate: Date
  orderStatus: OrderStatus
  building?: string | null
  floor?: string | null
  itemType: ItemType
  daysUntilOrderBy: number
}

export function getAlertLevel(orderByDate: Date, status: OrderStatus): AlertLevel {
  if (status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED) return 'ON_TRACK'
  if (status === OrderStatus.IN_TRANSIT) return 'VERIFY'
  if (status === OrderStatus.ORDERED) return 'VERIFY'

  const today = new Date()
  const days = differenceInDays(orderByDate, today)

  if (days < 0) return 'CRITICAL'
  if (days <= 14) return 'WARNING'
  if (days <= 30) return 'INFO'
  return 'ON_TRACK'
}

export async function computeProjectAlerts(projectId: string): Promise<Alert[]> {
  const orderItems = await prisma.orderItem.findMany({
    where: { projectId },
    include: {
      task: true,
      project: { select: { name: true } },
    },
    orderBy: { orderByDate: 'asc' },
  })

  return orderItems.map((item) => {
    const level = getAlertLevel(item.orderByDate, item.status)
    const daysUntilOrderBy = differenceInDays(item.orderByDate, new Date())

    const itemLabel = {
      CABINETS_STANDARD: 'Cabinet order (standard)',
      CABINETS_CUSTOM: 'Cabinet order (custom)',
      COUNTERTOPS: 'Countertop order',
      HARDWARE: 'Hardware order',
    }[item.itemType]

    const location = [item.task.building, item.task.floor].filter(Boolean).join(' – ')

    const title =
      level === 'CRITICAL'
        ? `${itemLabel} OVERDUE — ${location}`
        : level === 'WARNING'
        ? `${itemLabel} due soon — ${location}`
        : `${itemLabel} upcoming — ${location}`

    const detail = `Install: ${item.task.gcInstallDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · Order by: ${item.orderByDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · Status: ${item.status.replace(/_/g, ' ')}`

    return {
      id: item.id,
      level,
      title,
      detail,
      projectId,
      projectName: item.project.name,
      taskId: item.taskId,
      orderItemId: item.id,
      installDate: item.task.gcInstallDate,
      orderByDate: item.orderByDate,
      orderStatus: item.status,
      building: item.task.building,
      floor: item.task.floor,
      itemType: item.itemType,
      daysUntilOrderBy,
    }
  })
}

export async function computeAllAlerts(): Promise<Alert[]> {
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  })

  const allAlerts = await Promise.all(projects.map((p) => computeProjectAlerts(p.id)))
  return allAlerts.flat().sort((a, b) => {
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2, VERIFY: 3, ON_TRACK: 4 }
    return order[a.level] - order[b.level]
  })
}
