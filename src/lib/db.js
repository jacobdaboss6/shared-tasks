import { supabase } from './supabase'

// -------------------------------- PROFILES --------------------------------
export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function updateMyDisplayName(displayName) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', user.id)
  if (error) throw error
}

export async function setProfileRole(profileId, role) {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', profileId)
  if (error) throw error
}

export async function setProfileDisplayName(profileId, displayName) {
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName })
    .eq('id', profileId)
  if (error) throw error
}

// -------------------------------- BRANDS ----------------------------------
export async function listBrands() {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, normalized, active')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function addBrand(name) {
  const clean = (name || '').trim()
  if (!clean) throw new Error('Brand name required')
  const { data, error } = await supabase
    .from('brands')
    .insert({ name: clean })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setBrandActive(brandId, active) {
  const { error } = await supabase.from('brands').update({ active }).eq('id', brandId)
  if (error) throw error
}

export async function deleteBrand(brandId) {
  const { error } = await supabase.from('brands').delete().eq('id', brandId)
  if (error) throw error
}

// -------------------------------- MONTHS ----------------------------------
export async function listMonths() {
  const { data, error } = await supabase
    .from('months')
    .select('id, label, month_num, year, is_active, is_frozen, created_at')
    .order('year', { ascending: false })
    .order('month_num', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getActiveMonth() {
  const { data, error } = await supabase
    .from('months')
    .select('id, label, month_num, year, is_active, is_frozen')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

// Create a month with its assignments + pre-seeded brand_checklist rows.
// When setActive is true, the DB trigger auto-freezes the previous active
// month as it flips to is_active=false.
export async function createMonthWithAssignments({ label, month_num, year, distribution, setActive }) {
  const { data: month, error } = await supabase
    .from('months')
    .insert({ label, month_num, year, is_active: false, is_frozen: false })
    .select()
    .single()
  if (error) throw error

  const rows = []
  for (const [personId, brandIds] of Object.entries(distribution)) {
    brandIds.forEach((brandId, position) => {
      rows.push({ month_id: month.id, person_id: personId, brand_id: brandId, position })
    })
  }
  if (rows.length) {
    const { error: aerr } = await supabase.from('assignments').insert(rows)
    if (aerr) {
      await supabase.from('months').delete().eq('id', month.id)
      throw aerr
    }
  }

  // Pre-create brand_checklist rows at 'pending'. The INSERT trigger skips
  // logging rows that land at pending (default), so no noise in the log.
  if (rows.length) {
    const { data: inserted } = await supabase
      .from('assignments')
      .select('id')
      .eq('month_id', month.id)
    if (inserted) {
      await supabase
        .from('brand_checklist')
        .insert(inserted.map((a) => ({ assignment_id: a.id })))
    }
  }

  if (setActive) await setMonthActive(month.id)
  return month
}

// Atomic-ish "set active". Unset others (trigger freezes them as they flip
// to is_active=false), then unfreeze + set the target.
export async function setMonthActive(monthId) {
  const { error: e1 } = await supabase
    .from('months')
    .update({ is_active: false })
    .neq('id', monthId)
  if (e1) throw e1
  const { error: e2 } = await supabase
    .from('months')
    .update({ is_active: true, is_frozen: false })
    .eq('id', monthId)
  if (e2) throw e2
}

export async function setMonthFrozen(monthId, is_frozen) {
  const { error } = await supabase.from('months').update({ is_frozen }).eq('id', monthId)
  if (error) throw error
}

export async function renameMonth(monthId, label) {
  const { error } = await supabase.from('months').update({ label }).eq('id', monthId)
  if (error) throw error
}

export async function deleteMonth(monthId) {
  const { error } = await supabase.from('months').delete().eq('id', monthId)
  if (error) throw error
}

// ------------------------------ ASSIGNMENTS -------------------------------
// NB: RLS restricts members to their own rows. Admin sees all.
export async function listAssignmentsForMonth(monthId) {
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      id, position, person_id, brand_id,
      brand:brands(id, name, normalized),
      person:profiles(id, email, display_name)
    `)
    .eq('month_id', monthId)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function listMyAssignmentsForMonth(monthId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      id, position, person_id, brand_id,
      brand:brands(id, name, normalized)
    `)
    .eq('month_id', monthId)
    .eq('person_id', user.id)
    .order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ---------------------------- BRAND CHECKLIST -----------------------------
export async function listBrandChecklistForMonth(monthId) {
  const { data, error } = await supabase
    .from('brand_checklist')
    .select(`
      id, assignment_id, status, notes, updated_at,
      assignment:assignments!inner(id, person_id, brand_id, month_id)
    `)
    .eq('assignment.month_id', monthId)
  if (error) throw error
  return data ?? []
}

export async function upsertBrandChecklist({ assignment_id, status, notes }) {
  const { data: { user } } = await supabase.auth.getUser()
  const payload = { assignment_id, status, notes, updated_by: user?.id ?? null }
  const { error } = await supabase
    .from('brand_checklist')
    .upsert(payload, { onConflict: 'assignment_id' })
  if (error) throw error
}

// ------------------------------ STATUS LOG --------------------------------
// Admin sees all; members see only their own (RLS enforced server-side).
export async function listStatusLog(filters = {}) {
  let q = supabase
    .from('status_log')
    .select(`
      id, changed_at, previous_status, new_status,
      person_id, changed_by, month_id, brand_id,
      brand:brands(id, name),
      month:months(id, label, year, month_num)
    `)
    .order('changed_at', { ascending: false })

  if (filters.monthId)    q = q.eq('month_id', filters.monthId)
  if (filters.personId)   q = q.eq('person_id', filters.personId)
  if (filters.brandId)    q = q.eq('brand_id', filters.brandId)
  if (filters.fromStatus) q = q.eq('previous_status', filters.fromStatus)
  if (filters.toStatus)   q = q.eq('new_status', filters.toStatus)
  if (filters.since)      q = q.gte('changed_at', filters.since)
  if (filters.until)      q = q.lte('changed_at', filters.until)
  if (filters.limit)      q = q.limit(filters.limit)

  const { data, error } = await q
  if (error) throw error

  // Hydrate person + changer from profiles (no FK, client-side join).
  const ids = new Set()
  for (const r of (data ?? [])) { ids.add(r.person_id); ids.add(r.changed_by) }
  if (ids.size) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email, display_name')
      .in('id', [...ids])
    const byId = new Map((profs ?? []).map((p) => [p.id, p]))
    for (const r of (data ?? [])) {
      r.person  = byId.get(r.person_id)  || null
      r.changer = byId.get(r.changed_by) || null
    }
  }
  return data ?? []
}

// --------------------------- INVENTORY SNAPSHOTS --------------------------
export async function listInventorySnapshots(limit = 20) {
  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('id, uploaded_at, filename, row_count, uploaded_by')
    .order('uploaded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function getLatestSnapshot() {
  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('id, uploaded_at, filename, row_count, uploaded_by')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getSnapshot(id) {
  const { data, error } = await supabase
    .from('inventory_snapshots')
    .select('id, uploaded_at, filename, row_count, uploaded_by')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

// Creates a snapshot with its rows. Rolls back on partial failure.
export async function createInventorySnapshot({ filename, rows }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: snap, error } = await supabase
    .from('inventory_snapshots')
    .insert({ uploaded_by: user.id, filename, row_count: rows.length })
    .select()
    .single()
  if (error) throw error
  if (rows.length) {
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map((r) => ({
        snapshot_id: snap.id,
        model: r.model || null,
        brand_raw: r.brandRaw || null,
        brand_normalized: r.brandNormalized || null,
        committed: r.committed,
        bucket: r.bucket || null,
        qty: r.qty,
        upc: r.upc || null,
        mpn: r.mpn || null,
      }))
      const { error: rerr } = await supabase.from('inventory_rows').insert(chunk)
      if (rerr) {
        await supabase.from('inventory_snapshots').delete().eq('id', snap.id)
        throw rerr
      }
    }
  }
  return snap
}

export async function listInventoryRowsForSnapshot(snapshotId, brandNormalizedList = null) {
  let q = supabase
    .from('inventory_rows')
    .select('id, model, brand_raw, brand_normalized, committed, bucket, qty, upc, mpn')
    .eq('snapshot_id', snapshotId)
    .order('brand_normalized', { ascending: true })
    .order('model', { ascending: true })
    .order('bucket', { ascending: true })

  if (brandNormalizedList?.length) q = q.in('brand_normalized', brandNormalizedList)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Unique brand codes in a snapshot — for unrecognized-brand detection.
export async function listSnapshotBrandCodes(snapshotId) {
  const { data, error } = await supabase
    .from('inventory_rows')
    .select('brand_normalized, brand_raw')
    .eq('snapshot_id', snapshotId)
  if (error) throw error
  const seen = new Map()
  for (const r of (data ?? [])) {
    const k = r.brand_normalized || ''
    if (!k) continue
    if (!seen.has(k)) seen.set(k, { brand_normalized: k, brand_raw: r.brand_raw })
  }
  return [...seen.values()]
}

export async function deleteSnapshot(id) {
  const { error } = await supabase.from('inventory_snapshots').delete().eq('id', id)
  if (error) throw error
}

// --------------------------- ADMIN NOTIFICATIONS --------------------------
export async function listAdminNotifications({ includeDismissed = false } = {}) {
  let q = supabase
    .from('admin_notifications')
    .select('id, kind, payload, created_at, dismissed_at, dismissed_by')
    .order('created_at', { ascending: false })
    .limit(100)
  if (!includeDismissed) q = q.is('dismissed_at', null)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function dismissAdminNotification(id) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('admin_notifications')
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: user?.id ?? null })
    .eq('id', id)
  if (error) throw error
}

export async function createAdminNotifications(items) {
  if (!items.length) return
  const rows = items.map((it) => ({ kind: it.kind, payload: it.payload }))
  const { error } = await supabase.from('admin_notifications').insert(rows)
  if (error) throw error
}
