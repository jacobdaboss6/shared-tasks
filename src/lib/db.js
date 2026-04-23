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

// Admin only (RLS will reject for non-admins).
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
    .select('id, label, month_num, year, is_active, created_at')
    .order('year', { ascending: false })
    .order('month_num', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getActiveMonth() {
  const { data, error } = await supabase
    .from('months')
    .select('id, label, month_num, year, is_active')
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

// Create a month *with* its assignments in one call. We can't do it in a
// single SQL transaction from the client; instead we create the month, then
// bulk-insert the assignments, and if that fails we best-effort roll back.
export async function createMonthWithAssignments({ label, month_num, year, distribution, setActive }) {
  const { data: month, error } = await supabase
    .from('months')
    .insert({ label, month_num, year, is_active: false })
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
      // Best-effort cleanup.
      await supabase.from('months').delete().eq('id', month.id)
      throw aerr
    }
  }

  // Pre-create brand_checklist rows so owners can immediately mark progress.
  if (rows.length) {
    const { data: inserted, error: ferr } = await supabase
      .from('assignments')
      .select('id')
      .eq('month_id', month.id)
    if (!ferr && inserted) {
      await supabase
        .from('brand_checklist')
        .insert(inserted.map((a) => ({ assignment_id: a.id })))
      // Ignore errors here — RLS may reject if somehow we're not admin; the
      // row will be created on first status update anyway.
    }
  }

  if (setActive) await setMonthActive(month.id)
  return month
}

// Atomic-ish "set active": unset everything else, then set this one.
export async function setMonthActive(monthId) {
  const { error: e1 } = await supabase
    .from('months')
    .update({ is_active: false })
    .neq('id', monthId)
  if (e1) throw e1
  const { error: e2 } = await supabase
    .from('months')
    .update({ is_active: true })
    .eq('id', monthId)
  if (e2) throw e2
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
  // Join via assignments to filter by month.
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

// ---------------------------- MODEL CHECKLIST -----------------------------
export async function listModelChecklistForAssignments(assignmentIds) {
  if (!assignmentIds.length) return []
  const { data, error } = await supabase
    .from('model_checklist')
    .select('id, assignment_id, model, normalized_model, status, notes, updated_at')
    .in('assignment_id', assignmentIds)
    .order('model', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertModelChecklist({ id, assignment_id, model, status, notes }) {
  const { data: { user } } = await supabase.auth.getUser()
  // If we have an id, update; otherwise insert (server-generated id).
  if (id) {
    const { error } = await supabase
      .from('model_checklist')
      .update({ status, notes, updated_by: user?.id ?? null })
      .eq('id', id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('model_checklist')
      .insert({ assignment_id, model, status, notes, updated_by: user?.id ?? null })
    if (error) throw error
  }
}

// Reconcile model_checklist for a set of assignments against an inventory.
//   assignments: [{ id, brand: { normalized } }]
//   inventoryRows: [{ normalizedBrand, normalizedModel, model }]
// For each assignment, find inventory rows whose normalizedBrand matches;
// upsert a model_checklist row per distinct normalized_model. Existing rows
// keep their status/notes (only updated_at). Pending rows that no longer
// appear in inventory are deleted. Touched rows (non-pending) are kept.
export async function reconcileMonthModels({ assignments, inventoryRows }) {
  const existing = await listModelChecklistForAssignments(assignments.map((a) => a.id))

  const existingByKey = new Map()
  for (const row of existing) existingByKey.set(`${row.assignment_id}::${row.normalized_model}`, row)

  const seenKeys = new Set()
  const toInsert = []

  for (const a of assignments) {
    const brandNorm = a.brand?.normalized || ''
    if (!brandNorm) continue
    const rowsForBrand = inventoryRows.filter((r) => r.normalizedBrand === brandNorm)
    const byModel = new Map()
    for (const r of rowsForBrand) {
      if (!r.normalizedModel) continue
      if (!byModel.has(r.normalizedModel)) byModel.set(r.normalizedModel, r.model)
    }
    for (const [normModel, displayModel] of byModel) {
      const key = `${a.id}::${normModel}`
      seenKeys.add(key)
      if (!existingByKey.has(key)) {
        toInsert.push({ assignment_id: a.id, model: displayModel })
      }
    }
  }

  const toDelete = existing
    .filter((r) => r.status === 'pending' && !seenKeys.has(`${r.assignment_id}::${r.normalized_model}`))
    .map((r) => r.id)

  // Apply.
  if (toInsert.length) {
    // Chunk to avoid huge payloads.
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500)
      const { error } = await supabase.from('model_checklist').insert(chunk)
      if (error) throw error
    }
  }
  if (toDelete.length) {
    const { error } = await supabase.from('model_checklist').delete().in('id', toDelete)
    if (error) throw error
  }
  return {
    inserted: toInsert.length,
    deleted: toDelete.length,
    kept: existing.length - toDelete.length,
  }
}
