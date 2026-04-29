'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (res?.ok) {
      window.location.href = '/dashboard'
    } else {
      setError('Invalid email or password')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 8 }}>
            FIELDSTACK
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Welcome back</h1>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 24,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="rick@ckfinstall.com" required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%' }} />
            </div>

            {error && (
              <div style={{ fontSize: 12, color: 'var(--danger)', padding: '8px 12px', background: 'rgba(248,113,113,0.08)', borderRadius: 'var(--radius)', border: '1px solid rgba(248,113,113,0.2)' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              padding: '10px 20px', fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 600,
              background: 'var(--accent)', color: '#0f0f11', border: 'none',
              borderRadius: 'var(--radius)', cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
          Don't have an account? <Link href="/signup" style={{ color: 'var(--accent)' }}>Sign up</Link>
        </p>
      </div>
    </div>
  )
}
