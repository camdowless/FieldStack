'use client'
import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import clsx from 'clsx'
import { Badge, alertVariant, alertBarColor, StatCard, Button, Modal, Toggle, EmptyState, Spinner } from '@/components/ui'

// ── Types ──────────────────────────────────────────────────────────────────
interface Project { id: string; name: string; address: string; gcName: string; gcContact?: string; gcEmail?: string; status: string }
interface Alert { id: string; level: string; title: string; detail: string; orderItemId?: string; installDate: string; orderByDate: string; orderStatus: string; building?: string; floor?: string; itemType: string; daysUntilOrderBy: number }
interface Task { id: string; taskName: string; building?: string; floor?: string; gcInstallDate: string; gcInstallDateEnd?: string; assignedResource?: string; category: string; isOurTask: boolean; orderItems: OrderItem[] }
interface OrderItem { id: string; itemType: string; leadTimeWeeks: number; orderByDate: string; orderedAt?: string; poNumber?: string; vendorName?: string; notes?: string; status: string }
interface ScheduleChange { id: string; detectedAt: string; previousDate: string; newDate: string; shiftDays: number; task: { taskName: string; building?: string; floor?: string } }

const TABS = ['Overview', 'Feed', 'Workflow', 'Timeline', 'Orders', 'Upload', 'Changes', 'Settings'] as const
type Tab = typeof TABS[number]

