'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge, alertVariant, Spinner, EmptyState } from '@/components/ui'
import { AppShell } from '@/components/AppShell'

interface Step {
  id: string
  stepType: string
  building: string | null
  floor: string | null
  dueDate: string | null
  status: string
  notes: string | null
  isOverdue: boolean
  project: { id: string; name: string }
  task: { taskName: string; gcInstallDate: string } | null
  assignedTo: { id: string; name: string; role: string } | null
}

const STEP_LABELS: Record<string, string> = {
  SHOP_DRAWINGS: 'Shop Drawings',
  SUBMISSIONS: 'Submissions',
  ORDER_MATERIALS: 'Order Materials',
  CONFIRM_DELIVERY: 'Confirm Delivery',
  INSTALL: 'Install',
  PUNCH_LIST: 'Punch List',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'var(--muted)',
  IN_PROGRESS: 'var(--info)',
  COMPLETE: 'var(--accent2)',
  BLOCKED: 'var(--danger)',
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MyTasksPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    fetch('/api/my-tasks')
      .then(r => r.json())
      .then(data => { setSteps(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function markComplete(stepId: string) {
    await fetch(`/api/steps/${stepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETE' }),
    })
    setSteps(prev => prev.filter(s => s.id !== stepId))
  }

  const filtered = filter === 'all' ? steps
    : filter === 'overdue' ? steps.filter(s => s.isOverdue)
    : steps.filter(s => s.assignedTo?.name === filter)

  // Group by project
  const grouped = new Map<string, { projectName: string; projectId: string; steps: Step[] }>()
  for (const step of filtered) {
    const key = step.project.id
    if (!grouped.has(key)) {
      grouped.set(key, { projectName: step.project.name, projectId: step.project.id, steps: [] })
    }
    grouped.get(key)!.steps.push(step)
  }

  const assignees = [...new Set(steps.map(s => s.assignedTo?.name).filter(Boolean))] as string[]
  const overdueCount = steps.filter(s => s.isOverdue).length

  return (
    <AppShell>
      <div style={{ padding: '28px 32px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Task Manager</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4, fontFamily: 'var(--mono)' }}>
            All active steps across projects
          </p>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({steps.length})
          </FilterChip>
          <FilterChip active={filter === 'overdue'} onClick={() => setFilter('overdue')} danger>
            Overdue ({overdueCount})
          </FilterChip>
          {assignees.map(name => (
            <FilterChip key={name} active={filter === name} onClick={() => setFilter(name)}>
              {name}
            </FilterChip>
          ))}
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', padding: 40, justifyContent: 'center' }}>
            <Spinner /> Loading tasks...
          </div>
        )}

        {!loading && steps.length === 0 && (
          <EmptyState icon="✅" title="No active tasks" sub="Upload a schedule to generate task chains" />
        )}

        {!loading && Array.from(grouped.values()).map(group => (
          <div key={group.projectId} style={{ marginBottom: 24 }}>
            <Link href={`/projects/${group.projectId}?tab=Workflow`}>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em',
                color: 'var(--accent)', marginBottom: 10, cursor: 'pointer',
              }}>
                {group.projectName.toUpperCase()} →
              </div>
            </Link>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.steps.map(step => (
                <div key={step.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto',
                  alignItems: 'center', gap: 12,
                  background: step.isOverdue ? 'rgba(248,113,113,0.06)' : 'var(--surface)',
                  border: `1px solid ${step.isOverdue ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {STEP_LABELS[step.stepType] || step.stepType}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                      {[step.building, step.floor].filter(Boolean).join(' / ') || 'General'}
                      {step.assignedTo && ` · ${step.assignedTo.name}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {step.isOverdue && <Badge variant="critical">OVERDUE</Badge>}
                    <div style={{
                      fontSize: 11, fontFamily: 'var(--mono)',
                      color: step.isOverdue ? 'var(--danger)' : 'var(--muted)',
                    }}>
                      {step.dueDate ? fmt(step.dueDate) : 'No date'}
                    </div>
                    <button
                      onClick={() => markComplete(step.id)}
                      style={{
                        padding: '4px 12px', fontSize: 11, fontFamily: 'var(--mono)',
                        background: 'transparent', border: '1px solid var(--border2)',
                        borderRadius: 'var(--radius)', color: 'var(--accent)',
                        cursor: 'pointer',
                      }}
                    >
                      ✓ Done
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  )
}

function FilterChip({ active, danger, onClick, children }: {
  active: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 12px', fontSize: 11, fontFamily: 'var(--mono)',
        background: active ? (danger ? 'rgba(248,113,113,0.15)' : 'var(--surface2)') : 'transparent',
        border: `1px solid ${active ? (danger ? 'rgba(248,113,113,0.3)' : 'var(--border2)') : 'var(--border)'}`,
        borderRadius: 20, cursor: 'pointer',
        color: active ? (danger ? 'var(--danger)' : 'var(--text)') : 'var(--muted)',
      }}
    >
      {children}
    </button>
  )
}
