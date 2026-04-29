import { prisma } from './prisma'
import { StepType, StepTrack, StepStatus, TeamRole } from '@prisma/client'
import { subWeeks, addBusinessDays, addDays } from 'date-fns'

// Maps StepType to the TeamRole that should own it
const STEP_ROLE_MAP: Record<StepType, TeamRole> = {
  SHOP_DRAWINGS: TeamRole.DRAFTING,
  SUBMISSIONS: TeamRole.DRAFTING,
  ORDER_MATERIALS: TeamRole.PURCHASING,
  CONFIRM_DELIVERY: TeamRole.PURCHASING,
  INSTALL: TeamRole.INSTALLER,
  PUNCH_LIST: TeamRole.SUPERVISOR,
}

// Default lead times for computing step due dates (in business days unless noted)
const STEP_DEFAULTS = {
  submissionsAfterDrawings: 5, // business days after shop drawings approved
  confirmBeforeInstall: 7,     // calendar days before install
  punchAfterInstall: 3,        // calendar days after install
}

interface ChainInput {
  projectId: string
  building: string | null
  floor: string | null
  taskId: string          // the parsed CKF task id
  installDate: Date
  leadTimeWeeks: number   // for order-by calculation
}

/**
 * Generate a 6-step task chain for a building/floor unit.
 * Steps 1-2 (CONTRACT track): Shop Drawings + Submissions — manual dates
 * Steps 3-6 (SCHEDULE track): Order, Confirm, Install, Punch — computed from install date
 */
export async function generateTaskChain(input: ChainInput): Promise<string[]> {
  const { projectId, building, floor, taskId, installDate, leadTimeWeeks } = input

  // Find team members by role for auto-assignment
  const teamMembers = await prisma.teamMember.findMany()
  const roleMap = new Map<TeamRole, string>()
  for (const member of teamMembers) {
    // First member found for each role wins (owner can reassign later)
    if (!roleMap.has(member.role)) {
      roleMap.set(member.role, member.id)
    }
  }

  function assigneeFor(stepType: StepType): string | null {
    const role = STEP_ROLE_MAP[stepType]
    return roleMap.get(role) ?? null
  }

  // Compute schedule-driven dates
  const orderByDate = subWeeks(installDate, leadTimeWeeks)
  const confirmByDate = addDays(installDate, -STEP_DEFAULTS.confirmBeforeInstall)
  const punchDate = addDays(installDate, STEP_DEFAULTS.punchAfterInstall)

  const stepIds: string[] = []

  // Step 1: Shop Drawings (CONTRACT track, no due date — set manually)
  const shopDrawings = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.SHOP_DRAWINGS,
      assignedToId: assigneeFor(StepType.SHOP_DRAWINGS),
      dueDate: null, // contract-triggered, set manually
      status: StepStatus.PENDING,
      track: StepTrack.CONTRACT,
    },
  })
  stepIds.push(shopDrawings.id)

  // Step 2: Submissions (CONTRACT track, depends on Step 1)
  const submissions = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.SUBMISSIONS,
      assignedToId: assigneeFor(StepType.SUBMISSIONS),
      dueDate: null, // computed when Step 1 completes
      status: StepStatus.PENDING,
      track: StepTrack.CONTRACT,
      dependsOnId: shopDrawings.id,
    },
  })
  stepIds.push(submissions.id)

  // Step 3: Order Materials (SCHEDULE track, computed from install date)
  const orderMaterials = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.ORDER_MATERIALS,
      assignedToId: assigneeFor(StepType.ORDER_MATERIALS),
      dueDate: orderByDate,
      status: StepStatus.PENDING,
      track: StepTrack.SCHEDULE,
    },
  })
  stepIds.push(orderMaterials.id)

  // Step 4: Confirm Delivery (SCHEDULE track, depends on Step 3)
  const confirmDelivery = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.CONFIRM_DELIVERY,
      assignedToId: assigneeFor(StepType.CONFIRM_DELIVERY),
      dueDate: confirmByDate,
      status: StepStatus.PENDING,
      track: StepTrack.SCHEDULE,
      dependsOnId: orderMaterials.id,
    },
  })
  stepIds.push(confirmDelivery.id)

  // Step 5: Install (SCHEDULE track, depends on Step 4)
  const install = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.INSTALL,
      assignedToId: assigneeFor(StepType.INSTALL),
      dueDate: installDate,
      status: StepStatus.PENDING,
      track: StepTrack.SCHEDULE,
      dependsOnId: confirmDelivery.id,
    },
  })
  stepIds.push(install.id)

  // Step 6: Punch List (SCHEDULE track, depends on Step 5)
  const punchList = await prisma.taskStep.create({
    data: {
      projectId,
      taskId,
      building,
      floor,
      stepType: StepType.PUNCH_LIST,
      assignedToId: assigneeFor(StepType.PUNCH_LIST),
      dueDate: punchDate,
      status: StepStatus.PENDING,
      track: StepTrack.SCHEDULE,
      dependsOnId: install.id,
    },
  })
  stepIds.push(punchList.id)

  return stepIds
}

