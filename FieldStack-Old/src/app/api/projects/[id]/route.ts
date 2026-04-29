import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json()
  const { name, address, gcName, gcContact, gcEmail, status } = body

  const data: any = {}
  if (name !== undefined) data.name = name
  if (address !== undefined) data.address = address
  if (gcName !== undefined) data.gcName = gcName
  if (gcContact !== undefined) data.gcContact = gcContact
  if (gcEmail !== undefined) data.gcEmail = gcEmail
  if (status !== undefined) data.status = status

  const project = await prisma.project.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json(project)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  await prisma.project.delete({ where: { id: params.id } })
  return NextResponse.json({ deleted: true })
}
