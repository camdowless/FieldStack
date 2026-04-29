import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { TeamRole } from '@prisma/client'
import { getCompanyId } from '@/lib/session'

export async function GET() {
  const companyId = await getCompanyId()
  const team = await prisma.teamMember.findMany({
    where: companyId ? { companyId } : {},
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(team)
}

export async function POST(req: NextRequest) {
  const companyId = await getCompanyId()
  const { name, email, role } = await req.json()
  if (!name || !email) return NextResponse.json({ error: 'name and email required' }, { status: 400 })
  const member = await prisma.teamMember.create({
    data: { companyId: companyId || 'default', name, email, role: (role as TeamRole) || TeamRole.SUPERVISOR },
  })
  return NextResponse.json(member, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { id, ...data } = await req.json()
  const member = await prisma.teamMember.update({ where: { id }, data })
  return NextResponse.json(member)
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  await prisma.teamMember.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
