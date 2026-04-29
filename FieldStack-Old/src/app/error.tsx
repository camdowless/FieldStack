'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{error.message}</p>
      <button
        onClick={reset}
        style={{
          padding: '8px 16px', background: 'var(--surface2)',
          border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
          color: 'var(--text)', cursor: 'pointer', fontSize: 13,
        }}
      >
        Try again
      </button>
    </div>
  )
}
