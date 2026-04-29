import { NextRequest, NextResponse } from 'next/server'
import { getCompanyId } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { parseScheduleWithClaude, parseScheduleWithVision } from '@/lib/parser'
import { ingestPdf, ingestorResultToText } from '@/lib/pdf-ingestor'
import type Anthropic from '@anthropic-ai/sdk'
import { createMessage } from '@/lib/anthropic'

interface ExtractedProjectInfo {
  projectName: string
  address: string
  gcName: string
  gcContact?: string
}

async function extractProjectInfo(input: Buffer | string, companyId: string): Promise<ExtractedProjectInfo> {
  const isPdf = Buffer.isBuffer(input)

  const userContent: Anthropic.ContentBlockParam[] = isPdf
    ? [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: input.toString('base64') },
        },
        {
          type: 'text',
          text: 'Extract the project info from this construction schedule. Return JSON only.',
        },
      ]
    : [
        {
          type: 'text',
          text: `Extract the project info from this construction schedule. Return JSON only.\n\n${input}`,
        },
      ]

  const message = await createMessage({
    companyId,
    action: 'extract_project_info',
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: `Extract project metadata from a construction schedule document. Return ONLY valid JSON with these fields:
{"projectName":"string","address":"string or empty","gcName":"general contractor company name","gcContact":"superintendent or contact name or empty"}
Use the document header, title block, or letterhead to find this info. If a field isn't present, use an empty string. For projectName, use the actual project/job name, not the file name.`,
    messages: [{ role: 'user', content: userContent }],
  })

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  const cleaned = text.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    return { projectName: 'New Project', address: '', gcName: 'Unknown GC' }
  }
}

function projectNameFromFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')           // strip extension
    .replace(/[-_]+/g, ' ')            // dashes/underscores to spaces
    .replace(/\b\w/g, c => c.toUpperCase()) // title case
    .trim() || 'New Project'
}

export async function POST(req: NextRequest) {
  try {
    const companyId = await getCompanyId()
    if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const isPdf = file.name.toLowerCase().endsWith('.pdf')

    // Step 1: Extract text based on file type
    let rawText = ''
    let pdfExtractionMethod = ''

    if (isPdf) {
      try {
        const ingestResult = await ingestPdf(buffer)
        if (ingestResult.success && (ingestResult.stats?.total_text_chars ?? 0) > 50) {
          rawText = ingestorResultToText(ingestResult)
          pdfExtractionMethod = 'ingestor'
        } else {
          pdfExtractionMethod = 'vision'
        }
      } catch {
        pdfExtractionMethod = 'vision'
      }
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

    // Step 2: Try to extract project info with AI, fall back to filename
    let info: ExtractedProjectInfo
    try {
      info = isPdf && pdfExtractionMethod === 'vision'
        ? await extractProjectInfo(buffer, companyId)
        : await extractProjectInfo(rawText || buffer, companyId)
    } catch (e: any) {
      console.warn('[from-schedule] AI project info extraction failed:', e.message)
      info = {
        projectName: projectNameFromFilename(file.name),
        address: '',
        gcName: 'Unknown GC',
      }
    }

    // Step 3: Create the project
    const project = await prisma.project.create({
      data: {
        companyId,
        name: info.projectName || projectNameFromFilename(file.name),
        address: info.address || '',
        gcName: info.gcName || 'Unknown GC',
        gcContact: info.gcContact || null,
      },
    })

    // Step 4: Create schedule upload and try to parse tasks
    const upload = await prisma.scheduleUpload.create({
      data: {
        projectId: project.id,
        fileName: file.name,
        rawText: isPdf && !rawText ? `[PDF — parsed via ${pdfExtractionMethod}]` : rawText,
        version: 1,
      },
    })

    let parseResult = { tasksCreated: 0, orderItemsCreated: 0, chainsCreated: 0 }
    try {
      if (isPdf && pdfExtractionMethod === 'vision') {
        parseResult = await parseScheduleWithVision(buffer, project.id, upload.id)
      } else if (rawText) {
        parseResult = await parseScheduleWithClaude(rawText, project.id, upload.id)
      }
    } catch (e: any) {
      console.warn('[from-schedule] Schedule parsing failed:', e.message)
      // Project still gets created — user can re-upload or manually add tasks
    }

    return NextResponse.json({
      project,
      uploadId: upload.id,
      ...parseResult,
    }, { status: 201 })
  } catch (err: any) {
    console.error('[from-schedule] Error:', err)
    // Surface the real error message
    const message = err?.error?.error?.message || err?.message || 'Failed to create project'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
