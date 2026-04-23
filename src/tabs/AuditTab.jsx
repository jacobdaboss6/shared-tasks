import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listMonths, getActiveMonth, listMyAssignmentsForMonth,
  listBrandChecklistForMonth, upsertBrandChecklist,
  listModelChecklistForAssignments, upsertModelChecklist,
  reconcileMonthModels,
} from '../lib/db'
import { parseInventoryFile } from '../lib/excel'

const STATUSES = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done',        label: 'Done' },
  { value: 'skipped',     label: 'Skipped' },
]

export default function AuditTab({ profile }) {
  const [months, setMonths]     = useState([])
  const [monthId, setMonthId]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [assignments, setAssignments] = useState([]) // my assignments for this month
  const [brandChecklist, setBrandChecklist] = useState([]) // all rows for month (to show teammates' progress if wanted)
  const [modelRows, setModelRows] = useState([]) // my model_checklist rows across my assignments

  const [info, setInfo] = useState(null)
  const [importing, setImporting] = useState(false)

  const dropRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { boot() }, [])
  async function boot() {
    setLoading(true); setError(null)
    try {
      const [ms, active] = await Promise.all([listMonths(), getActiveMonth()])
      setMonths(ms)
      setMonthId(active?.id ?? ms[0]?.id ?? null)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const loadMonthData = useCallback(async (mid) => {
    if (!mid) { setAssignments([]); setBrandChecklist([]); setModelRows([]); return }
    setError(null)
    try {
      const [mine, bc] = await Promise.all([
        listMyAssignmentsForMonth(mid),
        listBrandChecklistForMonth(mid),
      ])
      setAssignments(mine)
      setBrandChecklist(bc)
      const models = await listModelChecklistForAssignments(mine.map((a) => a.id))
      setModelRows(models)
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { loadMonthData(monthId) }, [monthId, loadMonthData])

  // Index brand checklist by assignment for quick status lookup.
  const bcByAssignment = useMemo(() => {
    const m = new Map()
    for (const r of brandChecklist) m.set(r.assignment_id, r)
    return m
  }, [brandChecklist])

  const modelsByAssignment = useMemo(() => {
    const m = new Map()
    for (const r of modelRows) {
      if (!m.has(r.assignment_id)) m.set(r.assignment_id, [])
      m.get(r.assignment_id).push(r)
    }
    return m
  }, [modelRows])

  async function updateBrandStatus(assignment_id, status) {
    const prev = bcByAssignment.get(assignment_id)
    try {
      await upsertBrandChecklist({ assignment_id, status, notes: prev?.notes ?? null })
      setBrandChecklist((rows) => {
        const i = rows.findIndex((r) => r.assignment_id === assignment_id)
        if (i >= 0) {
          const copy = [...rows]; copy[i] = { ...rows[i], status }; return copy
        }
        return [...rows, { assignment_id, status, notes: null }]
      })
    } catch (e) { setError(e.message) }
  }

  async function updateBrandNotes(assignment_id, notes) {
    const prev = bcByAssignment.get(assignment_id)
    try {
      await upsertBrandChecklist({ assignment_id, status: prev?.status ?? 'pending', notes })
      setBrandChecklist((rows) => {
        const i = rows.findIndex((r) => r.assignment_id === assignment_id)
        if (i >= 0) {
          const copy = [...rows]; copy[i] = { ...rows[i], notes }; return copy
        }
        return [...rows, { assignment_id, status: 'pending', notes }]
      })
    } catch (e) { setError(e.message) }
  }

  async function updateModel(row, patch) {
    try {
      await upsertModelChecklist({
        id: row.id,
        assignment_id: row.assignment_id,
        model: row.model,
        status: patch.status ?? row.status,
        notes: patch.notes ?? row.notes,
      })
      setModelRows((rows) => rows.map((r) => r.id === row.id ? { ...r, ...patch } : r))
    } catch (e) { setError(e.message) }
  }

  async function handleInventoryFile(file) {
    if (!file || !monthId) return
    setImporting(true); setError(null); setInfo(null)
    try {
      const inventory = await parseInventoryFile(file)
      const result = await reconcileMonthModels({
        assignments: assignments.map((a) => ({ id: a.id, brand: a.brand })),
        inventoryRows: inventory,
      })
      setInfo(`Reconciled: ${result.inserted} new model(s), ${result.kept} kept, ${result.deleted} removed.`)
      // Re-load models.
      const models = await listModelChecklistForAssignments(assignments.map((a) => a.id))
      setModelRows(models)
    } catch (e) { setError(e.message) }
    setImporting(false)
  }

  // Drag-and-drop wiring for the inventory dropzone.
  useEffect(() => {
    const zone = dropRef.current
    if (!zone) return
    const onOver  = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); zone.classList.add('over') } }
    const onLeave = () => zone.classList.remove('over')
    const onDrop  = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault(); zone.classList.remove('over')
      const f = e.dataTransfer.files?.[0]; if (f) handleInventoryFile(f)
    }
    zone.addEventListener('dragover', onOver)
    zone.addEventListener('dragleave', onLeave)
    zone.addEventListener('drop', onDrop)
    const onWindowDrop = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', onWindowDrop)
    window.addEventListener('drop', onWindowDrop)
    return () => {
      zone.removeEventListener('dragover', onOver)
      zone.removeEventListener('dragleave', onLeave)
      zone.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onWindowDrop)
      window.removeEventListener('drop', onWindowDrop)
    }
  }, [assignments, monthId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Progress rollups.
  const progress = useMemo(() => {
    const total = assignments.length
    let done = 0, inProgress = 0
    for (const a of assignments) {
      const s = bcByAssignment.get(a.id)?.status
      if (s === 'done') done++
      else if (s === 'in_progress') inProgress++
    }
    const totalModels = modelRows.length
    const doneModels  = modelRows.filter((r) => r.status === 'done').length
    return { total, done, inProgress, totalModels, doneModels }
  }, [assignments, bcByAssignment, modelRows])

  if (loading) return <div className="state">Loading…</div>

  const selectedMonthLabel = months.find((m) => m.id === monthId)?.label || '—'

  return (
    <div className="tab audit-tab">
      {error && <div className="error">{error}</div>}
      {info  && <div className="info">{info}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Your audit</h2>
          <span className="muted">Signed in as {profile?.display_name || profile?.email}</span>
        </div>
        <div className="row">
          <label className="field grow">
            <span>Month</span>
            <select value={monthId ?? ''} onChange={(e) => setMonthId(e.target.value || null)}>
              {months.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.is_active ? ' — active' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="progress-row">
          <span className="muted">
            Brands: {progress.done}/{progress.total} done
            {progress.inProgress ? ` · ${progress.inProgress} in progress` : ''}
          </span>
          <div className="progress-bar">
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
        {progress.totalModels > 0 && (
          <div className="progress-row">
            <span className="muted">Models: {progress.doneModels}/{progress.totalModels} done</span>
            <div className="progress-bar">
              <span style={{ width: `${progress.totalModels ? (progress.doneModels / progress.totalModels) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Inventory import</h2>
          <span className="muted">Adds/updates your model checklist from an inventory file.</span>
        </div>
        <div
          ref={dropRef}
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <strong>Click or drop</strong>
          <span>.xlsx, .xls, or .csv — only your brands are read</span>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleInventoryFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {importing && <div className="state">Parsing and reconciling…</div>}
        <p className="hint">
          <span style={{ color: '#c0392b' }}>Windows tip:</span> if the file picker hides your file, switch its filter from “Custom” to <strong>All Files</strong>.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Your brands for {selectedMonthLabel}</h2>
          <span className="muted">{assignments.length} total</span>
        </div>
        {assignments.length === 0 ? (
          <div className="state empty">
            Nothing assigned to you for this month. An admin can run Randomize on the Randomize tab.
          </div>
        ) : (
          <ul className="audit-list">
            {assignments.map((a) => {
              const bc = bcByAssignment.get(a.id)
              const status = bc?.status || 'pending'
              const notes  = bc?.notes  || ''
              const models = modelsByAssignment.get(a.id) || []
              return (
                <li key={a.id} className={`audit-row status-${status}`}>
                  <div className="audit-row-head">
                    <strong>{a.brand?.name || '(unknown)'}</strong>
                    <select
                      value={status}
                      onChange={(e) => updateBrandStatus(a.id, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    className="notes"
                    placeholder="Notes (optional)"
                    defaultValue={notes}
                    onBlur={(e) => {
                      if (e.target.value !== notes) updateBrandNotes(a.id, e.target.value || null)
                    }}
                  />
                  {models.length > 0 && (
                    <details className="models">
                      <summary>
                        {models.filter((m) => m.status === 'done').length}/{models.length} models
                      </summary>
                      <ul>
                        {models.map((m) => (
                          <li key={m.id} className={`status-${m.status}`}>
                            <label className="model-line">
                              <input
                                type="checkbox"
                                checked={m.status === 'done'}
                                onChange={(e) =>
                                  updateModel(m, { status: e.target.checked ? 'done' : 'pending' })
                                }
                              />
                              <span>{m.model}</span>
                            </label>
                            <select
                              value={m.status}
                              onChange={(e) => updateModel(m, { status: e.target.value })}
                            >
                              {STATUSES.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
