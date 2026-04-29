import { NextRequest, NextResponse } from 'next/server'
import { computeProjectAlerts } from '@/lib/alerts'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const alerts = await computeProjectAlerts(params.id)
  return NextResponse.json(alerts)
}
