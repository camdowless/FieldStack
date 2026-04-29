import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
          include: { company: true },
        })

        if (!user || !user.passwordHash) return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          companyId: user.companyId,
          companyName: user.company.name,
          companySlug: user.company.slug,
          role: user.role,
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.companyId = (user as any).companyId
        token.companyName = (user as any).companyName
        token.companySlug = (user as any).companySlug
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub
        ;(session.user as any).companyId = token.companyId
        ;(session.user as any).companyName = token.companyName
        ;(session.user as any).companySlug = token.companySlug
        ;(session.user as any).role = token.role
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || 'dev-secret',
}

export async function createCompanyAndUser(data: {
  companyName: string
  companySlug: string
  userName: string
  email: string
  password: string
}) {
  const hash = await bcrypt.hash(data.password, 12)

  const company = await prisma.company.create({
    data: {
      name: data.companyName,
      slug: data.companySlug,
    },
  })

  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: data.userName,
      email: data.email,
      passwordHash: hash,
      role: 'ADMIN',
    },
  })

  // Seed default lead times for the company
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

  return { company, user }
}
