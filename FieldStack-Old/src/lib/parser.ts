import { prisma } from './prisma'
import { TaskCategory, ItemType, OrderStatus } from '@prisma/client'
import { subWeeks } from 'date-fns'
import { generateTaskChain, recalculateChainDates } from './chain-generator'
import { createMessage } from './anthropic'

async function companyIdForProject(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { companyId: true },
  })
  return project.companyId
}

// Claude vision extracts the same building with inconsistent casing across pages
// ("Building 7" vs "BUILDING 7"). Normalize so dedup + diff matching treats them
// as the same. Applied at save-time so DB is canonical, and at dedup-key time.
function normalizeLabel(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.replace(/\b([a-zA-Z])([a-zA-Z]*)/g, (_, first, rest) =>
    first.toUpperCase() + rest.toLowerCase(),
  )
}

interface ParsedTask {
  taskIdOriginal?: string
  taskName: string
  building?: string
  floor?: string
  startDate: string
  endDate?: string
  assignedResource?: string
  isOurTask: boolean
}

const SYSTEM_PROMPT = `You are a construction schedule parser for a cabinet and countertop subcontractor.

Extract ALL tasks from this construction schedule page. Include every trade — nothing should be skipped.

For each task, set "isOurTask" to true ONLY if the task is related to cabinets, countertops, or backsplash (assigned to CKF, BAM, or explicitly mentions cabinets/countertops). All other tasks should have "isOurTask" false.

CRITICAL: You MUST extract the start and end dates for every task. Look at the column headers to identify which columns contain dates. Dates may appear as "Apr 1", "04/01/26", "Mar 23, 2026", or as date ranges in Gantt-style bars. Normalize all dates to YYYY-MM-DD format. If the year is not shown, infer it from context (header, title, or assume current/next year). Tasks without any identifiable date should still be included with startDate set to the best estimate.

Return ONLY a valid JSON array. No prose, no markdown fences, no explanation.

Each object: {"taskIdOriginal":"ID or null","taskName":"exact name","building":"Building X or null","floor":"Floor Y or null","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD or null","assignedResource":"company or null","isOurTask":false}`

function categorizeTask(taskName: string, resource: string | null): TaskCategory {
  const name = taskName.toLowerCase()
  const res = (resource || '').toLowerCase()

  if (name.includes('cabinet') && name.includes('deliver')) return TaskCategory.CABINET_DELIVERY
  if (name.includes('cabinet') && name.includes('install')) return TaskCategory.CABINET_INSTALL
  if (name.includes('countertop') || name.includes('backsplash') || name.includes('set counter')) return TaskCategory.COUNTERTOP_SET
  if (res === 'ckf') {
    if (name.includes('deliver')) return TaskCategory.CABINET_DELIVERY
    if (name.includes('set') || name.includes('counter')) return TaskCategory.COUNTERTOP_SET
  }
  return TaskCategory.OTHER
}

async function getLeadTimeWeeks(itemType: ItemType, projectId: string): Promise<number> {
  const override = await prisma.leadTimeSetting.findFirst({
    where: { itemType, projectId },
  })
  if (override) return override.leadTimeWeeks

  const global = await prisma.leadTimeSetting.findFirst({
    where: { itemType, projectId: null },
  })
  return global?.leadTimeWeeks ?? 8
}

// ── PDF Vision: page-by-page extraction ───────────────────────────────────

async function extractTasksFromPage(
  pdfBuffer: Buffer,
  pageNum: number,
  totalPages: number,
  companyId: string,
): Promise<ParsedTask[]> {
  const base64 = pdfBuffer.toString('base64')

  console.log(`[parser] Processing page ${pageNum}/${totalPages} via vision...`)

  const message = await createMessage({
    companyId,
    action: 'parse_schedule_page',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: `Extract ALL tasks from page ${pageNum} of this construction schedule. Look carefully at the table columns — identify the date columns from the headers and extract the correct start/end dates for each task row. Return the JSON array.`,
          },
        ],
      },
    ],
  })

  const responseText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const cleaned = responseText.replace(/```json|```/g, '').trim()

  try {
    const tasks = JSON.parse(cleaned)
    console.log(`[parser] Page ${pageNum}: extracted ${tasks.length} tasks`)
    return tasks
  } catch {
    console.warn(`[parser] Page ${pageNum}: invalid JSON, skipping. Response: ${cleaned.slice(0, 200)}`)
    return []
  }
}

