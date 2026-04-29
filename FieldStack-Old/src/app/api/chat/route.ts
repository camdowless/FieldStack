import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CHAT_TOOLS, executeTool } from '@/lib/chat-tools'
import type Anthropic from '@anthropic-ai/sdk'
import { createMessage } from '@/lib/anthropic'

const SYSTEM_PROMPT = `You are the FieldStack AI Foreman — a personal assistant for cabinet and countertop subcontractors.

You help users manage their construction projects, track schedules, monitor orders, and stay on top of deadlines. You can both QUERY data and TAKE ACTIONS like marking tasks complete, reassigning work, pushing dates, and sending reminders.

Guidelines:
- Be concise and direct. These are busy contractors — no fluff.
- Use the tools to look up real data before answering questions.
- When giving a daily briefing, prioritize: overdue items first, then upcoming deadlines, then schedule changes, then orders needing attention.
- Format dates as readable (e.g. "Apr 15" not "2026-04-15").
- If something is overdue, say how many days overdue.
- When referring to team members, use first names.
- For MUTATIONS (marking complete, changing dates, assigning, sending reminders): ALWAYS confirm with the user before executing. Say what you're about to do and ask "Want me to go ahead?" Only call the mutation tool after the user confirms.
- Proactively suggest actions: "Danny hasn't confirmed the cabinet order for Building 7. Want me to send him a reminder?"
- When the user says "what should I do today?" or "brief me", run get_daily_digest and present it as actionable items.`

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, history } = await req.json()
  const companyId = (session.user as any).companyId
  const userId = (session.user as any).id

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message required' }, { status: 400 })
  }

  // Build message history for context
  const messages: Anthropic.MessageParam[] = []

  // Include recent history (last 20 messages for context)
  if (history && Array.isArray(history)) {
    for (const h of history.slice(-20)) {
      messages.push({ role: h.role, content: h.content })
    }
  }

  messages.push({ role: 'user', content: message })

  // Save user message
  await prisma.chatMessage.create({
    data: { companyId, userId, role: 'USER', content: message },
  })

  // Run Claude with tool calling — loop until we get a final text response
  let response: Anthropic.Message
  let iterations = 0
  const maxIterations = 10

  // Mark the last tool with cache_control so Anthropic caches system + all tools
  // as the shared prefix across chat turns and across concurrent customers.
  const cachedTools = CHAT_TOOLS.map((t, i) =>
    i === CHAT_TOOLS.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t,
  )

  while (iterations < maxIterations) {
    iterations++

    response = await createMessage({
      companyId,
      action: 'chat_foreman',
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: cachedTools,
      messages,
    })

    // If no tool use, we're done
    if (response.stop_reason === 'end_turn' || !response.content.some((b) => b.type === 'tool_use')) {
      break
    }

    // Process tool calls
    messages.push({ role: 'assistant', content: response.content })

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const result = await executeTool(block.name, block.input as Record<string, any>, companyId)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }
    }

    messages.push({ role: 'user', content: toolResults })
  }

  // Extract final text response
  const assistantText = response!.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  // Save assistant response
  await prisma.chatMessage.create({
    data: { companyId, userId, role: 'ASSISTANT', content: assistantText },
  })

  return NextResponse.json({ reply: assistantText })
}

// GET — load chat history
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = (session.user as any).id

  const messages = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, role: true, content: true, createdAt: true },
  })

  return NextResponse.json(messages)
}
