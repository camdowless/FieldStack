import { prisma } from './prisma'
import type { EmailMessage } from './gmail'
import { createMessage } from './anthropic'

interface ClassifiedEmail {
  emailId: string
  type: string
  title: string
  summary: string
  projectMatch: string | null
  actionNeeded: boolean
  actionType: string | null
  confidence: number
}

export async function classifyEmails(
  emails: EmailMessage[],
  companyId: string
): Promise<ClassifiedEmail[]> {
  if (emails.length === 0) return []

  // Get active projects for matching
  const projects = await prisma.project.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: { id: true, name: true, address: true, gcName: true, gcContact: true, gcEmail: true },
  })

  // Get team members for sender matching
  const team = await prisma.teamMember.findMany({
    where: { companyId },
    select: { name: true, email: true, role: true },
  })

  const projectContext = projects.map((p) =>
    `- "${p.name}" (GC: ${p.gcName}${p.gcContact ? `, contact: ${p.gcContact}` : ''}${p.gcEmail ? `, email: ${p.gcEmail}` : ''}, address: ${p.address})`
  ).join('\n')

  const teamContext = team.map((t) => `- ${t.name} (${t.role}, ${t.email})`).join('\n')

  // Batch classify emails (up to 10 at a time to stay within token limits)
  const results: ClassifiedEmail[] = []
  const batchSize = 10

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize)

    const emailDescriptions = batch.map((e, idx) => `
EMAIL ${idx + 1}:
  ID: ${e.id}
  From: ${e.from} <${e.fromEmail}>
  Subject: ${e.subject}
  Date: ${e.date.toISOString()}
  Attachments: ${e.hasAttachments ? e.attachmentNames.join(', ') : 'none'}
  Body preview: ${e.body.slice(0, 500)}
`).join('\n---\n')

    const message = await createMessage({
      companyId,
      action: 'classify_emails',
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: `You are an email classifier for a cabinet/countertop subcontractor. Classify each email by type and match it to a project if relevant.

ACTIVE PROJECTS:
${projectContext || 'No projects yet'}

TEAM MEMBERS:
${teamContext || 'No team members'}

For each email, return a JSON object with:
- emailId: the email ID
- type: one of SCHEDULE_UPDATE, DELIVERY_CONFIRMATION, CHANGE_ORDER, RFI, MEETING_NOTICE, GENERAL_COMMUNICATION, PAYMENT, ISSUE_REPORT
- title: short descriptive title (max 60 chars)
- summary: 1-2 sentence summary of what this email means for the subcontractor
- projectMatch: project name if this email relates to a known project, null otherwise
- actionNeeded: boolean, true if the sub needs to respond or take action
- actionType: if actionNeeded, what action (e.g. "respond to RFI", "review schedule change", "confirm delivery date"), null otherwise
- confidence: 0-1, how confident you are in the classification

Skip emails that are clearly spam, marketing, newsletters, or unrelated to construction work. Return an empty array for those.

Return ONLY a valid JSON array. No prose.`,
      messages: [
        { role: 'user', content: `Classify these emails:\n\n${emailDescriptions}` },
      ],
    })

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')

    const cleaned = text.replace(/```json|```/g, '').trim()

    try {
      const classified = JSON.parse(cleaned)
      results.push(...classified)
    } catch {
      console.warn('[classifier] Failed to parse batch:', cleaned.slice(0, 200))
    }
  }

  return results
}

export async function processAndSaveEmails(
  emails: EmailMessage[],
  companyId: string
): Promise<{ processed: number; saved: number; skipped: number }> {
  // Filter out emails we've already processed
  const existingIds = await prisma.feedEntry.findMany({
    where: { companyId, emailId: { in: emails.map((e) => e.id) } },
    select: { emailId: true },
  })
  const existingSet = new Set(existingIds.map((e) => e.emailId))
  const newEmails = emails.filter((e) => !existingSet.has(e.id))

  if (newEmails.length === 0) return { processed: emails.length, saved: 0, skipped: emails.length }

  // Classify new emails
  const classified = await classifyEmails(newEmails, companyId)

  // Get projects for matching
  const projects = await prisma.project.findMany({
    where: { companyId, status: 'ACTIVE' },
    select: { id: true, name: true },
  })

  let saved = 0

  for (const entry of classified) {
    const email = newEmails.find((e) => e.id === entry.emailId)
    if (!email) continue

    // Match project by name
    let projectId: string | null = null
    if (entry.projectMatch) {
      const match = projects.find((p) =>
        p.name.toLowerCase().includes(entry.projectMatch!.toLowerCase()) ||
        entry.projectMatch!.toLowerCase().includes(p.name.toLowerCase())
      )
      if (match) projectId = match.id
    }

    await prisma.feedEntry.create({
      data: {
        companyId,
        projectId,
        type: entry.type as any,
        title: entry.title,
        summary: entry.summary,
        sender: email.from,
        senderEmail: email.fromEmail,
        emailId: email.id,
        emailDate: email.date,
        actionNeeded: entry.actionNeeded,
        actionType: entry.actionType,
        confidence: entry.confidence,
        rawSnippet: email.snippet,
      },
    })
    saved++
  }

  // Update last sync time
  await prisma.gmailConnection.update({
    where: { companyId },
    data: { lastSyncAt: new Date() },
  }).catch(() => {})

  return { processed: emails.length, saved, skipped: emails.length - newEmails.length }
}
