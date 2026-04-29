import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { getAuthUrl } from '@/lib/gmail'

// GET — check Gmail connection status + return auth URL
export async function GET() {
  const companyId = await requireCompanyId()

  const connection = await prisma.gmailConnection.findUnique({
    where: { companyId },
    select: { email: true, lastSyncAt: true, tokenExpiry: true },
  })

  if (connection) {
    return NextResponse.json({
      connected: true,
      email: connection.email,
      lastSyncAt: connection.lastSyncAt,
      tokenExpiry: connection.tokenExpiry,
    })
  }

  const authUrl = getAuthUrl(companyId)

  return NextResponse.json({
    connected: false,
    authUrl,
  })
}

// DELETE — disconnect Gmail
export async function DELETE() {
  const companyId = await requireCompanyId()

  await prisma.gmailConnection.delete({
    where: { companyId },
  }).catch(() => {})

  return NextResponse.json({ disconnected: true })
}
