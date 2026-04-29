import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getOAuth2Client } from '@/lib/gmail'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const companyId = req.nextUrl.searchParams.get('state')

  if (!code || !companyId) {
    return NextResponse.redirect(new URL('/settings?gmail=error', req.nextUrl.origin))
  }

  try {
    const client = getOAuth2Client()
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    // Get the user's email
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const userInfo = await oauth2.userinfo.get()
    const email = userInfo.data.email || 'unknown'

    // Save connection
    await prisma.gmailConnection.upsert({
      where: { companyId },
      create: {
        companyId,
        email,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        tokenExpiry: new Date(tokens.expiry_date!),
      },
      update: {
        email,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiry: new Date(tokens.expiry_date!),
      },
    })

    return NextResponse.redirect(new URL('/settings?gmail=connected', req.nextUrl.origin))
  } catch (e: any) {
    console.error('[gmail] OAuth callback error:', e)
    return NextResponse.redirect(new URL('/settings?gmail=error', req.nextUrl.origin))
  }
}
