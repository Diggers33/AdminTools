'use client'

import { useState } from 'react'

interface LoginPageProps {
  onLogin: (email: string) => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!email || !password) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workdeck/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mail: email, password }),
      })
      if (!res.ok) throw new Error('Invalid credentials')
      onLogin(email)
    } catch {
      setError('Invalid credentials — check your email and password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4fa', fontFamily: "'Georgia', serif", display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: '#0d1f3c', borderBottom: '1px solid #0a1830', padding: '20px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 4, color: '#4a7ab8', textTransform: 'uppercase' }}>
            IRIS · Internal Admin Tools
          </div>
        </div>
      </header>

      {/* Centered login card */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#ffffff', border: '1px solid #c8d8ed', borderRadius: 12, padding: '44px 40px', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,40,100,0.07)' }}>
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: '#1a4a8a', marginBottom: 10 }}>Workdeck</div>
            <div style={{ fontSize: 24, fontWeight: 300, color: '#1a2a3a', marginBottom: 6 }}>Sign In</div>
            <div style={{ fontSize: 13, color: '#5a7a9a' }}>Sign in to access the admin tools</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              autoFocus
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{
                padding: '11px 14px', border: '1px solid #c8d8ed', borderRadius: 6,
                fontSize: 14, outline: 'none', fontFamily: 'Georgia, serif',
                color: '#1a2a3a', background: '#f8fafd',
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{
                padding: '11px 14px', border: '1px solid #c8d8ed', borderRadius: 6,
                fontSize: 14, outline: 'none', fontFamily: 'Georgia, serif',
                color: '#1a2a3a', background: '#f8fafd',
              }}
            />

            {error && (
              <div style={{ fontSize: 12, color: '#cc3333', padding: '9px 12px', background: '#fff5f0', border: '1px solid #f0c8b8', borderRadius: 6 }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !email || !password}
              style={{
                marginTop: 8, padding: '12px 0',
                background: loading || !email || !password ? '#a8c4e8' : '#0066cc',
                color: '#ffffff', border: 'none', borderRadius: 6,
                fontSize: 14, fontFamily: 'Georgia, serif',
                cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.2s',
              }}
            >
              {loading && (
                <span style={{
                  display: 'inline-block', width: 14, height: 14,
                  border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
