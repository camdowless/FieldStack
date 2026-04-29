import { getServerSession } from 'next-auth'
import { authOptions } from './auth'

export async function getCompanyId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as any)?.companyId ?? null
}

export async function requireCompanyId(): Promise<string> {
  const companyId = await getCompanyId()
  if (!companyId) throw new Error('Unauthorized')
  return companyId
}
