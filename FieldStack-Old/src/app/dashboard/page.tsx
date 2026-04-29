'use client'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StatCard, Badge, alertVariant, EmptyState, Spinner } from '@/components/ui'

interface Project {
  id: string
  name: string
  address: string
  gcName: string
  status: string
  alertCounts: { critical: number; warning: number }
  _count: { tasks: number; orderItems: number }
  scheduleUploads: { uploadedAt: string; version: number }[]
}

interface BriefingItem {
  project: string
  step?: string
  building?: string
  dueDate?: string
  daysOverdue?: number
  assignedTo?: string
  shiftDays?: number
  task?: string
  item?: string
  orderByDate?: string
}

interface Briefing {
  date: string
  activeProjects: number
  overdue: BriefingItem[]
  upcoming: BriefingItem[]
  recentChanges: BriefingItem[]
  ordersNeeded: BriefingItem[]
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function quickRemind(assignedTo: string) {
    setActionLoading(`remind-${assignedTo}`)
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Send a reminder to ${assignedTo} about their overdue tasks. Do it now, no confirmation needed.`, history: [] }),
    })
    setActionLoading(null)
  }

  async function sendAllReminders() {
    setBulkSending(true)
    setBulkResult(null)
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Send reminders to everyone who has overdue tasks. Do it now for all of them, no confirmation needed.', history: [] }),
    })
    const data = await res.json()
    setBulkResult(data.reply || 'Reminders sent')
    setBulkSending(false)
  }

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false) })
      .catch(() => setLoading(false))

    fetch('/api/briefing')
      .then(r => r.json())
      .then(data => setBriefing(data))
      .catch(() => {})
  }, [])

  async function handleFileDrop(f: File) {
    const validExts = ['.pdf', '.xlsx', '.xls', '.txt', '.csv']
    if (!validExts.some(ext => f.name.toLowerCase().endsWith(ext))) {
      setCreateError('Unsupported file type. Use PDF, XLSX, or plain text.')
      return
    }
    setCreating(true)
    setCreateError('')
    const fd = new FormData()
    fd.append('file', f)
    try {
      const res = await fetch('/api/projects/from-schedule', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create project')
      router.push(`/projects/${data.project.id}`)
    } catch (e: any) {
      setCreateError(e.message)
      setCreating(false)
    }
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setDragOver(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragOver(false)
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileDrop(f)
  }

  const totalCritical  = projects.reduce((s, p) => s + p.alertCounts.critical, 0)
  const totalWarning   = projects.reduce((s, p) => s + p.alertCounts.warning, 0)
  const totalOrders    = projects.reduce((s, p) => s + p._count.orderItems, 0)
  const activeProjects = projects.filter(p => p.status === 'ACTIVE').length

  return (
    <div
      style={{ padding: '28px 32px', position: 'relative', minHeight: '100%' }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Full-page drop overlay */}
      {dragOver && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(15,15,17,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            border: '2px dashed var(--accent)',
            borderRadius: 20, padding: '60px 80px',
            textAlign: 'center',
            background: 'rgba(200,240,76,0.04)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>📄</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
              Drop schedule to create a project
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              AI will extract project name, GC, and schedule tasks
            </div>
          </div>
        </div>
      )}

      {/* Creating project toast */}
      {(creating || createError) && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 250,
          minWidth: 320, maxWidth: 420,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {creating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text)' }}>
              <Spinner size={18} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Creating project from schedule...</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  Extracting project info and parsing tasks
                </div>
              </div>
            </div>
          )}
          {createError && !creating && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>Failed to create project</div>
                <button onClick={() => setCreateError('')} style={{
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16,
                }}>&times;</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{createError}</div>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,.txt,.csv"
        hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFileDrop(f) }}
      />

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Dashboard</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4, fontFamily: 'var(--mono)' }}>
          All projects · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 28 }}>
        <StatCard label="Active Projects"  value={activeProjects} color="white" />
        <StatCard label="Critical Alerts"  value={totalCritical}  color={totalCritical > 0 ? 'red' : 'green'} sub="Past order-by date" />
        <StatCard label="Warning Alerts"   value={totalWarning}   color={totalWarning > 0 ? 'yellow' : 'green'} sub="Due within 14 days" />
        <StatCard label="Total Orders"     value={totalOrders}    color="white" sub="Across all projects" />
      </div>

      {/* Daily Briefing */}
      {briefing && (briefing.overdue.length > 0 || briefing.upcoming.length > 0 || briefing.ordersNeeded.length > 0) && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 20, marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#6ee7b7' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em', fontWeight: 600 }}>
                TODAY'S BRIEFING
              </span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </span>
          </div>

          {briefing.overdue.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.08em' }}>
                  OVERDUE ({briefing.overdue.length})
                </div>
                <button
                  onClick={sendAllReminders}
                  disabled={bulkSending}
                  style={{
                    padding: '3px 10px', fontSize: 10, fontFamily: 'var(--mono)',
                    background: 'transparent', border: '1px solid rgba(248,113,113,0.3)',
                    borderRadius: 4, color: bulkSending ? 'var(--muted)' : 'var(--danger)',
                    cursor: bulkSending ? 'default' : 'pointer',
                  }}
                >
                  {bulkSending ? 'Sending...' : 'Remind All'}
                </button>
              </div>
              {bulkResult && (
                <div style={{
                  padding: '6px 10px', marginBottom: 6, borderRadius: 4,
                  background: 'rgba(110,231,183,0.06)', fontSize: 11, color: 'var(--accent2)',
                  fontFamily: 'var(--mono)',
                }}>
                  {bulkResult.slice(0, 100)}
                  <button onClick={() => setBulkResult(null)} style={{
                    background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', marginLeft: 8,
                  }}>&times;</button>
                </div>
              )}
              {briefing.overdue.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 6, marginBottom: 2,
                  background: 'rgba(248,113,113,0.06)',
                }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 500 }}>{item.step?.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>
                      {item.project}{item.building ? ` / ${item.building}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                      {item.assignedTo || 'Unassigned'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--danger)' }}>
                      {item.daysOverdue}d
                    </span>
                    {item.assignedTo && (
                      <button
                        onClick={() => quickRemind(item.assignedTo!)}
                        disabled={actionLoading === `remind-${item.assignedTo}`}
                        style={{
                          padding: '2px 6px', fontSize: 9, fontFamily: 'var(--mono)',
                          background: 'transparent', border: '1px solid rgba(248,113,113,0.3)',
                          borderRadius: 3, color: 'var(--danger)', cursor: 'pointer',
                        }}
                      >
                        {actionLoading === `remind-${item.assignedTo}` ? '...' : 'Remind'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {briefing.upcoming.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 8 }}>
                THIS WEEK ({briefing.upcoming.length})
              </div>
              {briefing.upcoming.slice(0, 5).map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 6, marginBottom: 2,
                }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 500 }}>{item.step?.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>
                      {item.project}{item.building ? ` / ${item.building}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                      {item.assignedTo || 'Unassigned'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                      {item.dueDate ? new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {briefing.ordersNeeded.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)', letterSpacing: '0.08em', marginBottom: 8 }}>
                ORDERS NEEDED ({briefing.ordersNeeded.length})
              </div>
              {briefing.ordersNeeded.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 6, marginBottom: 2,
                }}>
                  <div style={{ fontSize: 12 }}>
                    <span style={{ fontWeight: 500 }}>{item.item?.replace(/_/g, ' ')}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>
                      {item.project}{item.building ? ` / ${item.building}` : ''}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)' }}>
                    Order by {item.orderByDate ? new Date(item.orderByDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          )}

          {briefing.recentChanges.length > 0 && (
            <div style={{ marginTop: 14, padding: '8px 10px', background: 'rgba(251,191,36,0.06)', borderRadius: 6 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--warn)' }}>
                {briefing.recentChanges.length} schedule change{briefing.recentChanges.length > 1 ? 's' : ''} detected this week
              </span>
            </div>
          )}
        </div>
      )}

      {/* Project list */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
          Projects
        </div>
        <Link href="/dashboard/new">
          <button style={{
            fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 14px',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.13)',
            borderRadius: 'var(--radius)', color: 'var(--text)', cursor: 'pointer',
          }}>
            + New Project
          </button>
        </Link>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', padding: 40, justifyContent: 'center' }}>
          <Spinner /> Loading projects...
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: 16, padding: '60px 32px', textAlign: 'center',
            cursor: 'pointer', marginBottom: 28,
            background: 'rgba(200,240,76,0.02)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.background = 'rgba(200,240,76,0.05)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
            e.currentTarget.style.background = 'rgba(200,240,76,0.02)'
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📄</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
            Drop a GC schedule to create your first project
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
            AI will extract the project name, GC info, and schedule tasks automatically
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 24px', borderRadius: 8,
            background: 'var(--accent)', color: '#0f0f11',
            fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600,
          }}>
            Upload Schedule
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 12, fontFamily: 'var(--mono)' }}>
            PDF, XLSX, or plain text
          </div>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(p => {
            const lastUpload = p.scheduleUploads[0]
            const level = p.alertCounts.critical > 0 ? 'CRITICAL' : p.alertCounts.warning > 0 ? 'WARNING' : 'ON_TRACK'
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr auto',
                  alignItems: 'center', gap: 16,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: '16px 20px',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.14)'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                      background: level === 'CRITICAL' ? '#f87171' : level === 'WARNING' ? '#fbbf24' : '#6ee7b7',
                      boxShadow: `0 0 8px ${level === 'CRITICAL' ? '#f8717166' : level === 'WARNING' ? '#fbbf2466' : '#6ee7b766'}`,
                    }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                        {p.address} · GC: {p.gcName}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {p.alertCounts.critical > 0 && (
                      <Badge variant="critical">{p.alertCounts.critical} critical</Badge>
                    )}
                    {p.alertCounts.warning > 0 && (
                      <Badge variant="warning">{p.alertCounts.warning} warning</Badge>
                    )}
                    {p.alertCounts.critical === 0 && p.alertCounts.warning === 0 && (
                      <Badge variant="success">on track</Badge>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', minWidth: 80, textAlign: 'right' }}>
                      {lastUpload
                        ? `v${lastUpload.version} · ${new Date(lastUpload.uploadedAt).toLocaleDateString()}`
                        : 'no schedule'}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#7a7885" strokeWidth="1.5"><path d="M6 4l4 4-4 4"/></svg>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
