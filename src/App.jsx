import { useEffect, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './auth/LoginPage'
import RandomizeTab from './tabs/RandomizeTab'
import MonthsTab from './tabs/MonthsTab'
import AuditTab from './tabs/AuditTab'
import AdminPanel from './admin/AdminPanel'
import { signOut } from './lib/auth'
import './App.css'

const TABS = [
  { id: 'randomize', label: 'Randomize' },
  { id: 'months',    label: 'Months' },
  { id: 'audit',     label: 'Audit' },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [booting, setBooting] = useState(true)
  const [tab, setTab] = useState('audit')
  const [showAdmin, setShowAdmin] = useState(false)

  // Initial session + subscribe to auth changes.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s ?? null)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  // Load current user's profile row.
  const userId = session?.user?.id ?? null
  const loadProfile = useCallback(async () => {
    if (!userId) { setProfile(null); return }
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, role')
      .eq('id', userId)
      .maybeSingle()
    if (!error) setProfile(data ?? null)
  }, [userId])

  useEffect(() => { loadProfile() }, [loadProfile])

  if (booting) return <div className="shell-loading">Loading…</div>
  if (!session) return <LoginPage />

  const isAdmin = profile?.role === 'admin'
  const displayName = profile?.display_name || profile?.email || 'you'

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">
          <span className="shell-dot" />
          <span>Brand Audit</span>
        </div>
        <nav className="shell-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="shell-user">
          {isAdmin && (
            <button className="chip admin" onClick={() => setShowAdmin(true)}>
              Admin
            </button>
          )}
          <span className="shell-who" title={profile?.email}>{displayName}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="shell-main">
        {tab === 'randomize' && <RandomizeTab profile={profile} isAdmin={isAdmin} />}
        {tab === 'months'    && <MonthsTab    profile={profile} isAdmin={isAdmin} />}
        {tab === 'audit'     && <AuditTab     profile={profile} />}
      </main>

      {showAdmin && isAdmin && (
        <AdminPanel onClose={() => { setShowAdmin(false); loadProfile() }} />
      )}
    </div>
  )
}