/**
 * When a step is marked complete, compute due dates for dependent steps.
 */
export async function onStepComplete(stepId: string): Promise<void> {
  const step = await prisma.taskStep.findUnique({ where: { id: stepId } })
  if (!step || step.status !== 'COMPLETE') return

  // Find steps that depend on this one
  const dependents = await prisma.taskStep.findMany({
    where: { dependsOnId: stepId },
  })

  for (const dep of dependents) {
    // If this was SHOP_DRAWINGS completing, set SUBMISSIONS due date
    if (step.stepType === StepType.SHOP_DRAWINGS && dep.stepType === StepType.SUBMISSIONS) {
      const dueDate = addBusinessDays(step.completedAt ?? new Date(), STEP_DEFAULTS.submissionsAfterDrawings)
      await prisma.taskStep.update({
        where: { id: dep.id },
        data: { dueDate, status: StepStatus.IN_PROGRESS },
      })
    }

    // For other dependencies, just unblock (move from PENDING to IN_PROGRESS if still PENDING)
    if (dep.status === StepStatus.PENDING) {
      await prisma.taskStep.update({
        where: { id: dep.id },
        data: { status: StepStatus.IN_PROGRESS },
      })
    }
  }
}

/**
 * When a GC schedule shifts, recalculate all SCHEDULE-track step due dates
 * for the affected building/floor.
 */
export async function recalculateChainDates(
  projectId: string,
  building: string | null,
  floor: string | null,
  newInstallDate: Date,
  leadTimeWeeks: number
): Promise<string[]> {
  const affectedSteps = await prisma.taskStep.findMany({
    where: {
      projectId,
      building,
      floor,
      track: StepTrack.SCHEDULE,
      status: { not: StepStatus.COMPLETE },
    },
  })

  const updatedIds: string[] = []
  const orderByDate = subWeeks(newInstallDate, leadTimeWeeks)
  const confirmByDate = addDays(newInstallDate, -STEP_DEFAULTS.confirmBeforeInstall)
  const punchDate = addDays(newInstallDate, STEP_DEFAULTS.punchAfterInstall)

  const dateMap: Record<StepType, Date | null> = {
    SHOP_DRAWINGS: null,
    SUBMISSIONS: null,
    ORDER_MATERIALS: orderByDate,
    CONFIRM_DELIVERY: confirmByDate,
    INSTALL: newInstallDate,
    PUNCH_LIST: punchDate,
  }

  for (const step of affectedSteps) {
    const newDate = dateMap[step.stepType]
    if (newDate && step.dueDate?.getTime() !== newDate.getTime()) {
      await prisma.taskStep.update({
        where: { id: step.id },
        data: { dueDate: newDate },
      })
      updatedIds.push(step.id)
    }
  }

  return updatedIds
}
