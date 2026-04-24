import { useEffect, useState } from 'react'
import {
  listProfiles, setProfileRole, setProfileDisplayName,
  listAdminNotifications, dismissAdminNotification,
  addBrand,
  listInventorySnapshots, deleteSnapshot,
} from '../lib/db'

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function AdminPanel({ onClose }) {
  const [profiles, setProfiles]         = useState([])
  const [notifications, setNotifications] = useState([])
  const [snapshots, setSnapshots]       = useState([])
  const [uploadersById, setUploadersById] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true); setError(null)
    try {
      const [ps, notifs, snaps] = await Promise.all([
        listProfiles(),
        listAdminNotifications({ includeDismissed: false }),
        listInventorySnapshots(10),
      ])
      setProfiles(ps)
      setUploadersById(new Map(ps.map((p) => [p.id, p])))
      setNotifications(notifs)
      setSnapshots(snaps)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  // -------- People --------
  async function onToggleRole(p) {
    const next = p.role === 'admin' ? 'member' : 'admin'
    if (!confirm(`Set ${p.display_name || p.email} to "${next}"?`)) return
    try { await setProfileRole(p.id, next); await reload() }
    catch (e) { setError(e.message) }
  }

  async function onRename(p) {
    const v = prompt('Display name:', p.display_name || '')
    if (v === null) return
    try { await setProfileDisplayName(p.id, v.trim()); await reload() }
    catch (e) { setError(e.message) }
  }

  // -------- Notifications --------
  async function onAddBrandFromNotif(n) {
    const raw = n.payload?.brand_raw || n.payload?.brand_normalized || ''
    const suggested = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    const name = prompt('Add this brand to the master list. Display name:', suggested)
    if (!name || !name.trim()) return
    try {
      await addBrand(name.trim())
      await dismissAdminNotification(n.id)
      await reload()
    } catch (e) { setError(e.message) }
  }

  async function onDismissNotif(n) {
    try { await dismissAdminNotification(n.id); await reload() }
    catch (e) { setError(e.message) }
  }

  // -------- Snapshots --------
  async function onDeleteSnap(s) {
    if (!confirm(`Delete snapshot from ${fmtTime(s.uploaded_at)}? Any print requests against it will stop working.`)) return
    try { await deleteSnapshot(s.id); await reload() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Admin</h2>
          <button className="link" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error">{error}</div>}
        {loading ? <div className="state">Loading…</div> : (
          <>
            {/* Notifications */}
            <section className="admin-section">
              <h3>Notifications
                {notifications.length > 0 && <em className="tag danger"> {notifications.length}</em>}
              </h3>
              {notifications.length === 0 ? (
                <div className="muted small">No active notifications.</div>
              ) : (
                <ul className="admin-notif-list">
                  {notifications.map((n) => (
                    <li key={n.id} className="admin-notif">
                      {n.kind === 'unrecognized_brand' ? (
                        <>
                          <div>
                            <strong>Unrecognized brand:</strong>{' '}
                            <code>{n.payload?.brand_raw || n.payload?.brand_normalized}</code>
                            <div className="muted small">
                              from {n.payload?.filename || 'an upload'} · {fmtTime(n.created_at)}
                            </div>
                          </div>
                          <div className="row-tight">
                            <button className="mini" onClick={() => onAddBrandFromNotif(n)}>
                              Add to master
                            </button>
                            <button className="mini" onClick={() => onDismissNotif(n)}>
                              Dismiss
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{n.kind}</strong>
                            <pre className="muted small">{JSON.stringify(n.payload, null, 2)}</pre>
                          </div>
                          <button className="mini" onClick={() => onDismissNotif(n)}>Dismiss</button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Recent snapshots */}
            <section className="admin-section">
              <h3>Recent inventory uploads</h3>
              {snapshots.length === 0 ? (
                <div className="muted small">No uploads yet.</div>
              ) : (
                <ul className="admin-snap-list">
                  {snapshots.map((s) => {
                    const u = uploadersById.get(s.uploaded_by)
                    return (
                      <li key={s.id} className="admin-snap">
                        <div>
                          <strong>{fmtTime(s.uploaded_at)}</strong>
                          <span className="muted small">
                            {' · '}{s.row_count} rows · {s.filename || 'unnamed'} · by {u?.display_name || u?.email || '—'}
                          </span>
                        </div>
                        <button className="mini danger" onClick={() => onDeleteSnap(s)}>Delete</button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* People */}
            <section className="admin-section">
              <h3>People</h3>
              <ul className="admin-list">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <div className="admin-row">
                      <div>
                        <strong>{p.display_name || p.email}</strong>
                        <div className="muted small">{p.email}</div>
                      </div>
                      <div className="row-tight">
                        <em className={p.role === 'admin' ? 'tag admin' : 'tag'}>{p.role}</em>
                        <button className="mini" onClick={() => onRename(p)}>Rename</button>
                        <button className="mini" onClick={() => onToggleRole(p)}>
                          {p.role === 'admin' ? 'Demote' : 'Promote'}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
