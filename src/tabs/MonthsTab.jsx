import { useEffect, useState } from 'react'
import {
  listMonths, setMonthActive, setMonthFrozen, renameMonth, deleteMonth,
  listAssignmentsForMonth, listBrandChecklistForMonth, listMyAssignmentsForMonth,
} from '../lib/db'
import { exportMonthXlsx } from '../lib/excel'

export default function MonthsTab({ profile, isAdmin }) {
  const [months, setMonths]       = useState([])
  const [error, setError]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [details, setDetails]     = useState({})

  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true); setError(null)
    try {
      const ms = await listMonths()
      // Members only see past frozen months (current active month is on Audit).
      setMonths(isAdmin ? ms : ms.filter((m) => m.is_frozen))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function loadDetails(monthId) {
    if (details[monthId]) return
    try {
      if (isAdmin) {
        const [assignments, checklist] = await Promise.all([
          listAssignmentsForMonth(monthId),
          listBrandChecklistForMonth(monthId),
        ])
        const statusByAssignment = new Map()
        for (const c of checklist) statusByAssignment.set(c.assignment_id, c.status)

        const byPerson = new Map()
        for (const a of assignments) {
          const key = a.person_id
          if (!byPerson.has(key)) byPerson.set(key, { person: a.person, brands: [] })
          byPerson.get(key).brands.push({
            ...a.brand,
            assignment_id: a.id,
            status: statusByAssignment.get(a.id) || 'pending',
          })
        }
        const groups = Array.from(byPerson.values())
        const total = assignments.length
        const done  = assignments.filter((a) => statusByAssignment.get(a.id) === 'done').length
        const inProgress = assignments.filter((a) => statusByAssignment.get(a.id) === 'in_progress').length
        setDetails((d) => ({ ...d, [monthId]: { kind: 'admin', groups, total, done, inProgress } }))
      } else {
        // Member view: their own brands + statuses only.
        const [mine, checklist] = await Promise.all([
          listMyAssignmentsForMonth(monthId),
          listBrandChecklistForMonth(monthId),
        ])
        const statusByAssignment = new Map()
        for (const c of checklist) statusByAssignment.set(c.assignment_id, c.status)
        const brands = mine.map((a) => ({
          ...a.brand,
          assignment_id: a.id,
          status: statusByAssignment.get(a.id) || 'pending',
        }))
        const total = brands.length
        const done  = brands.filter((b) => b.status === 'done').length
        const inProgress = brands.filter((b) => b.status === 'in_progress').length
        setDetails((d) => ({ ...d, [monthId]: { kind: 'member', brands, total, done, inProgress } }))
      }
    } catch (e) { setError(e.message) }
  }

  function toggleExpand(monthId) {
    if (expandedId === monthId) { setExpandedId(null); return }
    setExpandedId(monthId)
    loadDetails(monthId)
  }

  async function onSetActive(monthId) {
    try { await setMonthActive(monthId); await reload(); setDetails({}) }
    catch (e) { setError(e.message) }
  }

  async function onToggleFrozen(m) {
    try { await setMonthFrozen(m.id, !m.is_frozen); await reload() }
    catch (e) { setError(e.message) }
  }

  async function onRename(m) {
    const v = prompt('New label for this month:', m.label)
    if (!v || v === m.label) return
    try { await renameMonth(m.id, v.trim()); await reload() }
    catch (e) { setError(e.message) }
  }

  async function onDelete(m) {
    if (!confirm(`Delete "${m.label}"? Assignments and checklist data for this month will be removed.`)) return
    try { await deleteMonth(m.id); await reload() }
    catch (e) { setError(e.message) }
  }

  async function onExport(m) {
    if (!isAdmin) return
    try {
      const assignments = await listAssignmentsForMonth(m.id)
      const byPerson = new Map()
      for (const a of assignments) {
        const key = a.person_id
        if (!byPerson.has(key)) byPerson.set(key, { person: a.person, brands: [] })
        byPerson.get(key).brands.push({ name: a.brand?.name || '' })
      }
      const groups = Array.from(byPerson.values()).map((g) => ({
        person: g.person,
        brands: g.brands.map((b) => ({ name: b.name })),
      }))
      exportMonthXlsx({ monthLabel: m.label, assignmentsByPerson: groups })
    } catch (e) { setError(e.message) }
  }

  if (loading) return <div className="state">Loading…</div>

  return (
    <div className="tab months-tab">
      {error && <div className="error">{error}</div>}

      {months.length === 0 && (
        <div className="state empty">
          {isAdmin
            ? 'No months yet. Create one on the Randomize tab.'
            : 'No past months yet. Your active month is on the Audit tab.'}
        </div>
      )}

      <ul className="month-list">
        {months.map((m) => {
          const d = details[m.id]
          const isOpen = expandedId === m.id
          const classes = ['month']
          if (m.is_active) classes.push('is-active')
          if (m.is_frozen) classes.push('is-frozen')
          return (
            <li key={m.id} className={classes.join(' ')}>
              <div className="month-head">
                <button
                  className="month-label"
                  onClick={() => toggleExpand(m.id)}
                  aria-expanded={isOpen}
                >
                  <span className="chev">{isOpen ? '▾' : '▸'}</span>
                  <strong>{m.label}</strong>
                  {m.is_active && <em className="tag active">active</em>}
                  {m.is_frozen && <em className="tag frozen">frozen</em>}
                </button>
                {isAdmin && (
                  <div className="month-actions">
                    <button className="mini" onClick={() => onExport(m)}>Export</button>
                    {!m.is_active && (
                      <button className="mini" onClick={() => onSetActive(m.id)}>Set active</button>
                    )}
                    <button className="mini" onClick={() => onToggleFrozen(m)}>
                      {m.is_frozen ? 'Unfreeze' : 'Freeze'}
                    </button>
                    <button className="mini" onClick={() => onRename(m)}>Rename</button>
                    <button className="mini danger" onClick={() => onDelete(m)}>Delete</button>
                  </div>
                )}
              </div>

              {isOpen && (
                <div className="month-body">
                  {!d ? (
                    <div className="state">Loading…</div>
                  ) : d.kind === 'admin' ? (
                    <>
                      <div className="progress-row">
                        <span className="muted">
                          {d.done}/{d.total} brands done
                          {d.inProgress ? ` · ${d.inProgress} in progress` : ''}
                        </span>
                        <div className="progress-bar">
                          <span style={{ width: `${d.total ? (d.done / d.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <div className="person-grid">
                        {d.groups.map((g) => (
                          <div key={g.person.id} className="person-col">
                            <div className="person-head">
                              <strong>{g.person.display_name || g.person.email}</strong>
                              <span className="muted">{g.brands.length}</span>
                            </div>
                            <ul className="brand-lines">
                              {g.brands.map((b) => (
                                <li key={b.assignment_id} className={`status-${b.status}`}>
                                  <span>{b.name}</span>
                                  <em className={`pill pill-${b.status}`}>{b.status.replace('_',' ')}</em>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="progress-row">
                        <span className="muted">
                          {d.done}/{d.total} brands done
                          {d.inProgress ? ` · ${d.inProgress} in progress` : ''}
                        </span>
                        <div className="progress-bar">
                          <span style={{ width: `${d.total ? (d.done / d.total) * 100 : 0}%` }} />
                        </div>
                      </div>
                      <div className="person-grid">
                        <div className="person-col">
                          <div className="person-head">
                            <strong>{profile?.display_name || profile?.email || 'You'}</strong>
                            <span className="muted">{d.brands.length}</span>
                          </div>
                          <ul className="brand-lines">
                            {d.brands.map((b) => (
                              <li key={b.assignment_id} className={`status-${b.status}`}>
                                <span>{b.name}</span>
                                <em className={`pill pill-${b.status}`}>{b.status.replace('_',' ')}</em>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
