import { NextRequest, NextResponse } from 'next/server'
import { runEscalation } from '@/lib/escalation'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runEscalation()
  return NextResponse.json(result)
}
