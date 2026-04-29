import { spawn } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Mirrors the Pydantic Document model from the Python ingestor
export interface IngestorTable {
  headers: string[]
  rows: string[][]
  row_count: number
  col_count: number
  markdown: string
}

export interface IngestorPage {
  page_number: number
  text: string
  tables: IngestorTable[]
  has_tables: boolean
  ocr_applied: boolean
  width: number
  height: number
}

export interface IngestorMetadata {
  title: string
  author: string
  subject: string
  creator: string
  producer: string
  page_count: number
  creation_date: string
  mod_date: string
}

export interface IngestorStats {
  total_pages: number
  total_text_chars: number
  total_tables: number
  pages_with_tables: number
  pages_with_ocr: number
  headers_stripped: number
  footers_stripped: number
}

export interface IngestorResult {
  success: boolean
  file: string
  extraction_method: string
  metadata: IngestorMetadata
  content: IngestorPage[]
  stats: IngestorStats
  errors: string[]
  error?: string | null
}

const INGESTOR_PATH = join(process.cwd(), 'services', 'pdf_ingestor', 'pdf_ingestor.py')

/**
 * Run the Python PDF ingestor on a buffer.
 * Writes to a temp file, calls the Python script, returns Pydantic-validated JSON.
 */
export async function ingestPdf(pdfBuffer: Buffer): Promise<IngestorResult> {
  const tmpPath = join(tmpdir(), `fieldstack-${randomUUID()}.pdf`)

  try {
    await writeFile(tmpPath, pdfBuffer)

    const result = await new Promise<IngestorResult>((resolve, reject) => {
      const proc = spawn('python3', [INGESTOR_PATH, tmpPath], {
        timeout: 120_000,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk) => { stdout += chunk.toString() })
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString() })

      proc.on('close', (code) => {
        if (stderr) {
          console.log('[pdf_ingestor]', stderr.trim())
        }

        try {
          const parsed = JSON.parse(stdout)
          resolve(parsed)
        } catch {
          reject(new Error(
            `PDF ingestor returned invalid JSON (exit ${code}): ${stdout.slice(0, 200)}`
          ))
        }
      })

      proc.on('error', (err) => {
        if ((err as any).code === 'ENOENT') {
          reject(new Error('python3 not found. Install Python 3 to use the PDF ingestor.'))
        } else {
          reject(err)
        }
      })
    })

    return result
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

/**
 * Convert ingestor output to structured text for Claude.
 * Uses pre-rendered GFM markdown tables from the Python engine.
 */
export function ingestorResultToText(result: IngestorResult): string {
  if (!result.success || !result.content) return ''

  const parts: string[] = []

  for (const page of result.content) {
    parts.push(`=== Page ${page.page_number}${page.ocr_applied ? ' (OCR)' : ''} ===`)

    // Use pre-rendered markdown tables from the ingestor
    if (page.tables.length > 0) {
      for (const table of page.tables) {
        if (table.markdown) {
          parts.push(table.markdown)
        } else {
          // Fallback to pipe-delimited if markdown wasn't generated
          parts.push(table.headers.join(' | '))
          parts.push(table.headers.map(() => '---').join(' | '))
          for (const row of table.rows) {
            parts.push(row.join(' | '))
          }
        }
        parts.push('')
      }
    }

    // Include page text if no tables captured it
    if (page.text && page.tables.length === 0) {
      parts.push(page.text)
    }

    parts.push('')
  }

  return parts.join('\n')
}
