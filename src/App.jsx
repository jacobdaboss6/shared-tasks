import { useEffect, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './auth/LoginPage'
import RandomizeTab from './tabs/RandomizeTab'
import MonthsTab from './tabs/MonthsTab'
import AuditTab from './tabs/AuditTab'
import LogsTab from './tabs/LogsTab'
import AdminPanel from './admin/AdminPanel'
import { signOut } from './lib/auth'
import { listAdminNotifications, listProfiles } from './lib/db'
import { subscribeToSnapshots } from './lib/realtime'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [booting, setBooting] = useState(true)
  const [tab, setTab] = useState('audit')
  const [showAdmin, setShowAdmin] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [snapshotToast, setSnapshotToast] = useState(null) // { snap, uploaderName }

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

  const isAdmin = profile?.role === 'admin'

  // Poll admin notifications count.
  useEffect(() => {
    if (!isAdmin) { setNotifCount(0); return }
    let active = true
    const fetchCount = async () => {
      try {
        const rows = await listAdminNotifications({ includeDismissed: false })
        if (active) setNotifCount(rows.length)
      } catch { /* ignore */ }
    }
    fetchCount()
    const iv = setInterval(fetchCount, 60_000)
    return () => { active = false; clearInterval(iv) }
  }, [isAdmin])

  // Subscribe to snapshot inserts for cross-app toast.
  useEffect(() => {
    if (!userId) return
    let uploaderMap = new Map()
    listProfiles().then((ps) => { uploaderMap = new Map(ps.map((p) => [p.id, p])) }).catch(() => {})
    const unsub = subscribeToSnapshots((snap) => {
      if (snap.uploaded_by === userId) return // don't notify self
      const u = uploaderMap.get(snap.uploaded_by)
      const name = u?.display_name || u?.email || 'a teammate'
      setSnapshotToast({ snap, uploaderName: name })
    })
    return unsub
  }, [userId])

  // Auto-dismiss the toast after 60s.
  useEffect(() => {
    if (!snapshotToast) return
    const t = setTimeout(() => setSnapshotToast(null), 60_000)
    return () => clearTimeout(t)
  }, [snapshotToast])

  if (booting) return <div className="shell-loading">Loading…</div>
  if (!session) return <LoginPage />

  const displayName = profile?.display_name || profile?.email || 'you'

  const TABS = [
    { id: 'randomize', label: 'Randomize' },
    { id: 'months',    label: 'Months' },
    { id: 'audit',     label: 'Audit' },
    ...(isAdmin ? [{ id: 'logs', label: 'Logs' }] : []),
  ]

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
              {notifCount > 0 && <span className="chip-badge">{notifCount}</span>}
            </button>
          )}
          <span className="shell-who" title={profile?.email}>{displayName}</span>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="shell-main">
        {tab === 'randomize' && <RandomizeTab profile={profile} isAdmin={isAdmin} />}
        {tab === 'months'    && <MonthsTab    profile={profile} isAdmin={isAdmin} />}
        {tab === 'audit'     && <AuditTab     profile={profile} isAdmin={isAdmin} />}
        {tab === 'logs'      && isAdmin && <LogsTab />}
      </main>

      {showAdmin && isAdmin && (
        <AdminPanel onClose={() => { setShowAdmin(false); loadProfile() }} />
      )}

      {/* Snapshot toast */}
      {snapshotToast && (
        <div className="toast snapshot-toast" role="alert">
          <div className="toast-body">
            <strong>{snapshotToast.uploaderName}</strong> uploaded a fresh inventory snapshot
            <span className="muted"> · {snapshotToast.snap.row_count} rows</span>
          </div>
          <div className="toast-actions">
            <button
              className="btn primary"
              onClick={() => { setTab('audit'); setSnapshotToast(null) }}
            >
              View
            </button>
            <button className="btn" onClick={() => setSnapshotToast(null)}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  )
}
