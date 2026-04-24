import * as XLSX from 'xlsx'
import { norm } from './normalize'

// Parse an inventory file (.xlsx / .xls / .csv) into structured rows.
// Returns: [{ model, brandRaw, brandNormalized, committed, bucket, qty, upc, mpn }]
// Heuristics: detect header row by looking for brand/model/sku/qty keywords,
// then match columns by name. Falls back to first/second column for legacy
// two-column sheets (just brand, model).
export async function parseInventoryFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
  if (!rows.length) return []

  // Find the header row.
  let headerIdx = 0
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i]
    if (!r || !r.length) continue
    const joined = r.join('|').toLowerCase()
    if (/brand|model|sku|manufacturer|item|upc|qty/.test(joined)) { headerIdx = i; break }
  }
  const headers = (rows[headerIdx] || []).map((h) => (h ?? '').toString().toLowerCase().trim())
  const body = rows.slice(headerIdx + 1)

  function col(patterns) {
    for (const p of patterns) {
      const i = headers.findIndex((h) => p.test(h))
      if (i !== -1) return i
    }
    return -1
  }

  const iModel     = col([/^model$/, /^sku$/, /^item$/])
  const iUpc       = col([/^upc$/, /^barcode$/])
  const iBrand     = col([/^brand$/, /^manufacturer$/])
  const iMpn       = col([/^mpn$/, /manufacturer.part/])
  const iCommitted = col([/^committed$/, /^commit$/])
  const iBucket    = col([/^bucket$/, /^location$/, /^bin$/, /^warehouse$/])
  const iQty       = col([/^qty$/, /^quantity$/, /on.?hand/])

  // Fallback for minimal two-column sheets (brand, model).
  const fbBrand = iBrand === -1 ? 0 : iBrand
  const fbModel = iModel === -1 ? (iBrand === 0 ? 1 : 0) : iModel

  const out = []
  for (const r of body) {
    if (!r) continue
    const model = (r[iModel >= 0 ? iModel : fbModel] ?? '').toString().trim()
    const brand = (r[iBrand >= 0 ? iBrand : fbBrand] ?? '').toString().trim()
    if (!model && !brand) continue
    out.push({
      model,
      brandRaw: brand,
      brandNormalized: norm(brand),
      committed: iCommitted >= 0 ? parseNum(r[iCommitted]) : null,
      bucket:    iBucket    >= 0 ? (r[iBucket] ?? '').toString().trim() : null,
      qty:       iQty       >= 0 ? parseNum(r[iQty]) : null,
      upc:       iUpc       >= 0 ? (r[iUpc] ?? '').toString().trim() : null,
      mpn:       iMpn       >= 0 ? (r[iMpn] ?? '').toString().trim() : null,
    })
  }
  return out
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Export a month's assignments as an XLSX workbook (used by Months tab).
export function exportMonthXlsx({ monthLabel, assignmentsByPerson }) {
  const wb = XLSX.utils.book_new()

  const header = assignmentsByPerson.map((a) => a.person.display_name || a.person.email)
  const maxLen = Math.max(0, ...assignmentsByPerson.map((a) => a.brands.length))
  const aoa = [header]
  for (let i = 0; i < maxLen; i++) {
    aoa.push(assignmentsByPerson.map((a) => a.brands[i]?.name ?? ''))
  }
  const allSheet = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, allSheet, 'All')

  for (const a of assignmentsByPerson) {
    const personAoa = [[a.person.display_name || a.person.email]]
    a.brands.forEach((b) => personAoa.push([b.name]))
    const sheet = XLSX.utils.aoa_to_sheet(personAoa)
    const safeName = (a.person.display_name || a.person.email || 'Person')
      .toString()
      .slice(0, 28)
      .replace(/[:\\/?*[\]]/g, '_')
    XLSX.utils.book_append_sheet(wb, sheet, safeName)
  }

  XLSX.writeFile(wb, `${monthLabel.replace(/[^a-z0-9]+/gi, '_')}.xlsx`)
}

// Export status log entries as xlsx (used by Logs tab).
export function exportStatusLogXlsx({ entries, filename = 'status_log.xlsx' }) {
  const wb = XLSX.utils.book_new()
  const header = ['When', 'Person', 'Brand', 'Month', 'From', 'To', 'Changed by']
  const aoa = [header]
  for (const e of entries) {
    aoa.push([
      new Date(e.changed_at).toLocaleString(),
      e.person?.display_name || e.person?.email || '',
      e.brand?.name || '',
      e.month?.label || '',
      e.previous_status || '',
      e.new_status || '',
      e.changer?.display_name || e.changer?.email || '',
    ])
  }
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, sheet, 'Log')
  XLSX.writeFile(wb, filename)
}
