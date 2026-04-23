import * as XLSX from 'xlsx'
import { norm } from './normalize'

// Parse an inventory file (.xlsx/.xls/.csv) into rows of {brand, model}.
// Accepts the first sheet. Heuristic column detection:
//   - Brand column: header matches /brand|manufacturer/i OR the first column.
//   - Model column: header matches /model|sku|item/i OR the second column.
// Returns: [{ brand: string, model: string, normalizedBrand, normalizedModel }]
export async function parseInventoryFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false })
  if (!rows.length) return []

  // Detect header row (first row with at least one header-ish string).
  let headerIdx = 0
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const r = rows[i]
    if (!r || !r.length) continue
    const joined = r.join('|').toLowerCase()
    if (/brand|model|sku|manufacturer|item/.test(joined)) { headerIdx = i; break }
  }
  const headers = (rows[headerIdx] || []).map((h) => (h ?? '').toString())
  const body = rows.slice(headerIdx + 1)

  let brandCol = headers.findIndex((h) => /brand|manufacturer/i.test(h))
  let modelCol = headers.findIndex((h) => /model|sku|item/i.test(h))
  if (brandCol === -1) brandCol = 0
  if (modelCol === -1) modelCol = brandCol === 1 ? 0 : 1

  const out = []
  for (const r of body) {
    if (!r) continue
    const brand = (r[brandCol] ?? '').toString().trim()
    const model = (r[modelCol] ?? '').toString().trim()
    if (!brand && !model) continue
    out.push({
      brand,
      model,
      normalizedBrand: norm(brand),
      normalizedModel: norm(model),
    })
  }
  return out
}

// Export a month's assignments as an XLSX workbook.
//   assignmentsByPerson: [{ person: {display_name, email}, brands: [{name}], ... }]
export function exportMonthXlsx({ monthLabel, assignmentsByPerson }) {
  const wb = XLSX.utils.book_new()

  // Side-by-side "All" sheet.
  const header = assignmentsByPerson.map((a) => a.person.display_name || a.person.email)
  const maxLen = Math.max(0, ...assignmentsByPerson.map((a) => a.brands.length))
  const aoa = [header]
  for (let i = 0; i < maxLen; i++) {
    aoa.push(assignmentsByPerson.map((a) => a.brands[i]?.name ?? ''))
  }
  const allSheet = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, allSheet, 'All')

  // One sheet per person.
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
