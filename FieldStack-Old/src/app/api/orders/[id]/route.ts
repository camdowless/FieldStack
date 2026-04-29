import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { OrderStatus } from '@prisma/client'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json()
  const { status, poNumber, vendorName, notes, orderedAt } = body

  const updated = await prisma.orderItem.update({
    where: { id: params.id },
    data: {
      ...(status && { status: status as OrderStatus }),
      ...(poNumber !== undefined && { poNumber }),
      ...(vendorName !== undefined && { vendorName }),
      ...(notes !== undefined && { notes }),
      ...(orderedAt !== undefined && { orderedAt: orderedAt ? new Date(orderedAt) : null }),
    },
    include: { task: true },
  })

  return NextResponse.json(updated)
}
