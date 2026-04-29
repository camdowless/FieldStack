'use client'
import { useEffect, useState } from 'react'
import { Button, Spinner } from '@/components/ui'

export default function SettingsClient() {
  const [settings, setSettings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings/lead-times').then(r => r.json()).then(d => { setSettings(d); setLoading(false) })
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
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>Global defaults applied to all new orders</p>
      </div>

      {loading && <div style={{ display: 'flex', gap: 8, color: 'var(--muted)' }}><Spinner /> Loading...</div>}

      {!loading && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 20 }}>
            Lead Times by Product
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {settings.map((s, i) => (
              <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 20, paddingBottom: 18, borderBottom: i < settings.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 3 }}>
                    {s.itemType === 'COUNTERTOPS'
                      ? 'Measured from date template can be pulled (after cabinet install)'
                      : 'Measured backward from GC install date'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="number" min={1} max={52} value={s.leadTimeWeeks}
                    onChange={e => {
                      const updated = [...settings]
                      updated[i] = { ...s, leadTimeWeeks: parseInt(e.target.value) || 1 }
                      setSettings(updated)
                    }}
                    style={{ width: 64, textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    week{s.leadTimeWeeks !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="primary" loading={saving} onClick={save}>Save Changes</Button>
            {saved && <span style={{ fontSize: 12, color: 'var(--accent2)', fontFamily: 'var(--mono)' }}>✓ Saved successfully</span>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 12 }}>
          Alert Thresholds
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Critical', 'Past order-by date — immediate email to critical subscribers'],
            ['Warning',  'Within 14 days of order-by — daily digest'],
            ['Info',     '15–30 days out — weekly digest'],
            ['Change',   'Any task date shift detected on upload — immediate email'],
          ].map(([label, desc]) => (
            <div key={label} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 56, fontSize: 11, fontFamily: 'var(--mono)', color: label === 'Critical' ? 'var(--danger)' : label === 'Warning' ? 'var(--warn)' : label === 'Change' ? 'var(--info)' : 'var(--muted)', flexShrink: 0, paddingTop: 1 }}>{label}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
