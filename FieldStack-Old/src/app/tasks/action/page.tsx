'use client'
import { useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'

interface StepInfo {
  stepType: string
  building?: string
  floor?: string
  dueDate?: string
  projectName: string
  assignedTo?: string
  status: string
  notes?: string
}

function ActionContent() {
  const params = useSearchParams()
  const token = params.get('token')
  const [step, setStep] = useState<StepInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return }

    fetch(`/api/steps/magic?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return }
        setStep(data)
        setLoading(false)
      })
      .catch(() => { setError('Failed to load task'); setLoading(false) })
  }, [token])

  async function handleAction(action: 'complete' | 'block') {
    if (!token) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/steps/magic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action, note: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); setSubmitting(false); return }
      setDone(true)
    } catch {
      setError('Connection error')
    }
    setSubmitting(false)
  }

  const STEP_LABELS: Record<string, string> = {
    SHOP_DRAWINGS: 'Shop Drawings', SUBMISSIONS: 'Submissions',
    ORDER_MATERIALS: 'Order Materials', CONFIRM_DELIVERY: 'Confirm Delivery',
    INSTALL: 'Install', PUNCH_LIST: 'Punch List',
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)' }}>
      Loading task...
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>!</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{error}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          This link may have expired or already been used.
        </div>
      </div>
    </div>
  )

  if (done) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#10003;</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent2)', marginBottom: 8 }}>Done</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Your update has been saved. You can close this page.
        </div>
      </div>
    </div>
  )

  if (!step) return null

  const isOverdue = step.dueDate && new Date(step.dueDate) < new Date() && step.status !== 'COMPLETE'
  const dueFmt = step.dueDate ? new Date(step.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date'

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 8 }}>
            FIELDSTACK
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Task Update</h1>
        </div>

        {/* Task card */}
        <div style={{
          background: 'var(--surface)',
          border: `1px solid ${isOverdue ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`,
          borderRadius: 12, padding: 24, marginBottom: 20,
        }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 12 }}>
            {step.projectName}
          </div>

          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            {STEP_LABELS[step.stepType] || step.stepType}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            {(step.building || step.floor) && (
              <div style={{ color: 'var(--muted)' }}>
                {[step.building, step.floor].filter(Boolean).join(' / ')}
              </div>
            )}
            <div style={{ color: isOverdue ? 'var(--danger)' : 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {isOverdue ? 'OVERDUE — ' : 'Due: '}{dueFmt}
            </div>
            {step.assignedTo && (
              <div style={{ color: 'var(--muted)' }}>Assigned to: {step.assignedTo}</div>
            )}
          </div>
        </div>

        {/* Note input */}
        <div style={{ marginBottom: 16 }}>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note (optional)..."
            rows={2}
            style={{
              width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 12, color: 'var(--text)', fontSize: 13,
              resize: 'none', outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => handleAction('complete')}
            disabled={submitting}
            style={{
              flex: 1, padding: '14px 20px', fontSize: 14, fontWeight: 600,
              background: 'var(--accent)', color: '#0f0f11', border: 'none',
              borderRadius: 8, cursor: submitting ? 'default' : 'pointer',
              fontFamily: 'var(--mono)', opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving...' : 'Mark Complete'}
          </button>
          <button
            onClick={() => handleAction('block')}
            disabled={submitting}
            style={{
              padding: '14px 20px', fontSize: 14, fontWeight: 600,
              background: 'transparent', color: 'var(--warn)',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 8, cursor: submitting ? 'default' : 'pointer',
              fontFamily: 'var(--mono)', opacity: submitting ? 0.7 : 1,
            }}
          >
            Blocked
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MagicActionPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)' }}>
        Loading...
      </div>
    }>
      <ActionContent />
    </Suspense>
  )
}
