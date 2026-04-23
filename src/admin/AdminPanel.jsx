import { useEffect, useState } from 'react'
import { listProfiles, setProfileRole, setProfileDisplayName } from '../lib/db'

export default function AdminPanel({ onClose }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true); setError(null)
    try { setProfiles(await listProfiles()) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Admin</h2>
          <button className="link" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error">{error}</div>}
        {loading ? (
          <div className="state">Loading…</div>
        ) : (
          <ul className="admin-list">
            {profiles.map((p) => (
              <li key={p.id}>
                <div className="admin-row">
                  <div>
                    <strong>{p.display_name || p.email}</strong>
                    <div className="muted">{p.email}</div>
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
        )}
      </div>
    </div>
  )
}
