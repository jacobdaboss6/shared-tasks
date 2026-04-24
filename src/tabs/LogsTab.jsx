import { useEffect, useMemo, useState } from 'react'
import {
  listStatusLog, listMonths, listProfiles, listBrands,
} from '../lib/db'
import { exportStatusLogXlsx } from '../lib/excel'

const STATUSES = [
  { value: '',            label: 'Any' },
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done',        label: 'Done' },
  { value: 'skipped',     label: 'Skipped' },
]

const GROUPS = [
  { value: 'none',   label: 'No grouping' },
  { value: 'person', label: 'By person' },
  { value: 'month',  label: 'By month' },
  { value: 'brand',  label: 'By brand' },
]

function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function prettyStatus(s) {
  if (!s) return '—'
  return s.replace('_', ' ')
}

export default function LogsTab() {
  const [entries, setEntries]   = useState([])
  const [months, setMonths]     = useState([])
  const [profiles, setProfiles] = useState([])
  const [brands, setBrands]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [f, setF] = useState({
    monthId: '', personId: '', brandId: '',
    fromStatus: '', toStatus: '',
    since: '', until: '',
  })
  const [groupBy, setGroupBy] = useState('none')

  useEffect(() => { boot() }, [])
  async function boot() {
    setLoading(true); setError(null)
    try {
      const [ms, ps, bs] = await Promise.all([listMonths(), listProfiles(), listBrands()])
      setMonths(ms); setProfiles(ps); setBrands(bs)
      await fetchEntries({})
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function fetchEntries(filters) {
    setError(null)
    try {
      const payload = {}
      if (filters.monthId)    payload.monthId    = filters.monthId
      if (filters.personId)   payload.personId   = filters.personId
      if (filters.brandId)    payload.brandId    = filters.brandId
      if (filters.fromStatus) payload.fromStatus = filters.fromStatus
      if (filters.toStatus)   payload.toStatus   = filters.toStatus
      if (filters.since)      payload.since      = new Date(filters.since).toISOString()
      if (filters.until)      payload.until      = new Date(filters.until).toISOString()
      payload.limit = 500
      setEntries(await listStatusLog(payload))
    } catch (e) { setError(e.message) }
  }

  function onFilter(k, v) {
    const next = { ...f, [k]: v }
    setF(next)
    fetchEntries(next)
  }

  function onReset() {
    const empty = { monthId: '', personId: '', brandId: '', fromStatus: '', toStatus: '', since: '', until: '' }
    setF(empty); fetchEntries(empty)
  }

  function onExport() {
    exportStatusLogXlsx({
      entries,
      filename: `status_log_${new Date().toISOString().slice(0, 10)}.xlsx`,
    })
  }

  const grouped = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', label: '', rows: entries }]
    const keyFn = {
      person: (e) => e.person_id,
      month:  (e) => e.month_id,
      brand:  (e) => e.brand_id,
    }[groupBy]
    const labelFn = {
      person: (e) => e.person?.display_name || e.person?.email || '(unknown)',
      month:  (e) => e.month?.label || '(unknown)',
      brand:  (e) => e.brand?.name || '(unknown)',
    }[groupBy]
    const map = new Map()
    for (const e of entries) {
      const k = keyFn(e) || ''
      if (!map.has(k)) map.set(k, { key: k, label: labelFn(e), rows: [] })
      map.get(k).rows.push(e)
    }
    return [...map.values()].sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  }, [entries, groupBy])

  if (loading) return <div className="state">Loading…</div>

  return (
    <div className="tab logs-tab">
      {error && <div className="error">{error}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Status change log</h2>
          <span className="muted">{entries.length} entries</span>
        </div>

        <div className="logs-filters">
          <label className="field">
            <span>Month</span>
            <select value={f.monthId} onChange={(e) => onFilter('monthId', e.target.value)}>
              <option value="">All</option>
              {months.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Person</span>
            <select value={f.personId} onChange={(e) => onFilter('personId', e.target.value)}>
              <option value="">All</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name || p.email}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Brand</span>
            <select value={f.brandId} onChange={(e) => onFilter('brandId', e.target.value)}>
              <option value="">All</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>From status</span>
            <select value={f.fromStatus} onChange={(e) => onFilter('fromStatus', e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>To status</span>
            <select value={f.toStatus} onChange={(e) => onFilter('toStatus', e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Since</span>
            <input type="datetime-local" value={f.since} onChange={(e) => onFilter('since', e.target.value)} />
          </label>
          <label className="field">
            <span>Until</span>
            <input type="datetime-local" value={f.until} onChange={(e) => onFilter('until', e.target.value)} />
          </label>
          <label className="field">
            <span>Group by</span>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </label>
          <div className="logs-filter-actions">
            <button className="btn" onClick={onReset}>Reset</button>
            <button className="btn primary" onClick={onExport} disabled={!entries.length}>
              Export XLSX
            </button>
          </div>
        </div>
      </section>

      {entries.length === 0 ? (
        <div className="state empty">No log entries match the current filters.</div>
      ) : grouped.map((g) => (
        <section key={g.key || 'flat'} className="card">
          {groupBy !== 'none' && (
            <div className="card-head">
              <h3>{g.label}</h3>
              <span className="muted">{g.rows.length}</span>
            </div>
          )}
          <table className="logs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Brand</th>
                <th>Month</th>
                <th>From → To</th>
                <th>Changed by</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmtDateTime(e.changed_at)}</td>
                  <td>{e.person?.display_name || e.person?.email || '—'}</td>
                  <td>{e.brand?.name || '—'}</td>
                  <td>{e.month?.label || '—'}</td>
                  <td className="nowrap">
                    <em className={`pill pill-${e.previous_status || 'pending'}`}>{prettyStatus(e.previous_status)}</em>
                    <span className="arrow">→</span>
                    <em className={`pill pill-${e.new_status}`}>{prettyStatus(e.new_status)}</em>
                  </td>
                  <td>{e.changer?.display_name || e.changer?.email || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}
