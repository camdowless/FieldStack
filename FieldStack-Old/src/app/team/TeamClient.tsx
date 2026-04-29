'use client'
import { useEffect, useState } from 'react'
import { Button, Toggle, Badge, Modal, EmptyState, Spinner } from '@/components/ui'

interface Member {
  id: string; name: string; email: string; role: string
  notifyOnCritical: boolean; notifyOnOrderReminder: boolean; notifyOnScheduleChange: boolean
}

const ROLES = ['OWNER', 'SUPERVISOR', 'PURCHASING', 'INSTALLER']

export default function TeamClient() {
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: 'SUPERVISOR' })
  const [adding, setAdding] = useState(false)

  const reload = () => fetch('/api/team').then(r => r.json()).then(d => { setTeam(d); setLoading(false) })
  useEffect(() => { reload() }, [])

  const addMember = async () => {
    setAdding(true)
    await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setAdding(false)
    setShowAdd(false)
    setForm({ name: '', email: '', role: 'SUPERVISOR' })
    reload()
  }

  const toggle = async (id: string, field: string, val: boolean) => {
    await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, [field]: val }) })
    reload()
  }

  const remove = async (id: string) => {
    if (!confirm('Remove this team member?')) return
    await fetch('/api/team', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    reload()
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Team</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Manage who gets notified and when</p>
        </div>
        <Button variant="primary" onClick={() => setShowAdd(true)}>+ Add Member</Button>
      </div>

      {loading && <div style={{ display: 'flex', gap: 8, color: 'var(--muted)', padding: 40 }}><Spinner /> Loading...</div>}
      {!loading && team.length === 0 && <EmptyState icon="👥" title="No team members yet" sub="Add your first team member to enable notifications" />}

      {!loading && team.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Member', 'Role', 'Critical Alerts', 'Order Reminders', 'Schedule Changes', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map(m => (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{m.email}</div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Badge variant="muted">{m.role}</Badge>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Toggle checked={m.notifyOnCritical} onChange={v => toggle(m.id, 'notifyOnCritical', v)} />
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Toggle checked={m.notifyOnOrderReminder} onChange={v => toggle(m.id, 'notifyOnOrderReminder', v)} />
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Toggle checked={m.notifyOnScheduleChange} onChange={v => toggle(m.id, 'notifyOnScheduleChange', v)} />
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Team Member">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>Name</label>
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="John Smith" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>Email</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="john@company.com" style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>Role</label>
            <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} style={{ width: '100%' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Button variant="primary" loading={adding} onClick={addMember}>Add Member</Button>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
