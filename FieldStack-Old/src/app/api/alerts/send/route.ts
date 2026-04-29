import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resend } from '@/lib/email'
import { format } from 'date-fns'

const FROM = process.env.RESEND_FROM_EMAIL || 'alerts@fieldstack.app'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { email, alert, projectId } = body as {
    email: string
    alert: {
      level: string
      title: string
      detail: string
      orderByDate?: string
      installDate?: string
      building?: string
      floor?: string
      itemType?: string
    }
    projectId: string
  }

  if (!email || !alert) {
    return NextResponse.json({ error: 'email and alert required' }, { status: 400 })
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } })
  const projectName = project?.name || 'Unknown Project'
  const location = [alert.building, alert.floor].filter(Boolean).join(' / ') || ''
  const color = alert.level === 'CRITICAL' ? '#f87171' : alert.level === 'WARNING' ? '#fbbf24' : '#93c5fd'

  const subject = `[${alert.level}] FieldStack: ${alert.title} — ${projectName}`

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;background:#17171a;color:#f0eff5;padding:24px;border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:11px;font-family:monospace;letter-spacing:0.1em;color:${color};text-transform:uppercase;margin-bottom:12px">${alert.level}</div>
      <h2 style="margin:0 0 8px;font-size:16px;font-weight:600">${alert.title}</h2>
      <p style="color:#7a7885;font-size:13px;margin:0 0 16px">${projectName}${location ? ` · ${location}` : ''}</p>
      <div style="background:#0f0f11;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px">
        <div style="margin-bottom:4px">${alert.detail}</div>
        ${alert.orderByDate ? `<div style="margin-top:8px"><span style="color:#7a7885">Order by:</span> <span style="color:${color}">${format(new Date(alert.orderByDate), 'MMM d, yyyy')}</span></div>` : ''}
        ${alert.installDate ? `<div><span style="color:#7a7885">Install date:</span> ${format(new Date(alert.installDate), 'MMM d, yyyy')}</div>` : ''}
      </div>
      <a href="${APP_URL}/projects/${projectId}" style="display:inline-block;background:#c8f04c;color:#0f0f11;padding:8px 20px;border-radius:6px;text-decoration:none;font-family:monospace;font-size:12px;font-weight:600">View in FieldStack →</a>
    </div>`

  if (!resend) {
    console.log(`[ALERT EMAIL SKIPPED] → ${email}: ${subject}`)
    return NextResponse.json({ sent: false, logged: true, message: 'Resend not configured — logged to console' })
  }

  try {
    await resend.emails.send({ from: FROM, to: email, subject, html })
    return NextResponse.json({ sent: true })
  } catch (e: any) {
    return NextResponse.json({ sent: false, error: e.message }, { status: 500 })
  }
}
