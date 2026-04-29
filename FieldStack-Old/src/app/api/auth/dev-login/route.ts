import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { encode } from 'next-auth/jwt'
import bcrypt from 'bcryptjs'

const DEV_EMAIL = 'dev@fieldstack.local'
const DEV_PASSWORD = 'fieldstack'
const DEV_NAME = 'Dev User'
const DEV_COMPANY = 'CKF Installations'
const DEV_SLUG = 'ckf-installations'

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not found', { status: 404 })
  }

  // Find or create dev user
  let user = await prisma.user.findUnique({
    where: { email: DEV_EMAIL },
    include: { company: true },
  })

  if (!user) {
    // Create company
    let company = await prisma.company.findUnique({ where: { slug: DEV_SLUG } })
    if (!company) {
      company = await prisma.company.create({
        data: { name: DEV_COMPANY, slug: DEV_SLUG },
      })

      // Seed default lead times
      const defaults = [
        { itemType: 'CABINETS_STANDARD' as const, label: 'Standard Stock', leadTimeWeeks: 8 },
        { itemType: 'CABINETS_CUSTOM' as const, label: 'Custom/Semi-Custom', leadTimeWeeks: 16 },
        { itemType: 'COUNTERTOPS' as const, label: 'Fabricated', leadTimeWeeks: 3 },
        { itemType: 'HARDWARE' as const, label: 'Standard', leadTimeWeeks: 4 },
      ]
      for (const lt of defaults) {
        await prisma.leadTimeSetting.create({
          data: { companyId: company.id, itemType: lt.itemType, label: lt.label, leadTimeWeeks: lt.leadTimeWeeks },
        })
      }
    }

    const hash = await bcrypt.hash(DEV_PASSWORD, 12)
    user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: DEV_NAME,
        email: DEV_EMAIL,
        passwordHash: hash,
        role: 'ADMIN',
      },
      include: { company: true },
    })
  }

  // Generate next-auth JWT session token
  const token = await encode({
    token: {
      sub: user.id,
      name: user.name,
      email: user.email,
      companyId: user.companyId,
      companyName: user.company.name,
      companySlug: user.company.slug,
      role: user.role,
    },
    secret: process.env.NEXTAUTH_SECRET || 'dev-secret',
  })

  // Set session cookie and redirect to dashboard
  const origin = req.nextUrl.origin
  const response = NextResponse.redirect(new URL('/dashboard', origin))
  response.cookies.set('next-auth.session-token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV !== 'development',
  })

  return response
}
