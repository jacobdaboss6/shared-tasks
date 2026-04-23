import { useEffect, useMemo, useState } from 'react'
import {
  listProfiles, listBrands, addBrand, setBrandActive, deleteBrand,
  createMonthWithAssignments,
} from '../lib/db'
import { distribute } from '../lib/randomize'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function defaultMonthYear() {
  const now = new Date()
  const m = now.getMonth() === 11 ? 0 : now.getMonth() + 1
  const y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()
  return { month: m, year: y }
}

export default function RandomizeTab({ isAdmin }) {
  const [profiles, setProfiles] = useState([])
  const [brands, setBrands]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const [selectedPeople, setSelectedPeople] = useState(new Set()) // profile ids
  const [selectedBrands, setSelectedBrands] = useState(new Set()) // brand ids
  const { month: m0, year: y0 } = defaultMonthYear()
  const [month, setMonth] = useState(m0)
  const [year, setYear]   = useState(y0)
  const [label, setLabel] = useState('')
  const [setActiveOnSave, setSetActiveOnSave] = useState(true)

  const [draft, setDraft] = useState(null) // { distribution: {pid: [bid]}, people, brandsById }
  const [saving, setSaving] = useState(false)
  const [savedInfo, setSavedInfo] = useState(null)

  const [newBrand, setNewBrand] = useState('')

  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true); setError(null)
    try {
      const [ps, bs] = await Promise.all([listProfiles(), listBrands()])
      setProfiles(ps)
      setBrands(bs)
      // Default selections: everyone, all active brands.
      setSelectedPeople(new Set(ps.map((p) => p.id)))
      setSelectedBrands(new Set(bs.filter((b) => b.active).map((b) => b.id)))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  const brandsById = useMemo(() => {
    const m = new Map()
    for (const b of brands) m.set(b.id, b)
    return m
  }, [brands])

  function togglePerson(id) {
    setSelectedPeople((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }
  function toggleBrand(id) {
    setSelectedBrands((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function onAddBrand(e) {
    e.preventDefault()
    const v = newBrand.trim()
    if (!v) return
    try {
      const created = await addBrand(v)
      setBrands((bs) => [...bs, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedBrands((s) => { const n = new Set(s); n.add(created.id); return n })
      setNewBrand('')
    } catch (err) { setError(err.message) }
  }

  async function onToggleBrandActive(brand) {
    try {
      await setBrandActive(brand.id, !brand.active)
      setBrands((bs) => bs.map((b) => (b.id === brand.id ? { ...b, active: !b.active } : b)))
    } catch (err) { setError(err.message) }
  }

  async function onDeleteBrand(brand) {
    if (!confirm(`Delete brand "${brand.name}"? This removes it from the master list.`)) return
    try {
      await deleteBrand(brand.id)
      setBrands((bs) => bs.filter((b) => b.id !== brand.id))
      setSelectedBrands((s) => { const n = new Set(s); n.delete(brand.id); return n })
    } catch (err) { setError(err.message) }
  }

  function run() {
    const people = profiles.filter((p) => selectedPeople.has(p.id))
    const brandIds = brands.filter((b) => selectedBrands.has(b.id)).map((b) => b.id)
    if (!people.length) { setError('Pick at least one person.'); return }
    if (!brandIds.length) { setError('Pick at least one brand.'); return }
    setError(null); setSavedInfo(null)
    setDraft({
      distribution: distribute(people, brandIds),
      people,
    })
  }

  function moveInDraft(brandId, fromPid, toPid) {
    setDraft((d) => {
      if (!d) return d
      const next = { ...d, distribution: { ...d.distribution } }
      next.distribution[fromPid] = next.distribution[fromPid].filter((id) => id !== brandId)
      next.distribution[toPid]   = [...next.distribution[toPid], brandId]
      return next
    })
  }
  function removeFromDraft(brandId, pid) {
    setDraft((d) => {
      if (!d) return d
      const next = { ...d, distribution: { ...d.distribution } }
      next.distribution[pid] = next.distribution[pid].filter((id) => id !== brandId)
      return next
    })
  }
  function addToDraft(pid, brandId) {
    setDraft((d) => {
      if (!d) return d
      // If already assigned elsewhere, remove first.
      const next = { ...d, distribution: {} }
      for (const [p, ids] of Object.entries(d.distribution)) next.distribution[p] = ids.filter((id) => id !== brandId)
      next.distribution[pid] = [...next.distribution[pid], brandId]
      return next
    })
  }

  async function onSave() {
    if (!draft) return
    const fallbackLabel = `${MONTH_NAMES[month]} ${year}`
    const finalLabel = label.trim() || fallbackLabel
    setSaving(true); setError(null); setSavedInfo(null)
    try {
      const created = await createMonthWithAssignments({
        label: finalLabel,
        month_num: month + 1,
        year,
        distribution: draft.distribution,
        setActive: setActiveOnSave,
      })
      setSavedInfo(`Saved "${created.label}" with ${Object.values(draft.distribution).flat().length} assignments.`)
      setDraft(null)
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  if (loading) return <div className="state">Loading…</div>

  const hasBrandsOff = brands.some((b) => !b.active)
  const unassigned = () => brands.filter((b) => selectedBrands.has(b.id) && !Object.values(draft?.distribution ?? {}).flat().includes(b.id))

  return (
    <div className="tab randomize-tab">
      {error && <div className="error">{error}</div>}
      {savedInfo && <div className="info">{savedInfo}</div>}

      <section className="card">
        <div className="card-head">
          <h2>Team</h2>
          <span className="muted">{selectedPeople.size} of {profiles.length} selected</span>
        </div>
        <ul className="chip-list">
          {profiles.map((p) => (
            <li key={p.id}>
              <label className={selectedPeople.has(p.id) ? 'chipbox on' : 'chipbox'}>
                <input
                  type="checkbox"
                  checked={selectedPeople.has(p.id)}
                  onChange={() => togglePerson(p.id)}
                />
                <span>{p.display_name || p.email}</span>
                {p.role === 'admin' && <em className="tag">admin</em>}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Brands</h2>
          <span className="muted">{selectedBrands.size} selected · {brands.length} total</span>
        </div>

        {isAdmin && (
          <form className="row" onSubmit={onAddBrand}>
            <input
              type="text"
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              placeholder="Add a brand…"
            />
            <button type="submit" className="btn">Add</button>
          </form>
        )}

        <div className="brands-grid">
          {brands.map((b) => (
            <div key={b.id} className={b.active ? 'brand-cell' : 'brand-cell inactive'}>
              <label className="brand-check">
                <input
                  type="checkbox"
                  checked={selectedBrands.has(b.id)}
                  onChange={() => toggleBrand(b.id)}
                />
                <span>{b.name}</span>
              </label>
              {isAdmin && (
                <div className="brand-actions">
                  <button className="mini" onClick={() => onToggleBrandActive(b)}>
                    {b.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button className="mini danger" onClick={() => onDeleteBrand(b)}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {hasBrandsOff && (
          <p className="hint">Inactive brands are hidden from default selection but still in the list.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Month</h2>
        </div>
        <div className="row">
          <label className="field">
            <span>Month</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Year</span>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2000}
              max={2100}
            />
          </label>
          <label className="field grow">
            <span>Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`${MONTH_NAMES[month]} ${year}`}
            />
          </label>
        </div>
        <label className="inline">
          <input
            type="checkbox"
            checked={setActiveOnSave}
            onChange={(e) => setSetActiveOnSave(e.target.checked)}
          />
          <span>Make this the active month on save</span>
        </label>
        <div className="row">
          <button className="btn primary" onClick={run} disabled={!isAdmin}>Randomize</button>
          {!isAdmin && <span className="muted">Only admins can save a new month. You can still preview.</span>}
        </div>
      </section>

      {draft && (
        <section className="card">
          <div className="card-head">
            <h2>Draft</h2>
            <span className="muted">Drag by dropdown — or click ✕ to remove, + to add back</span>
          </div>
          <div className="draft-grid">
            {draft.people.map((p) => (
              <div key={p.id} className="draft-col">
                <div className="draft-head">
                  <strong>{p.display_name || p.email}</strong>
                  <span className="muted">{draft.distribution[p.id]?.length ?? 0}</span>
                </div>
                <ul className="draft-list">
                  {(draft.distribution[p.id] ?? []).map((bid) => (
                    <li key={bid}>
                      <span>{brandsById.get(bid)?.name ?? bid}</span>
                      <div className="row-tight">
                        <select
                          value={p.id}
                          onChange={(e) => moveInDraft(bid, p.id, e.target.value)}
                        >
                          {draft.people.map((q) => (
                            <option key={q.id} value={q.id}>{q.display_name || q.email}</option>
                          ))}
                        </select>
                        <button className="mini danger" onClick={() => removeFromDraft(bid, p.id)}>✕</button>
                      </div>
                    </li>
                  ))}
                </ul>

                {unassigned().length > 0 && (
                  <details className="draft-add">
                    <summary>Add…</summary>
                    <ul className="draft-add-list">
                      {unassigned().map((b) => (
                        <li key={b.id}>
                          <button className="mini" onClick={() => addToDraft(p.id, b.id)}>+ {b.name}</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>

          <div className="row">
            <button className="btn" onClick={() => setDraft(null)}>Discard</button>
            <button className="btn primary" onClick={onSave} disabled={saving || !isAdmin}>
              {saving ? 'Saving…' : 'Save month'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
