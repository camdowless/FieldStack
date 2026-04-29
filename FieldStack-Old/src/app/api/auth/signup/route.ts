import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createCompanyAndUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { companyName, name, email, password } = body

  if (!companyName || !name || !email || !password) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  // Check if email already exists
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  // Generate slug from company name
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  // Check if slug exists
  const slugExists = await prisma.company.findUnique({ where: { slug } })
  if (slugExists) {
    return NextResponse.json({ error: 'Company name already taken' }, { status: 409 })
  }

  try {
    const { company, user } = await createCompanyAndUser({
      companyName,
      companySlug: slug,
      userName: name,
      email,
      password,
    })

    return NextResponse.json({
      companyId: company.id,
      userId: user.id,
      slug: company.slug,
    }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Signup failed' }, { status: 500 })
  }
}
