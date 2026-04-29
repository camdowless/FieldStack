import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCompanyId } from '@/lib/session'
import { createMessage } from '@/lib/anthropic'

// POST — generate a draft email to the GC about schedule changes or issues
export async function POST(req: NextRequest) {
  const companyId = await requireCompanyId()

  const { projectId, type } = await req.json()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      scheduleChanges: {
        orderBy: { detectedAt: 'desc' },
        take: 10,
        include: { task: { select: { taskName: true, building: true, floor: true } } },
      },
    },
  })

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let context = ''
  let prompt = ''

  if (type === 'schedule_change') {
    const changes = project.scheduleChanges
    if (changes.length === 0) {
      return NextResponse.json({ draft: 'No schedule changes detected to reference.' })
    }
    context = changes.map((c) =>
      `${c.task.taskName} (${c.task.building || ''}): ${new Date(c.previousDate).toLocaleDateString()} → ${new Date(c.newDate).toLocaleDateString()} (${c.shiftDays > 0 ? '+' : ''}${c.shiftDays} days)`
    ).join('\n')

    prompt = `Draft a professional but concise email from a cabinet/countertop subcontractor to the general contractor about schedule changes detected in the latest lookahead.

PROJECT: ${project.name}
GC: ${project.gcName}
GC CONTACT: ${project.gcContact || 'Superintendent'}

SCHEDULE CHANGES DETECTED:
${context}

The email should:
1. Acknowledge receipt of the updated schedule
2. Confirm awareness of the specific date changes
3. Note any impact on our material ordering or crew scheduling
4. Request confirmation that the new dates are correct
5. Keep it under 150 words, professional but not stiff

Return ONLY the email body (no subject line, no "Dear X" — just the content). Use a natural contractor tone.`
  } else if (type === 'delay_notice') {
    prompt = `Draft a professional email from a cabinet/countertop subcontractor notifying the GC of a potential delay.

PROJECT: ${project.name}
GC: ${project.gcName}
GC CONTACT: ${project.gcContact || 'Superintendent'}

The email should explain that materials are delayed and provide a revised timeline. Keep it under 100 words, professional but direct. Return ONLY the email body.`
  } else if (type === 'delivery_confirmation') {
    prompt = `Draft a brief email from a cabinet/countertop subcontractor confirming material delivery to the jobsite.

PROJECT: ${project.name} at ${project.address}
GC: ${project.gcName}

Keep it under 50 words. Return ONLY the email body.`
  } else {
    return NextResponse.json({ error: 'Unknown draft type' }, { status: 400 })
  }

  const message = await createMessage({
    companyId,
    action: 'draft_gc_email',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const draft = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  // Generate subject line
  const subjectMap: Record<string, string> = {
    schedule_change: `Re: ${project.name} — Schedule Update Acknowledgment`,
    delay_notice: `${project.name} — Material Delay Notice`,
    delivery_confirmation: `${project.name} — Delivery Confirmation`,
  }

  return NextResponse.json({
    draft,
    subject: subjectMap[type] || `${project.name}`,
    to: project.gcEmail || '',
    toName: project.gcContact || project.gcName,
  })
}