export async function parseScheduleWithVision(
  pdfBuffer: Buffer,
  projectId: string,
  scheduleUploadId: string
): Promise<{ tasksCreated: number; orderItemsCreated: number; chainsCreated: number }> {

  // Detect page count using PDF header (rough estimate from file structure)
  // For accuracy, we send the whole PDF each time but ask for a specific page.
  // Claude's document block handles multi-page PDFs natively.

  // First, ask Claude how many pages and get page 1
  const base64 = pdfBuffer.toString('base64')
  const companyId = await companyIdForProject(projectId)

  console.log('[parser] Starting page-by-page vision extraction...')

  const countMessage = await createMessage({
    companyId,
    action: 'parse_schedule_page_count',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: 'How many pages does this PDF have? Reply with ONLY the number.',
          },
        ],
      },
    ],
  })

  const countText = countMessage.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  const pageCount = parseInt(countText) || 1
  console.log(`[parser] PDF has ${pageCount} pages`)

  // Process pages in parallel batches of 3 to balance speed vs API rate limits
  const allTasks: ParsedTask[] = []
  const batchSize = 3

  for (let i = 0; i < pageCount; i += batchSize) {
    const batch = []
    for (let j = i; j < Math.min(i + batchSize, pageCount); j++) {
      batch.push(extractTasksFromPage(pdfBuffer, j + 1, pageCount, companyId))
    }
    const results = await Promise.all(batch)
    for (const pageTasks of results) {
      allTasks.push(...pageTasks)
    }
  }

  // Deduplicate tasks that might appear on multiple pages. Normalize building/floor
  // so "Building 7" and "BUILDING 7" are treated as the same.
  const seen = new Set<string>()
  const uniqueTasks = allTasks.filter((t) => {
    const key = `${t.taskName}|${normalizeLabel(t.building) || ''}|${normalizeLabel(t.floor) || ''}|${t.startDate || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`[parser] Total: ${allTasks.length} raw → ${uniqueTasks.length} unique tasks`)

  return saveParsedTasks(uniqueTasks, projectId, scheduleUploadId)
}

// ── Text-based parser (for CSV, XLSX, plain text) ─────────────────────────

export async function parseScheduleWithClaude(
  rawText: string,
  projectId: string,
  scheduleUploadId: string
): Promise<{ tasksCreated: number; orderItemsCreated: number; chainsCreated: number }> {

  // For large text, chunk it to avoid token limits
  const MAX_CHUNK = 12000
  const allTasks: ParsedTask[] = []
  const companyId = await companyIdForProject(projectId)

  if (rawText.length <= MAX_CHUNK) {
    const tasks = await callClaudeText(rawText, companyId)
    allTasks.push(...tasks)
  } else {
    // Split by page markers or chunk by size
    const pages = rawText.split(/===\s*Page\s+\d+.*?===/)
      .filter((p) => p.trim().length > 50)

    if (pages.length > 1) {
      // Process each page section
      for (let i = 0; i < pages.length; i++) {
        console.log(`[parser] Processing text chunk ${i + 1}/${pages.length}...`)
        const tasks = await callClaudeText(pages[i], companyId)
        allTasks.push(...tasks)
      }
    } else {
      // No page markers — chunk by size
      for (let i = 0; i < rawText.length; i += MAX_CHUNK) {
        const chunk = rawText.slice(i, i + MAX_CHUNK)
        console.log(`[parser] Processing text chunk ${Math.floor(i / MAX_CHUNK) + 1}...`)
        const tasks = await callClaudeText(chunk, companyId)
        allTasks.push(...tasks)
      }
    }
  }

  // Deduplicate (case-insensitive on building/floor)
  const seen = new Set<string>()
  const uniqueTasks = allTasks.filter((t) => {
    const key = `${t.taskName}|${normalizeLabel(t.building) || ''}|${normalizeLabel(t.floor) || ''}|${t.startDate || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`[parser] Total: ${allTasks.length} raw → ${uniqueTasks.length} unique tasks`)

  return saveParsedTasks(uniqueTasks, projectId, scheduleUploadId)
}

async function callClaudeText(text: string, companyId: string): Promise<ParsedTask[]> {
  const message = await createMessage({
    companyId,
    action: 'parse_schedule_text',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Parse this construction schedule and return the JSON array:\n\n${text}`,
      },
    ],
    system: SYSTEM_PROMPT,
  })

  let responseText = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  if (message.stop_reason === 'max_tokens') {
    console.warn('[parser] Response truncated — salvaging partial JSON')
    responseText = responseText.replace(/,\s*$/, '')
    const openBraces = (responseText.match(/{/g) || []).length
    const closeBraces = (responseText.match(/}/g) || []).length
    responseText += '}'.repeat(Math.max(0, openBraces - closeBraces))
    if (!responseText.trimEnd().endsWith(']')) responseText += ']'
  }

  const cleaned = responseText.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    console.warn('[parser] Invalid JSON from Claude:', cleaned.slice(0, 200))
    return []
  }
}

// ── Save parsed tasks to database ─────────────────────────────────────────

async function saveParsedTasks(
  tasks: ParsedTask[],
  projectId: string,
  scheduleUploadId: string
): Promise<{ tasksCreated: number; orderItemsCreated: number; chainsCreated: number }> {
  const previousUpload = await prisma.scheduleUpload.findFirst({
    where: { projectId, id: { not: scheduleUploadId } },
    orderBy: { uploadedAt: 'desc' },
    include: { tasks: true },
  })

  let tasksCreated = 0
  let orderItemsCreated = 0
  let chainsCreated = 0

  for (const t of tasks) {
    if (!t.startDate) continue

    const category = categorizeTask(t.taskName, t.assignedResource || null)
    const normalizedBuilding = normalizeLabel(t.building)
    const normalizedFloor = normalizeLabel(t.floor)

    const task = await prisma.task.create({
      data: {
        projectId,
        scheduleUploadId,
        taskIdOriginal: t.taskIdOriginal,
        taskName: t.taskName,
        building: normalizedBuilding,
        floor: normalizedFloor,
        gcInstallDate: new Date(t.startDate),
        gcInstallDateEnd: t.endDate ? new Date(t.endDate) : null,
        assignedResource: t.assignedResource,
        category,
        isOurTask: t.isOurTask,
      },
    })
    tasksCreated++

    if (previousUpload) {
      const prevTask = previousUpload.tasks.find(
        (pt) =>
          pt.taskName === t.taskName &&
          normalizeLabel(pt.building) === normalizedBuilding &&
          normalizeLabel(pt.floor) === normalizedFloor
      )
      if (prevTask && prevTask.gcInstallDate.toISOString() !== task.gcInstallDate.toISOString()) {
        const shiftDays = Math.round(
          (task.gcInstallDate.getTime() - prevTask.gcInstallDate.getTime()) / (1000 * 60 * 60 * 24)
        )
        await prisma.scheduleChange.create({
          data: {
            projectId,
            taskId: task.id,
            previousDate: prevTask.gcInstallDate,
            newDate: task.gcInstallDate,
            shiftDays,
          },
        })
      }
    }

    if (!t.isOurTask) continue

    if (category === TaskCategory.CABINET_DELIVERY) {
      const leadTimeWeeks = await getLeadTimeWeeks(ItemType.CABINETS_STANDARD, projectId)
      const orderByDate = subWeeks(new Date(t.startDate), leadTimeWeeks)
      await prisma.orderItem.create({
        data: {
          taskId: task.id,
          projectId,
          itemType: ItemType.CABINETS_STANDARD,
          leadTimeWeeks,
          orderByDate,
          status: OrderStatus.NOT_ORDERED,
        },
      })
      orderItemsCreated++
    }

    if (category === TaskCategory.COUNTERTOP_SET) {
      const leadTimeWeeks = await getLeadTimeWeeks(ItemType.COUNTERTOPS, projectId)
      const orderByDate = subWeeks(new Date(t.startDate), leadTimeWeeks)
      await prisma.orderItem.create({
        data: {
          taskId: task.id,
          projectId,
          itemType: ItemType.COUNTERTOPS,
          leadTimeWeeks,
          orderByDate,
          status: OrderStatus.NOT_ORDERED,
        },
      })
      orderItemsCreated++
    }

    if (category === TaskCategory.CABINET_DELIVERY || category === TaskCategory.CABINET_INSTALL || category === TaskCategory.COUNTERTOP_SET) {
      const ltWeeks = category === TaskCategory.COUNTERTOP_SET
        ? await getLeadTimeWeeks(ItemType.COUNTERTOPS, projectId)
        : await getLeadTimeWeeks(ItemType.CABINETS_STANDARD, projectId)

      const existingChain = await prisma.taskStep.findFirst({
        where: { projectId, building: t.building ?? null, floor: t.floor ?? null },
      })

      if (!existingChain) {
        await generateTaskChain({
          projectId,
          building: t.building ?? null,
          floor: t.floor ?? null,
          taskId: task.id,
          installDate: new Date(t.startDate),
          leadTimeWeeks: ltWeeks,
        })
        chainsCreated++
      } else if (previousUpload) {
        await recalculateChainDates(
          projectId,
          t.building ?? null,
          t.floor ?? null,
          new Date(t.startDate),
          ltWeeks,
        )
      }
    }
  }

  await prisma.scheduleUpload.update({
    where: { id: scheduleUploadId },
    data: { parsedAt: new Date() },
  })

  console.log(`[parser] Saved: ${tasksCreated} tasks, ${orderItemsCreated} orders, ${chainsCreated} chains`)

  return { tasksCreated, orderItemsCreated, chainsCreated }
}
