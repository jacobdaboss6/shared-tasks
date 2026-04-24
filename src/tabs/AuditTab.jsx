import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listMonths, getActiveMonth, listMyAssignmentsForMonth,
  listBrandChecklistForMonth, upsertBrandChecklist, listBrands,
  getLatestSnapshot, createInventorySnapshot,
  listInventoryRowsForSnapshot, listSnapshotBrandCodes,
  createAdminNotifications, listProfiles,
} from '../lib/db'
import { parseInventoryFile } from '../lib/excel'
import { subscribeToSnapshots } from '../lib/realtime'
import PrintSheet from '../print/PrintSheet'

const STATUSES = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done',        label: 'Done' },
  { value: 'skipped',     label: 'Skipped' },
]

function fmtTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function AuditTab({ profile, isAdmin }) {
  const [months, setMonths]     = useState([])
  const [monthId, setMonthId]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [assignments, setAssignments]     = useState([])
  const [brandChecklist, setBrandChecklist] = useState([])

  // Snapshot state.
  const [latestSnapshot, setLatestSnapshot] = useState(null)
  const [activeSnapshot, setActiveSnapshot] = useState(null)
  const [uploaders, setUploaders]           = useState(new Map()) // id -> profile
  const [importing, setImporting]           = useState(false)
  const [info, setInfo]                     = useState(null)

  // Print state.
  const [selectedForPrint, setSelectedForPrint] = useState(new Set())
  const [printRequest, setPrintRequest]         = useState(null) // { brands, meta, rows }
  const [adminPrintBrandId, setAdminPrintBrandId] = useState('')
  const [allBrands, setAllBrands] = useState([])

  const dropRef = useRef(null)
  const fileRef = useRef(null)

  // ----- Boot -----
  useEffect(() => { boot() }, [])
  async function boot() {
    setLoading(true); setError(null)
    try {
      const [ms, active, latest, profs, brandList] = await Promise.all([
        listMonths(),
        getActiveMonth(),
        getLatestSnapshot(),
        listProfiles(),
        listBrands(),
      ])
      setMonths(ms)
      setMonthId(active?.id ?? ms[0]?.id ?? null)
      setLatestSnapshot(latest)
      setActiveSnapshot(latest)
      setUploaders(new Map(profs.map((p) => [p.id, p])))
      setAllBrands(brandList)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  // ----- Realtime: new snapshot from someone else -----
  useEffect(() => {
    const unsub = subscribeToSnapshots(async (snap) => {
      // Refresh uploaders so we can display their name.
      try {
        const ps = await listProfiles()
        setUploaders(new Map(ps.map((p) => [p.id, p])))
      } catch { /* ignore */ }
      setLatestSnapshot(snap)
    })
    return unsub
  }, [])

  // ----- Load assignments + checklist for selected month -----
  const loadMonthData = useCallback(async (mid) => {
    if (!mid) { setAssignments([]); setBrandChecklist([]); return }
    setError(null)
    try {
      const [mine, bc] = await Promise.all([
        listMyAssignmentsForMonth(mid),
        listBrandChecklistForMonth(mid),
      ])
      setAssignments(mine)
      setBrandChecklist(bc)
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { loadMonthData(monthId) }, [monthId, loadMonthData])

  const bcByAssignment = useMemo(() => {
    const m = new Map()
    for (const r of brandChecklist) m.set(r.assignment_id, r)
    return m
  }, [brandChecklist])

  // ----- Status / notes updates -----
  async function updateBrandStatus(assignment_id, status) {
    const prev = bcByAssignment.get(assignment_id)
    try {
      await upsertBrandChecklist({ assignment_id, status, notes: prev?.notes ?? null })
      setBrandChecklist((rows) => {
        const i = rows.findIndex((r) => r.assignment_id === assignment_id)
        if (i >= 0) { const copy = [...rows]; copy[i] = { ...rows[i], status }; return copy }
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
        if (i >= 0) { const copy = [...rows]; copy[i] = { ...rows[i], notes }; return copy }
        return [...rows, { assignment_id, status: 'pending', notes }]
      })
    } catch (e) { setError(e.message) }
  }

  // ----- Inventory upload -----
  async function handleInventoryFile(file) {
    if (!file) return
    setImporting(true); setError(null); setInfo(null)
    try {
      const rows = await parseInventoryFile(file)
      if (!rows.length) throw new Error('No rows found in that file.')
      const snap = await createInventorySnapshot({ filename: file.name, rows })

      // Unrecognized-brand detection.
      const snapBrandCodes = await listSnapshotBrandCodes(snap.id)
      const knownNorm = new Set(allBrands.map((b) => b.normalized))
      const unknown = snapBrandCodes.filter((s) => !knownNorm.has(s.brand_normalized))
      if (unknown.length) {
        await createAdminNotifications(unknown.map((u) => ({
          kind: 'unrecognized_brand',
          payload: {
            brand_raw: u.brand_raw,
            brand_normalized: u.brand_normalized,
            snapshot_id: snap.id,
            filename: file.name,
          },
        })))
      }

      setLatestSnapshot(snap)
      setActiveSnapshot(snap)
      setInfo(
        `Uploaded ${rows.length} rows · ${snapBrandCodes.length} brands` +
        (unknown.length ? ` · ${unknown.length} not in master list (admin notified)` : '')
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  // Drag-and-drop wiring.
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- Print flow -----
  function toggleSelected(assignmentId) {
    setSelectedForPrint((s) => {
      const n = new Set(s)
      n.has(assignmentId) ? n.delete(assignmentId) : n.add(assignmentId)
      return n
    })
  }

  async function printAssignments(assignmentIds) {
    if (!activeSnapshot) { setError('Upload an inventory file first.'); return }
    const brands = assignments
      .filter((a) => assignmentIds.includes(a.id))
      .map((a) => ({ id: a.brand?.id, name: a.brand?.name, normalized: a.brand?.normalized }))
      .filter((b) => b.normalized)
    if (!brands.length) return
    try {
      const rows = await listInventoryRowsForSnapshot(
        activeSnapshot.id, brands.map((b) => b.normalized)
      )
      // Group rows by normalized brand.
      const byBrand = new Map()
      for (const r of rows) {
        const k = r.brand_normalized
        if (!byBrand.has(k)) byBrand.set(k, [])
        byBrand.get(k).push(r)
      }
      const sections = brands.map((b) => ({
        brand: b,
        rows: byBrand.get(b.normalized) || [],
      }))
      const monthLabel = months.find((m) => m.id === monthId)?.label || ''
      setPrintRequest({
        sections,
        meta: {
          personName: profile?.display_name || profile?.email || '',
          monthLabel,
          snapshotAt: activeSnapshot.uploaded_at,
          uploader: uploaders.get(activeSnapshot.uploaded_by)?.display_name
                 || uploaders.get(activeSnapshot.uploaded_by)?.email
                 || '',
        },
      })
    } catch (e) { setError(e.message) }
  }

  async function printAnyBrand() {
    if (!adminPrintBrandId || !activeSnapshot) return
    const b = allBrands.find((x) => x.id === adminPrintBrandId)
    if (!b) return
    try {
      const rows = await listInventoryRowsForSnapshot(activeSnapshot.id, [b.normalized])
      setPrintRequest({
        sections: [{ brand: { name: b.name, normalized: b.normalized }, rows }],
        meta: {
          personName: '(admin)',
          monthLabel: months.find((m) => m.id === monthId)?.label || '',
          snapshotAt: activeSnapshot.uploaded_at,
          uploader: uploaders.get(activeSnapshot.uploaded_by)?.display_name
                 || uploaders.get(activeSnapshot.uploaded_by)?.email
                 || '',
        },
      })
    } catch (e) { setError(e.message) }
  }

  // Trigger the browser print dialog once printRequest is set and rendered.
  useEffect(() => {
    if (!printRequest) return
    const t = setTimeout(() => { try { window.print() } catch { /* ignore */ } }, 50)
    return () => clearTimeout(t)
  }, [printRequest])

  // Clear printRequest after print dialog closes.
  useEffect(() => {
    const onAfter = () => setPrintRequest(null)
    window.addEventListener('afterprint', onAfter)
    return () => window.removeEventListener('afterprint', onAfter)
  }, [])

  // ----- Snapshot banner -----
  const uploaderName =
    latestSnapshot
      ? (uploaders.get(latestSnapshot.uploaded_by)?.display_name
         || uploaders.get(latestSnapshot.uploaded_by)?.email
         || 'someone')
      : null
  const isSnapshotStale = latestSnapshot
    && activeSnapshot
    && latestSnapshot.id !== activeSnapshot.id

  // ----- Progress -----
  const progress = useMemo(() => {
    const total = assignments.length
    let done = 0, inProgress = 0
    for (const a of assignments) {
      const s = bcByAssignment.get(a.id)?.status
      if (s === 'done') done++
      else if (s === 'in_progress') inProgress++
    }
    return { total, done, inProgress }
  }, [assignments, bcByAssignment])

  if (loading) return <div className="state">Loading…</div>

  const selectedMonth = months.find((m) => m.id === monthId)
  const selectedMonthLabel = selectedMonth?.label || '—'

  return (
    <div className="tab audit-tab">
      {error && <div className="error">{error}</div>}
      {info  && <div className="info">{info}</div>}

      {/* Snapshot banner */}
      <section className="card snapshot-card">
        <div className="card-head">
          <h2>Inventory snapshot</h2>
          {activeSnapshot ? (
            <span className="muted">
              {activeSnapshot.row_count} rows · uploaded by {uploaderName || '—'} at {fmtTime(activeSnapshot.uploaded_at)}
            </span>
          ) : (
            <span className="muted">None uploaded yet</span>
          )}
        </div>
        {isSnapshotStale && (
          <div className="info warn">
            A newer snapshot was uploaded by {
              uploaders.get(latestSnapshot.uploaded_by)?.display_name
              || uploaders.get(latestSnapshot.uploaded_by)?.email
              || 'someone'
            } at {fmtTime(latestSnapshot.uploaded_at)} ({latestSnapshot.row_count} rows).
            <button className="mini" onClick={() => setActiveSnapshot(latestSnapshot)}>
              Use new snapshot
            </button>
          </div>
        )}
        <div
          ref={dropRef}
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <strong>Click or drop a new inventory file</strong>
          <span>.xlsx, .xls, or .csv — your teammates will be notified</span>
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
        {importing && <div className="state">Uploading…</div>}
        <p className="hint">
          <span style={{ color: '#c0392b' }}>Windows tip:</span> if the file picker hides your file,
          switch its filter from “Custom” to <strong>All Files</strong>.
        </p>
      </section>

      {/* Month + progress */}
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
                  {m.label}{m.is_active ? ' — active' : ''}{m.is_frozen ? ' — frozen' : ''}
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
      </section>

      {/* Admin "print any brand" */}
      {isAdmin && (
        <section className="card">
          <div className="card-head">
            <h2>Print any brand (admin)</h2>
            <span className="muted">For walking a teammate's brand</span>
          </div>
          <div className="row">
            <label className="field grow">
              <span>Brand</span>
              <select value={adminPrintBrandId} onChange={(e) => setAdminPrintBrandId(e.target.value)}>
                <option value="">Pick one…</option>
                {allBrands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <button className="btn" onClick={printAnyBrand} disabled={!adminPrintBrandId || !activeSnapshot}>
              Print
            </button>
          </div>
        </section>
      )}

      {/* Your brands */}
      <section className="card">
        <div className="card-head">
          <h2>Your brands for {selectedMonthLabel}</h2>
          <span className="muted">{assignments.length} total</span>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={() => printAssignments([...selectedForPrint])}
            disabled={!selectedForPrint.size || !activeSnapshot}
          >
            Print selected ({selectedForPrint.size})
          </button>
          <button
            className="btn"
            onClick={() => printAssignments(assignments.map((a) => a.id))}
            disabled={!assignments.length || !activeSnapshot}
          >
            Print all my brands
          </button>
          {!activeSnapshot && (
            <span className="muted">Upload an inventory file to enable printing.</span>
          )}
        </div>
        {assignments.length === 0 ? (
          <div className="state empty">
            Nothing assigned to you for this month.
          </div>
        ) : (
          <ul className="audit-list">
            {assignments.map((a) => {
              const bc = bcByAssignment.get(a.id)
              const status = bc?.status || 'pending'
              const notes  = bc?.notes  || ''
              return (
                <li key={a.id} className={`audit-row status-${status}`}>
                  <div className="audit-row-head">
                    <label className="audit-check">
                      <input
                        type="checkbox"
                        checked={selectedForPrint.has(a.id)}
                        onChange={() => toggleSelected(a.id)}
                      />
                    </label>
                    <strong>{a.brand?.name || '(unknown)'}</strong>
                    <select
                      value={status}
                      onChange={(e) => updateBrandStatus(a.id, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      className="mini"
                      onClick={() => printAssignments([a.id])}
                      disabled={!activeSnapshot}
                    >
                      Print
                    </button>
                  </div>
                  <textarea
                    className="notes"
                    placeholder="Notes (optional)"
                    defaultValue={notes}
                    onBlur={(e) => {
                      if (e.target.value !== notes) updateBrandNotes(a.id, e.target.value || null)
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Hidden print sheet */}
      {printRequest && <PrintSheet request={printRequest} />}
    </div>
  )
}
