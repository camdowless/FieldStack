import { SignJWT, jwtVerify } from 'jose'

const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'dev-secret')
const EXPIRY = '7d'

export interface MagicLinkPayload {
  stepId: string
  action: 'complete' | 'block' | 'note'
  teamMemberId?: string
}

export async function createMagicToken(payload: MagicLinkPayload): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(EXPIRY)
    .setIssuedAt()
    .sign(SECRET)
}

export async function verifyMagicToken(token: string): Promise<MagicLinkPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as MagicLinkPayload
  } catch {
    return null
  }
}

export function buildMagicUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
  return `${base}/tasks/action?token=${token}`
}
