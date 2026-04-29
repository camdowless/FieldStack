import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parseScheduleWithClaude, parseScheduleWithVision } from '@/lib/parser'
import { computeProjectAlerts } from '@/lib/alerts'
import { sendAlertEmails, sendScheduleChangeEmails } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const projectId = formData.get('projectId') as string

    if (!file || !projectId) {
      return NextResponse.json({ error: 'file and projectId required' }, { status: 400 })
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const isPdf = file.name.toLowerCase().endsWith('.pdf')

    // Extract content based on file type
    let rawText = ''

    if (isPdf) {
      // PDFs always go through vision — Claude sees the actual table layout
      console.log('[upload] PDF detected — will use page-by-page vision extraction')
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buffer, { type: 'buffer' })
      rawText = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name]
        return XLSX.utils.sheet_to_csv(ws)
      }).join('\n\n')
    } else {
      rawText = buffer.toString('utf-8')
    }

    if (!isPdf && !rawText.trim()) {
      return NextResponse.json({ error: 'Could not extract text from file' }, { status: 422 })
    }

    // Determine version number
    const lastUpload = await prisma.scheduleUpload.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    })
    const version = (lastUpload?.version ?? 0) + 1

    // Save upload record
    const upload = await prisma.scheduleUpload.create({
      data: {
        projectId,
        fileName: file.name,
        rawText: isPdf ? '[PDF — parsed via vision]' : rawText,
        version,
      },
    })

    // Parse with Claude — PDFs use vision, everything else uses text
    const parseResult = isPdf
      ? await parseScheduleWithVision(buffer, projectId, upload.id)
      : await parseScheduleWithClaude(rawText, projectId, upload.id)

    const { tasksCreated, orderItemsCreated, chainsCreated } = parseResult

    // Send schedule change notifications if applicable
    if (version > 1) {
      const newChanges = await prisma.scheduleChange.findMany({
        where: { projectId, notificationsSent: false },
        include: { task: true },
      })
      if (newChanges.length > 0) {
        try {
          await sendScheduleChangeEmails(newChanges, project.name)
          await prisma.scheduleChange.updateMany({
            where: { id: { in: newChanges.map((c) => c.id) } },
            data: { notificationsSent: true },
          })
        } catch (e) {
          console.error('Failed to send change emails:', e)
        }
      }
    }

    // Compute and send alerts
    const alerts = await computeProjectAlerts(projectId)
    const actionable = alerts.filter((a) => ['CRITICAL', 'WARNING'].includes(a.level))
    if (actionable.length > 0) {
      try {
        await sendAlertEmails(actionable, project.name)
      } catch (e) {
        console.error('Failed to send alert emails:', e)
      }
    }

    return NextResponse.json({
      uploadId: upload.id,
      version,
      tasksCreated,
      orderItemsCreated,
      chainsCreated,
      alertCount: actionable.length,
    })
  } catch (err: any) {
    console.error('Upload error:', err)
    const message = err?.error?.error?.message || err?.message || 'Upload failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