const ORDER_STATUSES = ['NOT_ORDERED', 'ORDERED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtShort(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function statusVariant(s: string) {
  return ({ NOT_ORDERED: 'critical', ORDERED: 'info', IN_TRANSIT: 'warning', DELIVERED: 'success', CANCELLED: 'muted' } as any)[s] ?? 'muted'
}
function categoryLabel(c: string) {
  return ({ CABINET_DELIVERY: 'Cabinet Delivery', CABINET_INSTALL: 'Cabinet Install', COUNTERTOP_SET: 'Countertop Set', OTHER: 'Other' } as any)[c] ?? c
}
function itemTypeLabel(t: string) {
  return ({ CABINETS_STANDARD: 'Cabinets (standard)', CABINETS_CUSTOM: 'Cabinets (custom)', COUNTERTOPS: 'Countertops', HARDWARE: 'Hardware' } as any)[t] ?? t
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [changes, setChanges] = useState<ScheduleChange[]>([])
  const [team, setTeam] = useState<{ id: string; name: string; email: string; role: string }[]>([])
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [pageDragOver, setPageDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [uploadError, setUploadError] = useState('')
  const [healthCheck, setHealthCheck] = useState<string | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const dragCounter = useRef(0)

  const reload = async () => {
    const [proj, al, tk, ch, tm] = await Promise.all([
      fetch(`/api/projects`).then(r => r.json()).then((ps: Project[]) => ps.find(p => p.id === id) ?? null),
      fetch(`/api/projects/${id}/alerts`).then(r => r.json()),
      fetch(`/api/projects/${id}/tasks`).then(r => r.json()),
      fetch(`/api/projects/${id}/changes`).then(r => r.json()),
      fetch(`/api/team`).then(r => r.json()),
    ])
    setProject(proj)
    setAlerts(al)
    setTasks(tk)
    setChanges(ch)
    setTeam(tm)
    setLoading(false)
  }

  useEffect(() => { reload() }, [id])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 10, color: 'var(--muted)' }}>
      <Spinner /> Loading project...
    </div>
  )

  if (!project) return <div style={{ padding: 32, color: 'var(--muted)' }}>Project not found</div>

  const critical = alerts.filter(a => a.level === 'CRITICAL')
  const warning  = alerts.filter(a => a.level === 'WARNING')
  const ourTasks = tasks.filter(t => t.isOurTask)
  const allOrders = tasks.flatMap(t => t.orderItems)

  async function archiveProject() {
    setArchiving(true)
    const newStatus = project.status === 'ACTIVE' ? 'ON_HOLD' : project.status === 'ON_HOLD' ? 'ACTIVE' : project.status
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setArchiving(false)
    reload()
  }

  async function completeProject() {
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETE' }),
    })
    reload()
  }

  async function deleteProject() {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    router.push('/dashboard')
  }

  async function handleFileDrop(f: File) {
    const validExts = ['.pdf', '.xlsx', '.xls', '.txt', '.csv']
    if (!validExts.some(ext => f.name.toLowerCase().endsWith(ext))) {
      setUploadError('Unsupported file type. Use PDF, XLSX, or plain text.')
      return
    }
    setUploading(true)
    setUploadError('')
    setUploadResult(null)
    const fd = new FormData()
    fd.append('file', f)
    fd.append('projectId', id)
    try {
      const res = await fetch('/api/schedules/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUploadResult(data)
      reload()
    } catch (e: any) {
      setUploadError(e.message)
    }
    setUploading(false)
  }

  function onPageDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setPageDragOver(true)
  }
  function onPageDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setPageDragOver(false)
  }
  function onPageDragOver(e: React.DragEvent) { e.preventDefault() }
  function onPageDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setPageDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileDrop(f)
  }

  return (
    <div
      style={{ padding: '28px 32px', position: 'relative', minHeight: '100%' }}
      onDragEnter={onPageDragEnter}
      onDragLeave={onPageDragLeave}
      onDragOver={onPageDragOver}
      onDrop={onPageDrop}
    >
      {/* Full-page drop overlay */}
      {pageDragOver && (
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
              Drop your schedule
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              PDF, XLSX, or plain text lookahead
            </div>
          </div>
        </div>
      )}

      {/* Upload progress/result toast */}
      {(uploading || uploadResult || uploadError) && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 250,
          minWidth: 320, maxWidth: 420,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {uploading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text)' }}>
              <Spinner size={18} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Parsing schedule with AI...</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  Using vision to read document layout
                </div>
              </div>
            </div>
          )}
          {uploadResult && !uploading && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent2)' }}>✓ Schedule parsed</div>
                <button onClick={() => setUploadResult(null)} style={{
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16,
                }}>&times;</button>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                <span>{uploadResult.tasksCreated} tasks</span>
                <span>{uploadResult.orderItemsCreated} orders</span>
                <span>v{uploadResult.version}</span>
              </div>
            </div>
          )}
          {uploadError && !uploading && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--danger)' }}>Upload failed</div>
                <button onClick={() => setUploadError('')} style={{
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16,
                }}>&times;</button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{uploadError}</div>
            </div>
          )}
        </div>
      )}
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>
              ← All Projects
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{project.name}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3, fontFamily: 'var(--mono)' }}>
              {project.address} · GC: {project.gcName}{project.gcContact ? ` · ${project.gcContact}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 24 }}>
            <button
              onClick={async () => {
                setHealthLoading(true)
                setHealthCheck(null)
                try {
                  const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      message: `Give me a quick health check on the project "${project.name}". What's on track, what's overdue, and what needs immediate attention? Keep it to 3-4 sentences.`,
                      history: [],
                    }),
                  })
                  const data = await res.json()
                  setHealthCheck(data.reply || 'Unable to generate health check')
                } catch {
                  setHealthCheck('Connection error')
                }
                setHealthLoading(false)
              }}
              disabled={healthLoading}
              style={{
                padding: '5px 12px', fontSize: 11, fontFamily: 'var(--mono)',
                background: healthLoading ? 'var(--surface2)' : 'transparent',
                border: '1px solid rgba(110,231,183,0.3)',
                borderRadius: 'var(--radius)', color: 'var(--accent2)', cursor: healthLoading ? 'default' : 'pointer',
              }}
            >
              {healthLoading ? 'Checking...' : 'Am I on track?'}
            </button>
            {project.status === 'ACTIVE' && (
              <button onClick={() => completeProject()} style={{
                padding: '5px 12px', fontSize: 11, fontFamily: 'var(--mono)',
                background: 'transparent', border: '1px solid rgba(110,231,183,0.3)',
                borderRadius: 'var(--radius)', color: 'var(--accent2)', cursor: 'pointer',
              }}>
                ✓ Mark Complete
              </button>
            )}
            <button onClick={archiveProject} disabled={archiving} style={{
              padding: '5px 12px', fontSize: 11, fontFamily: 'var(--mono)',
              background: 'transparent', border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)', cursor: 'pointer',
              color: project.status === 'ON_HOLD' ? 'var(--accent)' : 'var(--warn)',
            }}>
              {project.status === 'ON_HOLD' ? 'Reactivate' : project.status === 'COMPLETE' ? 'Reactivate' : 'Hold'}
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} style={{
              padding: '5px 12px', fontSize: 11, fontFamily: 'var(--mono)',
              background: 'transparent', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 'var(--radius)', color: 'var(--danger)', cursor: 'pointer',
            }}>
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div style={{
          padding: 16, marginBottom: 16, borderRadius: 'var(--radius)',
          background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 13 }}>
            <strong style={{ color: 'var(--danger)' }}>Delete this project?</strong>
            <span style={{ color: 'var(--muted)', marginLeft: 8 }}>All tasks, orders, and chains will be permanently removed.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowDeleteConfirm(false)} style={{
              padding: '5px 14px', fontSize: 11, fontFamily: 'var(--mono)',
              background: 'transparent', border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)', color: 'var(--text)', cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button onClick={deleteProject} style={{
              padding: '5px 14px', fontSize: 11, fontFamily: 'var(--mono)',
              background: 'var(--danger)', border: 'none',
              borderRadius: 'var(--radius)', color: '#fff', cursor: 'pointer',
            }}>
              Yes, Delete
            </button>
          </div>
        </div>
      )}

      {/* Health check result */}
      {healthCheck && (
        <div style={{
          padding: '14px 18px', marginBottom: 16, borderRadius: 8,
          background: 'rgba(110,231,183,0.06)', border: '1px solid rgba(110,231,183,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent2)', letterSpacing: '0.08em' }}>
              AI HEALTH CHECK
            </span>
            <button onClick={() => setHealthCheck(null)} style={{
              background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14,
            }}>&times;</button>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
            {healthCheck}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24, gap: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 18px', fontSize: 12, fontFamily: 'var(--mono)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t ? 'var(--accent)' : 'var(--muted)',
            borderBottom: `2px solid ${tab === t ? 'var(--accent)' : 'transparent'}`,
            marginBottom: -1, transition: 'all 0.15s',
          }}>
            {t}
            {t === 'Overview' && critical.length > 0 && (
              <span style={{ marginLeft: 6, background: 'var(--danger)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 10, fontWeight: 600 }}>
                {critical.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'Overview' && <OverviewTab alerts={alerts} critical={critical} warning={warning} ourTasks={ourTasks} changes={changes} projectId={id} team={team} hasTasks={tasks.length > 0} onFilePicked={handleFileDrop} uploading={uploading} />}
      {tab === 'Feed'     && <FeedTab projectId={id} />}
      {tab === 'Workflow' && <WorkflowTab projectId={id} />}
      {tab === 'Timeline' && <TimelineTab tasks={tasks} />}
      {tab === 'Orders'   && <OrdersTab tasks={tasks} onUpdate={reload} />}
      {tab === 'Upload'   && <UploadTab projectId={id} onUploaded={() => { setTab('Overview'); reload() }} />}
      {tab === 'Changes'  && <ChangesTab changes={changes} projectId={id} />}
      {tab === 'Settings' && <SettingsTab projectId={id} />}
    </div>
  )
}

// ── Alert Card with Send ──────────────────────────────────────────────────
function AlertCard({ alert: a, projectId, team }: { alert: Alert; projectId: string; team: any[] }) {
  const [showSend, setShowSend] = useState(false)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function sendTo(email: string, name: string) {
    setSendingTo(email)
    try {
      await fetch('/api/alerts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          alert: {
            level: a.level,
            title: a.title,
            detail: a.detail,
            orderByDate: a.orderByDate,
            installDate: a.installDate,
            building: a.building,
            floor: a.floor,
            itemType: a.itemType,
          },
          projectId,
        }),
      })
      setSentTo(name)
      setShowSend(false)
    } finally {
      setSendingTo(null)
    }
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '4px 1fr auto',
      gap: '0 14px', alignItems: 'start',
      padding: '14px 16px', borderRadius: 8,
      background: 'var(--surface)', border: '1px solid var(--border)',
    }}>
      <div style={{ width: 4, borderRadius: 4, alignSelf: 'stretch', background: alertBarColor(a.level) }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>{a.title}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{a.detail}</div>
        {sentTo && (
          <div style={{ fontSize: 10, color: 'var(--accent2)', fontFamily: 'var(--mono)', marginTop: 4 }}>
            ✓ Sent to {sentTo}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge variant={alertVariant(a.level)}>{a.level}</Badge>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowSend(!showSend)}
            style={{
              padding: '3px 8px', fontSize: 10, fontFamily: 'var(--mono)',
              background: 'transparent', border: '1px solid var(--border2)',
              borderRadius: 4, color: 'var(--accent)', cursor: 'pointer',
            }}
          >
            ✉
          </button>
          {showSend && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: 'var(--surface2)', border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)', padding: 4, zIndex: 50,
              minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', padding: '4px 8px', letterSpacing: '0.05em' }}>
                SEND TO
              </div>
              {team.map((m: any) => (
                <button
                  key={m.id}
                  onClick={() => sendTo(m.email, m.name)}
                  disabled={sendingTo === m.email}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 8px', fontSize: 12, background: 'transparent',
                    border: 'none', color: sendingTo === m.email ? 'var(--muted)' : 'var(--text)',
                    cursor: sendingTo === m.email ? 'default' : 'pointer',
                    borderRadius: 4,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {sendingTo === m.email ? 'Sending...' : m.name}
                  <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>{m.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────
function OverviewTab({ alerts, critical, warning, ourTasks, changes, projectId, team, hasTasks, onFilePicked, uploading: parentUploading }: any) {
  const nextInstall = ourTasks.sort((a: Task, b: Task) => new Date(a.gcInstallDate).getTime() - new Date(b.gcInstallDate).getTime())[0]
  const unsentChanges = changes.filter((c: ScheduleChange) => !c.notificationsSent)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function sendAlerts() {
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/send-alerts`, { method: 'POST' })
      const data = await res.json()
      setSendResult(data)
    } catch {
      setSendResult({ error: 'Failed to send' })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* First-time upload prompt */}
      {!hasTasks && !parentUploading && (
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: 16, padding: '48px 32px', textAlign: 'center',
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.txt,.csv"
            hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) onFilePicked(f) }}
          />
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
            Drop your GC schedule here to get started
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            or click to browse — PDF, XLSX, or plain text
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 20px', borderRadius: 8,
            background: 'var(--accent)', color: '#0f0f11',
            fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600,
          }}>
            Upload Schedule
          </div>
        </div>
      )}

      {hasTasks && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 28 }}>
        <StatCard label="Our Tasks"      value={ourTasks.length}    color="white" sub="Cabinet + countertop" />
        <StatCard label="Critical"       value={critical.length}    color={critical.length > 0 ? 'red' : 'green'} sub="Past order-by date" />
        <StatCard label="Warnings"       value={warning.length}     color={warning.length > 0 ? 'yellow' : 'green'} sub="Due within 14 days" />
        <StatCard label="Next Install"   value={nextInstall ? fmtShort(nextInstall.gcInstallDate) : '—'} color="white" sub={nextInstall?.taskName ?? 'No tasks'} />
      </div>
      )}

      {hasTasks && (
      <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)' }}>
          Alerts & Actions
        </div>
        <button
          onClick={sendAlerts}
          disabled={sending}
          style={{
            fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 14px',
            background: sending ? 'var(--surface2)' : 'transparent',
            border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
            color: sending ? 'var(--muted)' : 'var(--accent)', cursor: sending ? 'default' : 'pointer',
          }}
        >
          {sending ? 'Sending...' : '✉ Send Alerts Now'}
        </button>
      </div>

      {sendResult && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 'var(--radius)',
          background: sendResult.resendConfigured ? 'rgba(110,231,183,0.08)' : 'rgba(251,191,36,0.08)',
          border: `1px solid ${sendResult.resendConfigured ? 'rgba(110,231,183,0.2)' : 'rgba(251,191,36,0.2)'}`,
          fontSize: 12, fontFamily: 'var(--mono)',
        }}>
          {!sendResult.resendConfigured && (
            <div style={{ color: 'var(--warn)', marginBottom: 4 }}>⚠ Resend API key not configured — emails logged to console</div>
          )}
          <div style={{ color: 'var(--muted)' }}>
            Alerts: {sendResult.alerts} · Changes: {sendResult.changes} · Escalation: {sendResult.escalation?.reminders ?? 0} reminders, {sendResult.escalation?.overdue ?? 0} overdue, {sendResult.escalation?.critical ?? 0} critical
          </div>
        </div>
      )}

      {alerts.length === 0 && <EmptyState icon="✓" title="All clear" sub="No alerts for this project" />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {alerts.map((a: Alert) => (
          <AlertCard key={a.id} alert={a} projectId={projectId} team={team} />
        ))}
      </div>

      {changes.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 12 }}>
            Recent Schedule Changes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {changes.slice(0, 5).map((c: ScheduleChange) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)',
              }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{c.task.taskName}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginLeft: 8 }}>
                    {[c.task.building, c.task.floor].filter(Boolean).join(' – ')}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{fmt(c.previousDate)}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>→</span>
                  <span style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--mono)' }}>{fmt(c.newDate)}</span>
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: c.shiftDays > 0 ? 'var(--danger)' : 'var(--accent2)' }}>
                    {c.shiftDays > 0 ? '+' : ''}{c.shiftDays}d
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </>
  )
}

