import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exchangeProcoreCode } from '@/lib/procore'

/**
 * OAuth2 callback from Procore
 * After GC grants access, Procore redirects here with an auth code
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state') // projectId

  if (!code || !state) {
    return NextResponse.redirect(new URL('/dashboard?error=procore_auth_failed', req.url))
  }

  try {
    const tokens = await exchangeProcoreCode(code)

    await prisma.project.update({
      where: { id: state },
      data: {
        procoreAccessToken: tokens.access_token,
        procoreRefreshToken: tokens.refresh_token,
        procoreTokenExpiry: new Date(tokens.expires_at),
        autoSyncEnabled: true,
      },
    })

    return NextResponse.redirect(new URL(`/projects/${state}?tab=Settings&procore=connected`, req.url))
  } catch (e: any) {
    console.error('Procore OAuth error:', e)
    return NextResponse.redirect(new URL(`/projects/${state}?tab=Settings&procore=error`, req.url))
  }
}
