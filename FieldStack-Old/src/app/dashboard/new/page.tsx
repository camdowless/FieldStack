'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

export default function NewProjectPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', gcName: '', gcContact: '', gcEmail: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const project = await res.json()
      router.push(`/projects/${project.id}`)
    }
    setLoading(false)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
          ← Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>New Project</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Add a job site to start tracking schedules</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Project Name *" hint="e.g. Residences at Lexington">
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Project name" style={{ width: '100%' }} />
          </Field>
          <Field label="Site Address *">
            <input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="34040 W 90th St, De Soto KS" style={{ width: '100%' }} />
          </Field>
          <Field label="General Contractor *">
            <input required value={form.gcName} onChange={e => setForm(f => ({ ...f, gcName: e.target.value }))} placeholder="Ronco Construction" style={{ width: '100%' }} />
          </Field>
          <Field label="GC Contact Name">
            <input value={form.gcContact} onChange={e => setForm(f => ({ ...f, gcContact: e.target.value }))} placeholder="Superintendent name" style={{ width: '100%' }} />
          </Field>
          <Field label="GC Contact Email">
            <input type="email" value={form.gcEmail} onChange={e => setForm(f => ({ ...f, gcEmail: e.target.value }))} placeholder="super@gccompany.com" style={{ width: '100%' }} />
          </Field>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 10 }}>
          <Button type="submit" variant="primary" loading={loading}>Create Project</Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </label>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 5 }}>{hint}</div>}
      {children}
    </div>
  )
}