// ── Timeline Tab ───────────────────────────────────────────────────────────
function TimelineTab({ tasks }: { tasks: Task[] }) {
  const [filter, setFilter] = useState<'all' | 'ours'>('ours')
  const displayed = filter === 'ours' ? tasks.filter(t => t.isOurTask) : tasks

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['ours', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 14px', borderRadius: 20, fontSize: 11, fontFamily: 'var(--mono)',
            border: '1px solid rgba(255,255,255,0.13)', cursor: 'pointer',
            background: filter === f ? 'var(--surface2)' : 'transparent',
            color: filter === f ? 'var(--text)' : 'var(--muted)',
          }}>
            {f === 'ours' ? 'Our Tasks' : 'All Tasks'}
          </button>
        ))}
      </div>

      {displayed.length === 0 && <EmptyState icon="📅" title="No tasks yet" sub="Upload a schedule to populate the timeline" />}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Task', 'Building / Floor', 'Install Date', 'Resource', 'Category', 'Order-By', 'Status'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map(t => {
              const order = t.orderItems[0]
              const orderLevel = order ? (new Date(order.orderByDate) < new Date() && order.status === 'NOT_ORDERED' ? 'CRITICAL' : order.status === 'DELIVERED' ? 'ON_TRACK' : 'INFO') : null
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '11px 12px' }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{t.taskName}</div>
                  </td>
                  <td style={{ padding: '11px 12px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {[t.building, t.floor].filter(Boolean).join(' – ') || '—'}
                  </td>
                  <td style={{ padding: '11px 12px', fontSize: 11, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                    {fmt(t.gcInstallDate)}{t.gcInstallDateEnd && ` – ${fmtShort(t.gcInstallDateEnd)}`}
                  </td>
                  <td style={{ padding: '11px 12px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {t.assignedResource || '—'}
                  </td>
                  <td style={{ padding: '11px 12px' }}>
                    {t.isOurTask
                      ? <Badge variant="info">{categoryLabel(t.category)}</Badge>
                      : <Badge variant="muted">{categoryLabel(t.category)}</Badge>
                    }
                  </td>
                  <td style={{ padding: '11px 12px', fontSize: 11, fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                    {order ? <span style={{ color: orderLevel === 'CRITICAL' ? 'var(--danger)' : 'var(--muted)' }}>{fmt(order.orderByDate)}</span> : '—'}
                  </td>
                  <td style={{ padding: '11px 12px' }}>
                    {order ? <Badge variant={statusVariant(order.status)}>{order.status.replace(/_/g, ' ')}</Badge> : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Orders Tab ─────────────────────────────────────────────────────────────
function OrdersTab({ tasks, onUpdate }: { tasks: Task[]; onUpdate: () => void }) {
  const orders = tasks
    .filter(t => t.isOurTask && t.orderItems.length > 0)
    .flatMap(t => t.orderItems.map(o => ({ ...o, task: t })))
    .sort((a, b) => new Date(a.orderByDate).getTime() - new Date(b.orderByDate).getTime())

  const notOrdered  = orders.filter(o => o.status === 'NOT_ORDERED').length
  const inProgress  = orders.filter(o => ['ORDERED','IN_TRANSIT'].includes(o.status)).length
  const delivered   = orders.filter(o => o.status === 'DELIVERED').length

  if (orders.length === 0) return <EmptyState icon="📦" title="No orders yet" sub="Upload a schedule to generate order items" />

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Not Ordered"  value={notOrdered}  color={notOrdered > 0 ? 'red' : 'green'} />
        <StatCard label="In Progress"  value={inProgress}  color={inProgress > 0 ? 'yellow' : 'white'} />
        <StatCard label="Delivered"    value={delivered}   color="green" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {orders.map((o: any) => (
          <OrderRow key={o.id} order={o} onUpdate={onUpdate} />
        ))}
      </div>
    </>
  )
}

function OrderRow({ order, onUpdate }: { order: any; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ status: order.status, poNumber: order.poNumber || '', vendorName: order.vendorName || '', notes: order.notes || '' })
  const [saving, setSaving] = useState(false)
  const isPast = new Date(order.orderByDate) < new Date() && order.status === 'NOT_ORDERED'

  const save = async () => {
    setSaving(true)
    await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setEditing(false)
    onUpdate()
  }

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${isPast ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{itemTypeLabel(order.itemType)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
            {[order.task.building, order.task.floor].filter(Boolean).join(' – ')} · Install: {fmt(order.task.gcInstallDate)} · Order by: <span style={{ color: isPast ? 'var(--danger)' : 'inherit' }}>{fmt(order.orderByDate)}</span>
            {order.poNumber && <span style={{ marginLeft: 8, color: 'var(--accent2)' }}>PO: {order.poNumber}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge variant={statusVariant(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
          <button onClick={() => setEditing(e => !e)} style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 4, padding: '3px 10px', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', cursor: 'pointer' }}>
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {editing && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'repeat(2,1fr) 1fr auto', gap: 10, alignItems: 'end', background: 'var(--surface2)' }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>Status</div>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ width: '100%' }}>
              {ORDER_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>PO Number</div>
            <input value={form.poNumber} onChange={e => setForm(f => ({ ...f, poNumber: e.target.value }))} placeholder="PO-1234" style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>Notes</div>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" style={{ width: '100%' }} />
          </div>
          <Button variant="primary" size="sm" loading={saving} onClick={save}>Save</Button>
        </div>
      )}
    </div>
  )
}

// ── Workflow Tab ──────────────────────────────────────────────────────────
function WorkflowTab({ projectId }: { projectId: string }) {
  const [steps, setSteps] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/steps`)
      .then(r => r.json())
      .then(data => { setSteps(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [projectId])

  async function markComplete(stepId: string) {
    await fetch(`/api/steps/${stepId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'COMPLETE' }),
    })
    // Reload steps
    const data = await fetch(`/api/projects/${projectId}/steps`).then(r => r.json())
    setSteps(data)
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading workflow...</div>

  // Group by building + floor
  const groups = new Map<string, { steps: any[]; category: string | null }>()
  for (const step of steps) {
    const key = [step.building, step.floor].filter(Boolean).join(' / ') || 'General'
    if (!groups.has(key)) groups.set(key, { steps: [], category: step.task?.category || null })
    groups.get(key)!.steps.push(step)
    // Use the most specific category found
    if (step.task?.category && step.task.category !== 'OTHER') {
      groups.get(key)!.category = step.task.category
    }
  }

  const CATEGORY_LABELS: Record<string, string> = {
    CABINET_DELIVERY: 'Cabinets',
    CABINET_INSTALL: 'Cabinets',
    COUNTERTOP_SET: 'Countertops',
    OTHER: '',
  }

  const STEP_ORDER = ['SHOP_DRAWINGS', 'SUBMISSIONS', 'ORDER_MATERIALS', 'CONFIRM_DELIVERY', 'INSTALL', 'PUNCH_LIST']
  const STEP_LABELS: Record<string, string> = {
    SHOP_DRAWINGS: 'Drawings', SUBMISSIONS: 'Submit', ORDER_MATERIALS: 'Order',
    CONFIRM_DELIVERY: 'Delivery', INSTALL: 'Install', PUNCH_LIST: 'Punch',
  }

  function stepColor(step: any) {
    if (step.status === 'COMPLETE') return 'var(--accent2)'
    if (step.isOverdue) return 'var(--danger)'
    if (step.status === 'IN_PROGRESS') return 'var(--info)'
    if (step.status === 'BLOCKED') return 'var(--warn)'
    return 'var(--muted2)'
  }

  if (steps.length === 0) {
    return (
      <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>
        No task chains yet. Upload a schedule to generate workflow chains.
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16 }}>
      {Array.from(groups.entries()).map(([location, group]) => {
        // Sort steps by the pipeline order
        const sorted = STEP_ORDER.map(st => group.steps.find((s: any) => s.stepType === st)).filter(Boolean)
        const materialLabel = group.category ? CATEGORY_LABELS[group.category] || '' : ''

        return (
          <div key={location} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.08em', color: 'var(--accent)' }}>
                {location.toUpperCase()}
              </div>
              {materialLabel && (
                <span style={{
                  fontSize: 10, fontFamily: 'var(--mono)', padding: '2px 8px',
                  background: materialLabel === 'Countertops' ? 'rgba(251,191,36,0.12)' : 'rgba(147,197,253,0.12)',
                  color: materialLabel === 'Countertops' ? 'var(--warn)' : 'var(--info)',
                  borderRadius: 10, border: `1px solid ${materialLabel === 'Countertops' ? 'rgba(251,191,36,0.2)' : 'rgba(147,197,253,0.2)'}`,
                }}>
                  {materialLabel}
                </span>
              )}
            </div>

            {/* Pipeline visualization */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16 }}>
              {sorted.map((step: any, i: number) => (
                <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                  <div style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6,
                    background: step.status === 'COMPLETE' ? 'rgba(110,231,183,0.1)' : step.isOverdue ? 'rgba(248,113,113,0.08)' : 'var(--surface2)',
                    border: `1px solid ${step.status === 'COMPLETE' ? 'rgba(110,231,183,0.2)' : step.isOverdue ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
                    textAlign: 'center', minWidth: 0,
                  }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: stepColor(step), fontWeight: 600 }}>
                      {step.status === 'COMPLETE' ? '✓' : ''} {STEP_LABELS[step.stepType]}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                      {step.assignedTo?.name?.split(' ')[0] || '—'}
                    </div>
                    {step.dueDate && (
                      <div style={{
                        fontSize: 9, marginTop: 2, fontFamily: 'var(--mono)',
                        color: step.isOverdue ? 'var(--danger)' : 'var(--muted2)',
                      }}>
                        {new Date(step.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    )}
                  </div>
                  {i < sorted.length - 1 && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                      <path d="M2 5h6M6 3l2 2-2 2" stroke="var(--muted2)" strokeWidth="1" />
                    </svg>
                  )}
                </div>
              ))}
            </div>

            {/* Step details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sorted.filter((s: any) => s.status !== 'COMPLETE').map((step: any) => (
                <div key={step.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: 6, fontSize: 12,
                  background: step.isOverdue ? 'rgba(248,113,113,0.06)' : 'transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: stepColor(step), fontSize: 11, fontWeight: 500 }}>
                      {STEP_LABELS[step.stepType]}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                      {step.assignedTo?.name || 'Unassigned'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {step.isOverdue && <span style={{ fontSize: 10, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>OVERDUE</span>}
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                      {step.dueDate ? new Date(step.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No date'}
                    </span>
                    <button
                      onClick={() => markComplete(step.id)}
                      style={{
                        padding: '2px 10px', fontSize: 10, fontFamily: 'var(--mono)',
                        background: 'transparent', border: '1px solid var(--border2)',
                        borderRadius: 4, color: 'var(--accent)', cursor: 'pointer',
                      }}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Upload Tab ─────────────────────────────────────────────────────────────
function UploadTab({ projectId, onUploaded }: { projectId: string; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = async (f: File) => {
    setUploading(true)
    setError('')
    setResult(null)
    const fd = new FormData()
    fd.append('file', f)
    fd.append('projectId', projectId)
    try {
      const res = await fetch('/api/schedules/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setResult(data)
      onUploaded()
    } catch (e: any) {
      setError(e.message)
    }
    setUploading(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setFile(f); upload(f) }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `1px dashed ${dragging ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 10, padding: 32, textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'rgba(200,240,76,0.04)' : 'transparent',
          marginBottom: 16, transition: 'all 0.2s',
        }}
      >
        <input ref={inputRef} type="file" accept=".pdf,.xlsx,.xls,.txt,.csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); upload(f) } }} />
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--muted)' }}>
            <Spinner size={24} />
            <div style={{ fontSize: 13 }}>Parsing schedule with AI...</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>⬆</div>
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Drop a schedule file</span> or click to browse
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>PDF, XLSX, or plain text lookahead</div>
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, color: 'var(--danger)', fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ padding: '16px', background: 'rgba(110,231,183,0.08)', border: '1px solid rgba(110,231,183,0.2)', borderRadius: 8, marginBottom: 16 }}>
          <div style={{ color: 'var(--accent2)', fontWeight: 500, fontSize: 13, marginBottom: 8 }}>✓ Schedule parsed successfully</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{result.tasksCreated} tasks extracted</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{result.orderItemsCreated} order items created</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>Version {result.version}</div>
            {result.alertCount > 0 && <div style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--mono)' }}>{result.alertCount} alerts fired</div>}
          </div>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 12 }}>
          After upload, the system will
        </div>
        {[
          'Extract all cabinet delivery and countertop tasks via AI',
          'Compare against previous version and detect any date shifts',
          'Recalculate order-by dates using your lead time settings',
          'Send email alerts to team members for urgent items',
          'Update the order tracker and alert dashboard',
        ].map((s, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, display: 'flex', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted2)' }}>{i + 1}.</span>
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Changes Tab (Schedule Diff View) ──────────────────────────────────────
function ChangesTab({ changes, projectId }: { changes: ScheduleChange[]; projectId: string }) {
  const [draftLoading, setDraftLoading] = useState(false)
  const [draft, setDraft] = useState<{ draft: string; subject: string; to: string; toName: string } | null>(null)

  async function generateGcDraft() {
    setDraftLoading(true)
    try {
      const res = await fetch('/api/gc-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, type: 'schedule_change' }),
      })
      const data = await res.json()
      setDraft(data)
    } catch {
      setDraft({ draft: 'Failed to generate draft', subject: '', to: '', toName: '' })
    }
    setDraftLoading(false)
  }

  if (changes.length === 0) return <EmptyState icon="📋" title="No changes detected" sub="Schedule changes will appear here when a new version is uploaded" />

  const pushed = changes.filter(c => c.shiftDays > 0)
  const pulled = changes.filter(c => c.shiftDays < 0)
  const totalShift = changes.reduce((s, c) => s + Math.abs(c.shiftDays), 0)

  // Color logic from CEO review: from the SUB's perspective
  // Pushed out (positive) = MORE prep time = green (good for sub)
  // Pulled in (negative) = LESS prep time = red (bad for sub, need to scramble)
  function shiftColor(days: number) {
    return days < 0 ? 'var(--danger)' : 'var(--accent2)'
  }
  function shiftBg(days: number) {
    return days < 0 ? 'rgba(248,113,113,0.06)' : 'rgba(110,231,183,0.06)'
  }
  function shiftLabel(days: number) {
    if (days < 0) return 'Less prep time'
    return 'More prep time'
  }

  return (
    <>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{changes.length}</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '0.08em' }}>TASKS SHIFTED</div>
        </div>
        <div style={{
          background: pulled.length > 0 ? 'rgba(248,113,113,0.06)' : 'var(--surface)',
          border: `1px solid ${pulled.length > 0 ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
          borderRadius: 8, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: pulled.length > 0 ? 'var(--danger)' : 'var(--text)' }}>{pulled.length}</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '0.08em' }}>PULLED IN</div>
          <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--danger)', marginTop: 2 }}>less prep time</div>
        </div>
        <div style={{
          background: pushed.length > 0 ? 'rgba(110,231,183,0.06)' : 'var(--surface)',
          border: `1px solid ${pushed.length > 0 ? 'rgba(110,231,183,0.2)' : 'var(--border)'}`,
          borderRadius: 8, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: pushed.length > 0 ? 'var(--accent2)' : 'var(--text)' }}>{pushed.length}</div>
          <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', letterSpacing: '0.08em' }}>PUSHED OUT</div>
          <div style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--accent2)', marginTop: 2 }}>more prep time</div>
        </div>
      </div>

      {/* Diff table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Task', 'Location', 'Previous Date', 'New Date', 'Shift', 'Impact'].map(h => (
                <th key={h} style={{
                  padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--mono)',
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em',
                  color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', background: shiftBg(c.shiftDays) }}>
                <td style={{ padding: '11px 12px', fontSize: 12, fontWeight: 500 }}>{c.task.taskName}</td>
                <td style={{ padding: '11px 12px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  {[c.task.building, c.task.floor].filter(Boolean).join(' / ') || '-'}
                </td>
                <td style={{ padding: '11px 12px', fontSize: 11, fontFamily: 'var(--mono)', textDecoration: 'line-through', color: 'var(--muted2)' }}>
                  {fmt(c.previousDate)}
                </td>
                <td style={{ padding: '11px 12px', fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600, color: shiftColor(c.shiftDays) }}>
                  {fmt(c.newDate)}
                </td>
                <td style={{ padding: '11px 12px', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: shiftColor(c.shiftDays) }}>
                  {c.shiftDays > 0 ? '+' : ''}{c.shiftDays}d
                </td>
                <td style={{ padding: '11px 12px', fontSize: 10, fontFamily: 'var(--mono)', color: shiftColor(c.shiftDays) }}>
                  {shiftLabel(c.shiftDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--muted2)', fontFamily: 'var(--mono)' }}>
          Detected {changes[0] ? new Date(changes[0].detectedAt).toLocaleString() : ''}
        </div>
        <button
          onClick={generateGcDraft}
          disabled={draftLoading}
          style={{
            padding: '6px 14px', fontSize: 11, fontFamily: 'var(--mono)',
            background: draftLoading ? 'var(--surface2)' : 'var(--accent)',
            color: draftLoading ? 'var(--muted)' : '#0f0f11',
            border: 'none', borderRadius: 'var(--radius)',
            cursor: draftLoading ? 'default' : 'pointer', fontWeight: 600,
          }}
        >
          {draftLoading ? 'Drafting...' : 'Draft GC Email'}
        </button>
      </div>

      {/* Draft email */}
      {draft && (
        <div style={{
          marginTop: 16, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 4 }}>
                AI-GENERATED DRAFT
              </div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{draft.subject}</div>
              {draft.to && (
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  To: {draft.toName} &lt;{draft.to}&gt;
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(draft.draft)
                }}
                style={{
                  padding: '5px 12px', fontSize: 10, fontFamily: 'var(--mono)',
                  background: 'transparent', border: '1px solid var(--border2)',
                  borderRadius: 4, color: 'var(--text)', cursor: 'pointer',
                }}
              >
                Copy
              </button>
              {draft.to && (
                <a
                  href={`mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.draft)}`}
                  style={{
                    padding: '5px 12px', fontSize: 10, fontFamily: 'var(--mono)',
                    background: 'var(--accent)', color: '#0f0f11',
                    borderRadius: 4, textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  Open in Email
                </a>
              )}
              <button
                onClick={() => setDraft(null)}
                style={{
                  background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14,
                }}
              >
                &times;
              </button>
            </div>
          </div>
          <div style={{
            padding: '16px', fontSize: 13, lineHeight: 1.7, color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}>
            {draft.draft}
          </div>
        </div>
      )}
    </>
  )
}

// ── Feed Tab (Live Email Feed) ────────────────────────────────────────────
function FeedTab({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [gmailStatus, setGmailStatus] = useState<any>(null)
  const [scanResult, setScanResult] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/feed?projectId=${projectId}`).then(r => r.json()),
      fetch('/api/gmail').then(r => r.json()),
    ]).then(([feed, gmail]) => {
      setEntries(feed)
      setGmailStatus(gmail)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [projectId])

  async function scanInbox() {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await fetch('/api/gmail/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursBack: 48 }),
      })
      const data = await res.json()
      setScanResult(data)
      // Reload feed
      const feed = await fetch(`/api/feed?projectId=${projectId}`).then(r => r.json())
      setEntries(feed)
    } catch {
      setScanResult({ error: 'Scan failed' })
    }
    setScanning(false)
  }

  const TYPE_ICONS: Record<string, string> = {
    SCHEDULE_UPDATE: '📅', DELIVERY_CONFIRMATION: '📦', CHANGE_ORDER: '📝',
    RFI: '❓', MEETING_NOTICE: '📍', GENERAL_COMMUNICATION: '💬',
    PAYMENT: '💰', ISSUE_REPORT: '⚠',
  }
  const TYPE_COLORS: Record<string, string> = {
    SCHEDULE_UPDATE: 'var(--info)', DELIVERY_CONFIRMATION: 'var(--accent2)',
    CHANGE_ORDER: 'var(--warn)', RFI: 'var(--accent)', MEETING_NOTICE: 'var(--muted)',
    GENERAL_COMMUNICATION: 'var(--muted)', PAYMENT: 'var(--accent2)', ISSUE_REPORT: 'var(--danger)',
  }

  if (loading) return <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading feed...</div>

  return (
    <div>
      {/* Gmail connection status + scan button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {gmailStatus?.connected ? (
            <>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent2)' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent2)' }}>
                Connected: {gmailStatus.email}
              </span>
              {gmailStatus.lastSyncAt && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>
                  Last sync: {new Date(gmailStatus.lastSyncAt).toLocaleString()}
                </span>
              )}
            </>
          ) : (
            <>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--muted2)' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                Gmail not connected
              </span>
              {gmailStatus?.authUrl && (
                <a href={gmailStatus.authUrl} style={{
                  padding: '4px 12px', fontSize: 11, fontFamily: 'var(--mono)',
                  background: 'var(--accent)', color: '#0f0f11', borderRadius: 'var(--radius)',
                  textDecoration: 'none', fontWeight: 600, marginLeft: 8,
                }}>
                  Connect Gmail
                </a>
              )}
            </>
          )}
        </div>

        {gmailStatus?.connected && (
          <button
            onClick={scanInbox}
            disabled={scanning}
            style={{
              padding: '6px 14px', fontSize: 11, fontFamily: 'var(--mono)',
              background: scanning ? 'var(--surface2)' : 'transparent',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
              color: scanning ? 'var(--muted)' : 'var(--accent)', cursor: scanning ? 'default' : 'pointer',
            }}
          >
            {scanning ? 'Scanning...' : '↻ Scan Inbox'}
          </button>
        )}
      </div>

      {/* Scan result */}
      {scanResult && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 'var(--radius)',
          background: scanResult.error ? 'rgba(248,113,113,0.08)' : 'rgba(110,231,183,0.08)',
          border: `1px solid ${scanResult.error ? 'rgba(248,113,113,0.2)' : 'rgba(110,231,183,0.2)'}`,
          fontSize: 12, fontFamily: 'var(--mono)',
          color: scanResult.error ? 'var(--danger)' : 'var(--accent2)',
        }}>
          {scanResult.error || `Processed ${scanResult.processed} emails, ${scanResult.saved} new entries`}
        </div>
      )}

      {/* Feed entries */}
      {entries.length === 0 && !gmailStatus?.connected && (
        <div style={{
          textAlign: 'center', padding: '48px 24px',
          border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 12,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📧</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>Connect your inbox to see project emails</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            FieldStack AI will scan your inbox, classify emails by type, and match them to this project automatically.
          </div>
          {gmailStatus?.authUrl && (
            <a href={gmailStatus.authUrl} style={{
              display: 'inline-block', padding: '10px 24px', fontSize: 13, fontFamily: 'var(--mono)',
              background: 'var(--accent)', color: '#0f0f11', borderRadius: 8,
              textDecoration: 'none', fontWeight: 600,
            }}>
              Connect Gmail
            </a>
          )}
        </div>
      )}

      {entries.length === 0 && gmailStatus?.connected && (
        <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📭</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>No emails matched to this project yet</div>
          <div style={{ fontSize: 12 }}>Click "Scan Inbox" to check for new emails</div>
        </div>
      )}

      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((entry: any) => (
            <div key={entry.id} style={{
              background: 'var(--surface)',
              border: `1px solid ${entry.actionNeeded ? 'rgba(251,191,36,0.2)' : 'var(--border)'}`,
              borderRadius: 8, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14 }}>{TYPE_ICONS[entry.type] || '📧'}</span>
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
                      padding: '2px 6px', borderRadius: 4,
                      background: `${TYPE_COLORS[entry.type] || 'var(--muted)'}15`,
                      color: TYPE_COLORS[entry.type] || 'var(--muted)',
                    }}>
                      {entry.type.replace(/_/g, ' ')}
                    </span>
                    {entry.actionNeeded && (
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 9, padding: '2px 6px',
                        background: 'rgba(251,191,36,0.12)', color: 'var(--warn)',
                        borderRadius: 4, fontWeight: 600,
                      }}>
                        ACTION NEEDED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{entry.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{entry.summary}</div>
                  {entry.actionType && (
                    <div style={{ fontSize: 11, color: 'var(--warn)', fontFamily: 'var(--mono)', marginTop: 6 }}>
                      Action: {entry.actionType}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    {entry.sender}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted2)', marginTop: 2 }}>
                    {entry.emailDate ? new Date(entry.emailDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings Tab ───────────────────────────────────────────────────────────
function SettingsTab({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/lead-times')
      .then(r => r.json())
      .then(setSettings)
  }, [])

  const save = async () => {
    setSaving(true)
    await fetch('/api/settings/lead-times', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const [gcPlatform, setGcPlatform] = useState('')
  const [gcProjectUrl, setGcProjectUrl] = useState('')
  const [gcSaving, setGcSaving] = useState(false)
  const [gcSaved, setGcSaved] = useState(false)

  // Load project GC settings
  useEffect(() => {
    fetch(`/api/projects`)
      .then(r => r.json())
      .then((projects: any[]) => {
        const p = projects.find((pr: any) => pr.id === projectId)
        if (p) {
          setGcPlatform(p.gcPlatform || '')
          setGcProjectUrl(p.gcProjectUrl || '')
        }
      })
  }, [projectId])

  const saveGc = async () => {
    setGcSaving(true)
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gcPlatform: gcPlatform || null,
        gcProjectUrl: gcProjectUrl || null,
      }),
    })
    setGcSaving(false)
    setGcSaved(true)
    setTimeout(() => setGcSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 480 }}>
      {/* GC Schedule Source */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 16 }}>
          GC Schedule Source
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Platform</label>
            <select
              value={gcPlatform}
              onChange={e => setGcPlatform(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Select platform...</option>
              <option value="PROCORE">Procore</option>
              <option value="BUILDERTREND">Buildertrend</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Project URL</label>
            <input
              type="url"
              value={gcProjectUrl}
              onChange={e => setGcProjectUrl(e.target.value)}
              placeholder="https://app.procore.com/projects/12345/schedule"
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 4, fontFamily: 'var(--mono)' }}>
              Paste the link to this project's schedule in {gcPlatform === 'BUILDERTREND' ? 'Buildertrend' : gcPlatform === 'PROCORE' ? 'Procore' : 'your GC portal'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="primary" loading={gcSaving} onClick={saveGc}>Save</Button>
          {gcSaved && <span style={{ fontSize: 12, color: 'var(--accent2)', fontFamily: 'var(--mono)' }}>✓ Saved</span>}
          {gcProjectUrl && (
            <a href={gcProjectUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--mono)', marginLeft: 'auto' }}>
              Open in {gcPlatform || 'browser'} →
            </a>
          )}
        </div>
      </div>

      {/* Procore Integration */}
      {gcPlatform === 'PROCORE' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 16 }}>
            Procore Auto-Sync
          </div>
          <ProcoreSync projectId={projectId} />
        </div>
      )}

      {/* Lead Times */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 16 }}>
          Lead Times (Global Defaults)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {settings.map((s: any, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.itemType}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" min={1} max={52} value={s.leadTimeWeeks}
                  onChange={e => {
                    const updated = [...settings]
                    updated[i] = { ...s, leadTimeWeeks: parseInt(e.target.value) || 1 }
                    setSettings(updated)
                  }}
                  style={{ width: 60, textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>weeks</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <Button variant="primary" loading={saving} onClick={save}>Save Changes</Button>
          {saved && <span style={{ fontSize: 12, color: 'var(--accent2)', fontFamily: 'var(--mono)' }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  )
}

// ── Procore Sync Component ────────────────────────────────────────────────
function ProcoreSync({ projectId }: { projectId: string }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [connected, setConnected] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/projects`)
      .then(r => r.json())
      .then((projects: any[]) => {
        const p = projects.find((pr: any) => pr.id === projectId)
        if (p) {
          setConnected(!!p.procoreAccessToken)
          setLastSync(p.procoreLastSync)
        }
      })
    const params = new URLSearchParams(window.location.search)
    if (params.get('procore') === 'connected') setConnected(true)
  }, [projectId])

  function connectProcore() {
    const clientId = process.env.NEXT_PUBLIC_PROCORE_CLIENT_ID
    if (!clientId) { alert('Procore Client ID not configured'); return }
    const redirectUri = `${window.location.origin}/api/webhooks/procore/callback`
    window.location.href = `https://login.procore.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${projectId}`
  }

  async function manualSync() {
    setSyncing(true); setResult(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/procore-sync`, { method: 'POST' })
      const data = await res.json()
      setResult(data)
      if (data.success) setLastSync(new Date().toISOString())
    } catch { setResult({ success: false, error: 'Sync failed' }) }
    finally { setSyncing(false) }
  }

  if (!connected) return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        Connect your GC's Procore account to auto-sync schedule updates.
      </p>
      <button onClick={connectProcore} style={{
        padding: '8px 16px', fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 600,
        background: 'var(--accent)', color: '#0f0f11', border: 'none',
        borderRadius: 'var(--radius)', cursor: 'pointer',
      }}>Connect Procore</button>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent2)', display: 'inline-block' }} />
        <span style={{ fontSize: 12, color: 'var(--accent2)', fontFamily: 'var(--mono)' }}>Connected to Procore</span>
      </div>
      {lastSync && <p style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 12 }}>Last sync: {new Date(lastSync).toLocaleString()}</p>}
      <button onClick={manualSync} disabled={syncing} style={{
        padding: '6px 14px', fontSize: 11, fontFamily: 'var(--mono)',
        background: 'transparent', border: '1px solid var(--border2)',
        borderRadius: 'var(--radius)', color: syncing ? 'var(--muted)' : 'var(--accent)', cursor: syncing ? 'default' : 'pointer',
      }}>{syncing ? 'Syncing...' : '↻ Sync Now'}</button>
      {result && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 'var(--radius)',
          background: result.success ? 'rgba(110,231,183,0.08)' : 'rgba(248,113,113,0.08)',
          border: `1px solid ${result.success ? 'rgba(110,231,183,0.2)' : 'rgba(248,113,113,0.2)'}`,
          fontSize: 11, fontFamily: 'var(--mono)', color: result.success ? 'var(--accent2)' : 'var(--danger)',
        }}>{result.success ? `✓ ${result.tasksCreated} tasks, ${result.orderItemsCreated} orders` : `✗ ${result.error}`}</div>
      )}
    </div>
  )
}
