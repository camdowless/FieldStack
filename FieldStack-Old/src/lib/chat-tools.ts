import { prisma } from './prisma'
import { computeProjectAlerts } from './alerts'
import { fetchRecentEmails } from './gmail'
import { processAndSaveEmails } from './email-classifier'
import type Anthropic from '@anthropic-ai/sdk'

// Tool definitions for Claude's tool_use
export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_projects',
    description: 'List all active projects with their status, GC info, and alert counts.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_project_details',
    description: 'Get full details for a project including tasks, orders, schedule changes, and task steps.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Partial or full project name to search for',
        },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'get_overdue_tasks',
    description: 'Get all overdue task steps across all projects, or for a specific project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Optional project name to filter by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_alerts',
    description: 'Get current alerts (critical, warning, info) for a project or all projects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Optional project name to filter by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_daily_digest',
    description: 'Generate a daily briefing with overdue items, upcoming deadlines, recent schedule changes, and alerts across all projects.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_team_members',
    description: 'List all team members with their roles and notification preferences.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_order_status',
    description: 'Get order items and their status, optionally filtered by project or status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Optional project name to filter by',
        },
        status: {
          type: 'string',
          enum: ['NOT_ORDERED', 'ORDERED', 'IN_TRANSIT', 'DELIVERED'],
          description: 'Optional order status filter',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_schedule_changes',
    description: 'Get recent schedule changes (date shifts) detected across projects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Optional project name to filter by',
        },
        days_back: {
          type: 'number',
          description: 'How many days back to look (default 7)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_workflow_status',
    description: 'Get the 6-step task chain status for a project, showing progress through Shop Drawings → Submissions → Order → Confirm Delivery → Install → Punch List.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'Project name to get workflow for',
        },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'update_task_step',
    description: 'Mark a task step as complete, in progress, or blocked. Use this when the user asks to mark something done, complete a step, or flag something as blocked.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        step_type: {
          type: 'string',
          enum: ['SHOP_DRAWINGS', 'SUBMISSIONS', 'ORDER_MATERIALS', 'CONFIRM_DELIVERY', 'INSTALL', 'PUNCH_LIST'],
          description: 'Which step to update',
        },
        building: { type: 'string', description: 'Building identifier (e.g. "Building 7")' },
        floor: { type: 'string', description: 'Floor identifier (optional)' },
        new_status: {
          type: 'string',
          enum: ['IN_PROGRESS', 'COMPLETE', 'BLOCKED'],
          description: 'New status for the step',
        },
        notes: { type: 'string', description: 'Optional notes to add' },
      },
      required: ['project_name', 'step_type', 'new_status'],
    },
  },
  {
    name: 'update_task_date',
    description: 'Push or pull a task date. Use when the user says "push back", "move forward", "reschedule", or gives a new date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        task_name: { type: 'string', description: 'Task name to search for' },
        building: { type: 'string', description: 'Building (optional)' },
        new_date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
        shift_days: { type: 'number', description: 'Alternative: shift by N days (positive = later, negative = earlier)' },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'assign_step',
    description: 'Assign or reassign a task step to a team member.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        step_type: {
          type: 'string',
          enum: ['SHOP_DRAWINGS', 'SUBMISSIONS', 'ORDER_MATERIALS', 'CONFIRM_DELIVERY', 'INSTALL', 'PUNCH_LIST'],
          description: 'Which step to assign',
        },
        building: { type: 'string', description: 'Building identifier' },
        team_member_name: { type: 'string', description: 'Name of the team member to assign to' },
      },
      required: ['project_name', 'step_type', 'team_member_name'],
    },
  },
  {
    name: 'send_reminder',
    description: 'Send a reminder email to a team member about a specific task. Use when the user says "remind Danny" or "send a nudge".',
    input_schema: {
      type: 'object' as const,
      properties: {
        team_member_name: { type: 'string', description: 'Name of team member to remind' },
        project_name: { type: 'string', description: 'Optional project to filter by' },
        message: { type: 'string', description: 'Optional custom message to include' },
      },
      required: ['team_member_name'],
    },
  },
  {
    name: 'draft_gc_email',
    description: 'Generate a draft email to the general contractor. Use when the user wants to respond to schedule changes, notify about delays, or confirm deliveries.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        type: {
          type: 'string',
          enum: ['schedule_change', 'delay_notice', 'delivery_confirmation'],
          description: 'Type of email to draft',
        },
      },
      required: ['project_name', 'type'],
    },
  },
  {
    name: 'get_email_feed',
    description: 'Get recent email feed entries for a project or all projects. Shows classified emails from the inbox with type, summary, and action items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Optional project name to filter by' },
        type: {
          type: 'string',
          enum: ['SCHEDULE_UPDATE', 'DELIVERY_CONFIRMATION', 'CHANGE_ORDER', 'RFI', 'MEETING_NOTICE', 'GENERAL_COMMUNICATION', 'PAYMENT', 'ISSUE_REPORT'],
          description: 'Optional filter by email type',
        },
        action_needed_only: { type: 'boolean', description: 'Only show emails that need a response' },
      },
      required: [],
    },
  },
  {
    name: 'scan_inbox',
    description: 'Scan the connected Gmail inbox for new emails. Classifies them and matches to projects. Use when the user asks to check email or scan inbox.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hours_back: { type: 'number', description: 'How many hours back to scan (default 24)' },
      },
      required: [],
    },
  },
]

