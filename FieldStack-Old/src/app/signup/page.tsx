'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'

export default function SignupPage() {
  const [companyName, setCompanyName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, name, email, password }),
      })

      const data = await res.json()
      if (!res.ok) { setError(data.error); setLoading(false); return }

      // Auto-login after signup
      const loginRes = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (loginRes?.ok) {
        window.location.href = '/dashboard'
      } else {
        setError('Account created but login failed. Try logging in.')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, letterSpacing: '0.1em', color: 'var(--accent)', marginBottom: 8 }}>
            FIELDSTACK
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Create your account</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Start tracking schedules in 60 seconds
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 24,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Company Name</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="CKF Installations" required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Your Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Rick Alvarez" required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="rick@ckfinstall.com" required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} style={{ width: '100%' }} />
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
              {loading ? 'Creating account...' : 'Get Started'}
            </button>
          </div>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>
          Already have an account? <Link href="/login" style={{ color: 'var(--accent)' }}>Log in</Link>
        </p>
      </div>
    </div>
  )
}
