'use client'
import { ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import clsx from 'clsx'
import { ChatPanel } from './ChatPanel'

interface Project {
  id: string
  name: string
  address: string
  alertCounts: { critical: number; warning: number }
}

function DotLevel({ critical, warning }: { critical: number; warning: number }) {
  if (critical > 0) return <span className="w-2 h-2 rounded-full bg-[#f87171] flex-shrink-0" />
  if (warning > 0)  return <span className="w-2 h-2 rounded-full bg-[#fbbf24] flex-shrink-0" />
  return <span className="w-2 h-2 rounded-full bg-[#6ee7b7] flex-shrink-0" />
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [totalCritical, setTotalCritical] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const companyName = (session?.user as any)?.companyName || ''

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => {
        setProjects(data)
        setTotalCritical(data.reduce((s: number, p: Project) => s + p.alertCounts.critical, 0))
      })
      .catch(() => {})
      .finally(() => setProjectsLoaded(true))
  }, [pathname])

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: '100vh' }}>
      {/* Topbar */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 49, borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 100,
      }}>
        <Link href="/dashboard">
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.08em', color: 'var(--accent)' }}>
            FIELDSTACK <span style={{ color: 'var(--muted)' }}>/ schedule intelligence</span>
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {totalCritical > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--danger)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 2s infinite', display: 'inline-block' }} />
              {totalCritical} critical alert{totalCritical > 1 ? 's' : ''}
            </div>
          )}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            style={{
              fontFamily: 'var(--mono)', fontSize: 12, padding: '7px 16px',
              background: chatOpen ? 'var(--accent)' : 'var(--surface)',
              color: chatOpen ? '#0f0f11' : 'var(--text)',
              border: chatOpen ? 'none' : '1px solid var(--border)',
              borderRadius: 'var(--radius)', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            <AiIcon />
            AI Assistant
          </button>
          <Link href="/dashboard/new">
            <button style={{
              fontFamily: 'var(--mono)', fontSize: 12, padding: '7px 16px',
              background: 'var(--accent)', color: '#0f0f11', border: 'none',
              borderRadius: 'var(--radius)', fontWeight: 600, cursor: 'pointer',
            }}>
              + New Project
            </button>
          </Link>
          {companyName && (
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {companyName}
            </span>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{
              fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 12px',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {/* Body */}
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 0 }}>
        {/* Sidebar */}
        <aside style={{
          borderRight: '1px solid rgba(255,255,255,0.07)',
          background: 'var(--surface)',
          padding: '20px 0',
          overflowY: 'auto',
        }}>
          {/* Nav */}
          <div style={{ padding: '0 12px 16px' }}>
            <SidebarLink href="/dashboard" active={pathname === '/dashboard'}>
              <GridIcon /> Dashboard
            </SidebarLink>
            <SidebarLink href="/my-tasks" active={pathname.startsWith('/my-tasks')}>
              <TaskIcon /> My Tasks
            </SidebarLink>
            <SidebarLink href="/settings" active={pathname.startsWith('/settings')}>
              <SettingsIcon /> Settings
            </SidebarLink>
            <SidebarLink href="/team" active={pathname.startsWith('/team')}>
              <TeamIcon /> Team
            </SidebarLink>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '0 12px 16px' }} />

          {/* Projects */}
          <div style={{ padding: '0 16px' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
              Active Projects
            </div>
            {!projectsLoaded && (
              <div style={{ fontSize: 12, color: 'var(--muted2)', padding: '8px 4px' }}>Loading...</div>
            )}
            {projectsLoaded && projects.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted2)', padding: '8px 4px' }}>No projects yet</div>
            )}
            {projects.map(p => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: 6, marginBottom: 2, cursor: 'pointer',
                  background: pathname.startsWith(`/projects/${p.id}`) ? 'var(--surface2)' : 'transparent',
                  borderLeft: pathname.startsWith(`/projects/${p.id}`) ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'all 0.12s',
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                      {p.address.split(',').slice(-2).join(',').trim()}
                    </div>
                  </div>
                  <DotLevel critical={p.alertCounts.critical} warning={p.alertCounts.warning} />
                </div>
              </Link>
            ))}

            <Link href="/dashboard/new">
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 6, marginTop: 4,
                color: 'var(--muted)', fontSize: 12,
                border: '1px dashed rgba(255,255,255,0.13)',
                transition: 'all 0.15s', cursor: 'pointer',
              }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.color = 'var(--text)'
                  el.style.borderColor = 'var(--accent)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement
                  el.style.color = 'var(--muted)'
                  el.style.borderColor = 'rgba(255,255,255,0.13)'
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
                <span>Add project</span>
              </div>
            </Link>
          </div>
        </aside>

        {/* Main content */}
        <main style={{ overflowY: 'auto', minHeight: 0 }}>
          {children}
        </main>
      </div>

      {/* AI Chat Panel */}
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}

function SidebarLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 6, marginBottom: 2,
        fontSize: 12, fontWeight: active ? 500 : 400,
        color: active ? 'var(--text)' : 'var(--muted)',
        background: active ? 'var(--surface2)' : 'transparent',
        transition: 'all 0.12s',
      }}>
        {children}
      </div>
    </Link>
  )
}

function GridIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
}
function SettingsIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42"/></svg>
}
function TaskIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8l3 3 7-7"/><rect x="1" y="1" width="14" height="14" rx="2"/></svg>
}
function TeamIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="5" r="2.5"/><path d="M1 13c0-2.76 2.24-5 5-5s5 2.24 5 5"/><circle cx="12" cy="5" r="2"/><path d="M14 13c0-2.21-1.79-4-4-4"/></svg>
}
function AiIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/><circle cx="8" cy="8" r="3"/><path d="M5.5 5.5l-1.4-1.4M11.9 11.9l-1.4-1.4M5.5 10.5l-1.4 1.4M11.9 4.1l-1.4 1.4"/></svg>
}
