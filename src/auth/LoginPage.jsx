import { useState } from 'react'
import {
  signInWithPassword, signUpWithPassword, signInWithMagicLink,
} from '../lib/auth'

export default function LoginPage() {
  const [mode, setMode] = useState('magic') // 'magic' | 'password'
  const [isSignup, setIsSignup] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null); setInfo(null); setBusy(true)
    try {
      if (mode === 'magic') {
        await signInWithMagicLink(email.trim())
        setInfo('Check your email for a login link.')
      } else if (isSignup) {
        await signUpWithPassword({ email: email.trim(), password })
        setInfo('Account created. If email confirmation is on, check your inbox.')
      } else {
        await signInWithPassword({ email: email.trim(), password })
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1 className="login-title">Brand Audit</h1>
        <p className="login-sub">Sign in to continue.</p>

        <div className="login-modes">
          <button
            type="button"
            className={mode === 'magic' ? 'pill active' : 'pill'}
            onClick={() => setMode('magic')}
          >Magic link</button>
          <button
            type="button"
            className={mode === 'password' ? 'pill active' : 'pill'}
            onClick={() => setMode('password')}
          >Email + password</button>
        </div>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            <span>Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={busy}
            />
          </label>

          {mode === 'password' && (
            <label>
              <span>Password</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
          )}

          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Working…'
              : mode === 'magic' ? 'Send me a link'
              : isSignup ? 'Create account' : 'Sign in'}
          </button>

          {mode === 'password' && (
            <button
              type="button"
              className="link"
              onClick={() => setIsSignup((v) => !v)}
              disabled={busy}
            >
              {isSignup ? 'Have an account? Sign in' : 'Need an account? Sign up'}
            </button>
          )}

          {error && <div className="error">{error}</div>}
          {info  && <div className="info">{info}</div>}
        </form>
      </div>
    </div>
  )
}
