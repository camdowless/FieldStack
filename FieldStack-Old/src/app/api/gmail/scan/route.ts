import { NextRequest, NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/session'
import { fetchRecentEmails } from '@/lib/gmail'
import { processAndSaveEmails } from '@/lib/email-classifier'

// POST — scan inbox and classify emails
export async function POST(req: NextRequest) {
  const companyId = await requireCompanyId()

  const body = await req.json().catch(() => ({}))
  const hoursBack = body.hoursBack || 24

  console.log(`[gmail] Scanning inbox for last ${hoursBack} hours...`)

  const emails = await fetchRecentEmails(companyId, hoursBack)
  console.log(`[gmail] Found ${emails.length} emails`)

  if (emails.length === 0) {
    return NextResponse.json({ processed: 0, saved: 0, skipped: 0, message: 'No emails found' })
  }

  const result = await processAndSaveEmails(emails, companyId)
  console.log(`[gmail] Processed: ${result.processed}, saved: ${result.saved}, skipped: ${result.skipped}`)

  return NextResponse.json(result)
}