async function findProject(companyId: string, name: string) {
  return prisma.project.findFirst({
    where: {
      companyId,
      name: { contains: name, mode: 'insensitive' },
      status: 'ACTIVE',
    },
  })
}

export async function executeTool(
  toolName: string,
  input: Record<string, any>,
  companyId: string
): Promise<string> {
  switch (toolName) {
    case 'list_projects': {
      const projects = await prisma.project.findMany({
        where: { companyId, status: 'ACTIVE' },
        include: {
          tasks: { select: { id: true } },
          orderItems: { select: { id: true, status: true } },
          taskSteps: { select: { id: true, status: true, stepType: true, dueDate: true } },
        },
      })

      const result = projects.map((p) => ({
        name: p.name,
        address: p.address,
        gcName: p.gcName,
        gcPlatform: p.gcPlatform,
        totalTasks: p.tasks.length,
        pendingOrders: p.orderItems.filter((o) => o.status === 'NOT_ORDERED').length,
        overdueSteps: p.taskSteps.filter(
          (s) => s.status !== 'COMPLETE' && s.dueDate && s.dueDate < new Date()
        ).length,
      }))

      return JSON.stringify(result, null, 2)
    }

    case 'get_project_details': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      const [tasks, orders, changes, steps] = await Promise.all([
        prisma.task.findMany({
          where: { projectId: project.id },
          orderBy: { gcInstallDate: 'asc' },
        }),
        prisma.orderItem.findMany({
          where: { projectId: project.id },
          include: { task: { select: { taskName: true, building: true, floor: true } } },
        }),
        prisma.scheduleChange.findMany({
          where: { projectId: project.id },
          orderBy: { detectedAt: 'desc' },
          take: 10,
          include: { task: { select: { taskName: true } } },
        }),
        prisma.taskStep.findMany({
          where: { projectId: project.id },
          orderBy: { dueDate: 'asc' },
          include: { assignedTo: { select: { name: true } } },
        }),
      ])

      return JSON.stringify({
        project: { name: project.name, address: project.address, gcName: project.gcName, status: project.status },
        tasks: tasks.map((t) => ({
          name: t.taskName, building: t.building, floor: t.floor,
          installDate: t.gcInstallDate, category: t.category, isOurTask: t.isOurTask,
        })),
        orders: orders.map((o) => ({
          item: o.itemType, status: o.status, orderByDate: o.orderByDate,
          task: o.task.taskName, building: o.task.building,
        })),
        recentChanges: changes.map((c) => ({
          task: c.task.taskName, from: c.previousDate, to: c.newDate, shiftDays: c.shiftDays,
        })),
        workflow: steps.map((s) => ({
          step: s.stepType, status: s.status, building: s.building, floor: s.floor,
          dueDate: s.dueDate, assignedTo: s.assignedTo?.name,
        })),
      }, null, 2)
    }

    case 'get_overdue_tasks': {
      const where: any = {
        status: { not: 'COMPLETE' },
        dueDate: { lt: new Date() },
        project: { companyId },
      }
      if (input.project_name) {
        const project = await findProject(companyId, input.project_name)
        if (!project) return `No project found matching "${input.project_name}"`
        where.projectId = project.id
      }

      const overdue = await prisma.taskStep.findMany({
        where,
        include: {
          project: { select: { name: true } },
          assignedTo: { select: { name: true } },
          task: { select: { taskName: true, building: true, floor: true } },
        },
        orderBy: { dueDate: 'asc' },
      })

      return JSON.stringify(overdue.map((s) => ({
        project: s.project.name,
        step: s.stepType,
        status: s.status,
        building: s.building,
        floor: s.floor,
        dueDate: s.dueDate,
        daysOverdue: Math.round((Date.now() - (s.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24)),
        assignedTo: s.assignedTo?.name,
        task: s.task?.taskName,
      })), null, 2)
    }

    case 'get_alerts': {
      const projects = await prisma.project.findMany({
        where: { companyId, status: 'ACTIVE' },
      })

      const targetProjects = input.project_name
        ? projects.filter((p) => p.name.toLowerCase().includes(input.project_name.toLowerCase()))
        : projects

      const allAlerts = []
      for (const p of targetProjects) {
        const alerts = await computeProjectAlerts(p.id)
        allAlerts.push(...alerts.map((a: any) => ({ project: p.name, ...a })))
      }

      allAlerts.sort((a: any, b: any) => {
        const order: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
        return (order[a.level] ?? 3) - (order[b.level] ?? 3)
      })

      return JSON.stringify(allAlerts, null, 2)
    }

    case 'get_daily_digest': {
      const projects = await prisma.project.findMany({
        where: { companyId, status: 'ACTIVE' },
      })

      const today = new Date()
      const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)

      const [overdueSteps, upcomingSteps, recentChanges, pendingOrders] = await Promise.all([
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
        }),
      ])

      return JSON.stringify({
        date: today.toISOString().split('T')[0],
        activeProjects: projects.length,
        overdue: overdueSteps.map((s) => ({
          project: s.project.name, step: s.stepType, dueDate: s.dueDate,
          daysOverdue: Math.round((today.getTime() - (s.dueDate?.getTime() || 0)) / (1000 * 60 * 60 * 24)),
          assignedTo: s.assignedTo?.name,
        })),
        upcomingThisWeek: upcomingSteps.map((s) => ({
          project: s.project.name, step: s.stepType, dueDate: s.dueDate,
          assignedTo: s.assignedTo?.name,
        })),
        recentScheduleChanges: recentChanges.map((c) => ({
          project: c.project.name, task: c.task.taskName,
          shiftDays: c.shiftDays, detectedAt: c.detectedAt,
        })),
        ordersNeedingAttention: pendingOrders.map((o) => ({
          project: o.project.name, item: o.itemType, orderByDate: o.orderByDate,
          task: o.task.taskName, building: o.task.building,
        })),
      }, null, 2)
    }

    case 'get_team_members': {
      const members = await prisma.teamMember.findMany({
        where: { companyId },
        orderBy: { role: 'asc' },
      })
      return JSON.stringify(members.map((m) => ({
        name: m.name, email: m.email, role: m.role,
        notifyOnCritical: m.notifyOnCritical,
        notifyOnOrderReminder: m.notifyOnOrderReminder,
        notifyOnScheduleChange: m.notifyOnScheduleChange,
      })), null, 2)
    }

    case 'get_order_status': {
      const where: any = { project: { companyId } }
      if (input.project_name) {
        const project = await findProject(companyId, input.project_name)
        if (!project) return `No project found matching "${input.project_name}"`
        where.projectId = project.id
      }
      if (input.status) where.status = input.status

      const orders = await prisma.orderItem.findMany({
        where,
        include: {
          project: { select: { name: true } },
          task: { select: { taskName: true, building: true, floor: true } },
        },
        orderBy: { orderByDate: 'asc' },
      })

      return JSON.stringify(orders.map((o) => ({
        project: o.project.name,
        item: o.itemType, status: o.status,
        orderByDate: o.orderByDate, orderedAt: o.orderedAt,
        poNumber: o.poNumber, vendor: o.vendorName,
        task: o.task.taskName, building: o.task.building,
      })), null, 2)
    }

    case 'get_schedule_changes': {
      const daysBack = input.days_back || 7
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)

      const where: any = {
        project: { companyId },
        detectedAt: { gte: since },
      }
      if (input.project_name) {
        const project = await findProject(companyId, input.project_name)
        if (!project) return `No project found matching "${input.project_name}"`
        where.projectId = project.id
      }

      const changes = await prisma.scheduleChange.findMany({
        where,
        include: {
          project: { select: { name: true } },
          task: { select: { taskName: true, building: true, floor: true } },
        },
        orderBy: { detectedAt: 'desc' },
      })

      return JSON.stringify(changes.map((c) => ({
        project: c.project.name,
        task: c.task.taskName, building: c.task.building,
        previousDate: c.previousDate, newDate: c.newDate,
        shiftDays: c.shiftDays, detectedAt: c.detectedAt,
      })), null, 2)
    }

    case 'get_workflow_status': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      const steps = await prisma.taskStep.findMany({
        where: { projectId: project.id },
        include: { assignedTo: { select: { name: true } } },
        orderBy: [{ building: 'asc' }, { floor: 'asc' }, { stepType: 'asc' }],
      })

      // Group by building/floor
      const grouped: Record<string, any[]> = {}
      for (const s of steps) {
        const key = [s.building, s.floor].filter(Boolean).join(' / ') || 'General'
        if (!grouped[key]) grouped[key] = []
        grouped[key].push({
          step: s.stepType, status: s.status,
          dueDate: s.dueDate, completedAt: s.completedAt,
          assignedTo: s.assignedTo?.name,
        })
      }

      return JSON.stringify({ project: project.name, workflows: grouped }, null, 2)
    }

    case 'update_task_step': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      const where: any = {
        projectId: project.id,
        stepType: input.step_type,
      }
      if (input.building) where.building = { contains: input.building, mode: 'insensitive' }
      if (input.floor) where.floor = { contains: input.floor, mode: 'insensitive' }

      const step = await prisma.taskStep.findFirst({ where })
      if (!step) return `No ${input.step_type} step found${input.building ? ` for ${input.building}` : ''}`

      const updateData: any = { status: input.new_status }
      if (input.new_status === 'COMPLETE') updateData.completedAt = new Date()
      if (input.notes) updateData.notes = step.notes ? `${step.notes}\n${input.notes}` : input.notes

      await prisma.taskStep.update({ where: { id: step.id }, data: updateData })

      return JSON.stringify({
        success: true,
        step: input.step_type,
        building: step.building,
        newStatus: input.new_status,
        message: `${input.step_type} for ${step.building || 'project'} marked as ${input.new_status}`,
      })
    }

    case 'update_task_date': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      const where: any = { projectId: project.id }
      if (input.task_name) where.taskName = { contains: input.task_name, mode: 'insensitive' }
      if (input.building) where.building = { contains: input.building, mode: 'insensitive' }

      const task = await prisma.task.findFirst({ where })
      if (!task) return `No task found matching "${input.task_name || 'any'}"`

      let newDate: Date
      if (input.new_date) {
        newDate = new Date(input.new_date)
      } else if (input.shift_days) {
        newDate = new Date(task.gcInstallDate.getTime() + input.shift_days * 24 * 60 * 60 * 1000)
      } else {
        return 'Provide either new_date or shift_days'
      }

      const oldDate = task.gcInstallDate
      await prisma.task.update({ where: { id: task.id }, data: { gcInstallDate: newDate } })

      return JSON.stringify({
        success: true,
        task: task.taskName,
        building: task.building,
        oldDate: oldDate.toISOString().split('T')[0],
        newDate: newDate.toISOString().split('T')[0],
        shiftDays: Math.round((newDate.getTime() - oldDate.getTime()) / (1000 * 60 * 60 * 24)),
      })
    }

    case 'assign_step': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      const member = await prisma.teamMember.findFirst({
        where: {
          companyId,
          name: { contains: input.team_member_name, mode: 'insensitive' },
        },
      })
      if (!member) return `No team member found matching "${input.team_member_name}"`

      const where: any = { projectId: project.id, stepType: input.step_type }
      if (input.building) where.building = { contains: input.building, mode: 'insensitive' }

      const step = await prisma.taskStep.findFirst({ where })
      if (!step) return `No ${input.step_type} step found`

      await prisma.taskStep.update({ where: { id: step.id }, data: { assignedToId: member.id } })

      return JSON.stringify({
        success: true,
        step: input.step_type,
        building: step.building,
        assignedTo: member.name,
        message: `${input.step_type} assigned to ${member.name}`,
      })
    }

    case 'send_reminder': {
      const member = await prisma.teamMember.findFirst({
        where: {
          companyId,
          name: { contains: input.team_member_name, mode: 'insensitive' },
        },
      })
      if (!member) return `No team member found matching "${input.team_member_name}"`

      // Find their overdue/upcoming steps
      const steps = await prisma.taskStep.findMany({
        where: {
          assignedToId: member.id,
          status: { not: 'COMPLETE' },
          ...(input.project_name ? {
            project: { name: { contains: input.project_name, mode: 'insensitive' } },
          } : {}),
        },
        include: { project: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 5,
      })

      if (steps.length === 0) return `${member.name} has no pending tasks`

      // Log the reminder (actual email sending requires Resend config)
      console.log(`[reminder] Would send to ${member.email}: ${steps.length} pending tasks`)

      return JSON.stringify({
        success: true,
        sentTo: member.name,
        email: member.email,
        pendingTasks: steps.map((s) => ({
          project: s.project.name,
          step: s.stepType,
          building: s.building,
          dueDate: s.dueDate,
        })),
        message: input.message || `Reminder: you have ${steps.length} pending task(s)`,
        note: 'Email logged to console (configure Resend API key for actual delivery)',
      })
    }

    case 'draft_gc_email': {
      const project = await findProject(companyId, input.project_name)
      if (!project) return `No project found matching "${input.project_name}"`

      // Call the draft API internally
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const aiClient = new Anthropic({ timeout: 30000 })

      const fullProject = await prisma.project.findUnique({
        where: { id: project.id },
        include: {
          scheduleChanges: {
            orderBy: { detectedAt: 'desc' },
            take: 10,
            include: { task: { select: { taskName: true, building: true } } },
          },
        },
      })

      if (!fullProject) return 'Project not found'

      let prompt = ''
      if (input.type === 'schedule_change') {
        const changes = fullProject.scheduleChanges
        const changeText = changes.map((c) =>
          `${c.task.taskName} (${c.task.building || ''}): ${new Date(c.previousDate).toLocaleDateString()} → ${new Date(c.newDate).toLocaleDateString()} (${c.shiftDays > 0 ? '+' : ''}${c.shiftDays}d)`
        ).join('\n')

        prompt = `Draft a brief email from a cabinet/countertop sub to the GC about schedule changes. Project: ${fullProject.name}, GC: ${fullProject.gcName}, Contact: ${fullProject.gcContact || 'Superintendent'}. Changes:\n${changeText}\nKeep under 100 words. Professional but not stiff. Return only the email body.`
      } else if (input.type === 'delay_notice') {
        prompt = `Draft a brief delay notice email from a sub to the GC. Project: ${fullProject.name}, GC: ${fullProject.gcName}. Materials delayed. Under 80 words. Return only the body.`
      } else {
        prompt = `Draft a brief delivery confirmation email from a sub to the GC. Project: ${fullProject.name} at ${fullProject.address}. Under 50 words. Return only the body.`
      }

      const msg = await aiClient.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      })

      const draft = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')

      return JSON.stringify({
        draft,
        to: fullProject.gcEmail || '(no GC email on file)',
        toName: fullProject.gcContact || fullProject.gcName,
        subject: input.type === 'schedule_change'
          ? `Re: ${fullProject.name} — Schedule Update`
          : input.type === 'delay_notice'
            ? `${fullProject.name} — Delay Notice`
            : `${fullProject.name} — Delivery Confirmation`,
      }, null, 2)
    }

    case 'get_email_feed': {
      const where: any = { companyId }
      if (input.project_name) {
        const project = await findProject(companyId, input.project_name)
        if (project) where.projectId = project.id
      }
      if (input.type) where.type = input.type
      if (input.action_needed_only) where.actionNeeded = true

      const entries = await prisma.feedEntry.findMany({
        where,
        orderBy: { emailDate: 'desc' },
        take: 20,
        include: { project: { select: { name: true } } },
      })

      if (entries.length === 0) return 'No email feed entries found. Gmail may not be connected, or no emails have been scanned yet.'

      return JSON.stringify(entries.map((e) => ({
        type: e.type,
        title: e.title,
        summary: e.summary,
        sender: e.sender,
        date: e.emailDate,
        project: e.project?.name,
        actionNeeded: e.actionNeeded,
        actionType: e.actionType,
      })), null, 2)
    }

    case 'scan_inbox': {
      const connection = await prisma.gmailConnection.findUnique({ where: { companyId } })
      if (!connection) return 'Gmail is not connected. Go to a project Feed tab and click "Connect Gmail" to set it up.'

      const hoursBack = input.hours_back || 24
      try {
        const emails = await fetchRecentEmails(companyId, hoursBack)
        if (emails.length === 0) return `No emails found in the last ${hoursBack} hours.`

        const result = await processAndSaveEmails(emails, companyId)
        return JSON.stringify({
          message: `Scanned ${result.processed} emails. ${result.saved} new entries added, ${result.skipped} already processed.`,
          ...result,
        })
      } catch (e: any) {
        return `Failed to scan inbox: ${e.message}`
      }
    }

    default:
      return `Unknown tool: ${toolName}`
  }
}
