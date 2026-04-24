import { createPortal } from 'react-dom'

function fmtSnapshotDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Rendered via a React portal into document.body so the sheet is NOT a
// descendant of the app shell. That way, `@media print` can simply hide
// `.shell` with display:none and show `.print-root` — without hiding the
// print content along with it.
export default function PrintSheet({ request }) {
  const { sections, meta } = request
  const node = (
    <div className="print-root" aria-hidden="true">
      {sections.map((s, idx) => (
        <section key={`${s.brand.normalized}-${idx}`} className="print-brand">
          <header className="print-header">
            <h1>{s.brand.name}</h1>
            <div className="meta">
              <span>{meta.personName}</span>
              {meta.monthLabel && <span> · {meta.monthLabel}</span>}
              {meta.snapshotAt && (
                <span> · Inventory as of {fmtSnapshotDate(meta.snapshotAt)}
                  {meta.uploader ? ` (uploaded by ${meta.uploader})` : ''}
                </span>
              )}
            </div>
          </header>
          {s.rows.length === 0 ? (
            <p className="print-empty">No current inventory for {s.brand.name} in this snapshot.</p>
          ) : (
            <table className="print-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Brand</th>
                  <th>Commit</th>
                  <th>Bucket</th>
                  <th className="num">Qty</th>
                  <th className="col-check">✓</th>
                  <th className="col-notes">Notes</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.model || ''}</td>
                    <td>{r.brand_raw || s.brand.name}</td>
                    <td className="num">{r.committed ?? ''}</td>
                    <td>{r.bucket || ''}</td>
                    <td className="num">{r.qty ?? ''}</td>
                    <td className="col-check"></td>
                    <td className="col-notes"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  )
  if (typeof document === 'undefined') return null
  return createPortal(node, document.body)
}
