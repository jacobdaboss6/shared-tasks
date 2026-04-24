import { supabase } from './supabase'

// Subscribe to inserts on inventory_snapshots. onInsert receives the new row.
// Returns an unsubscribe function.
export function subscribeToSnapshots(onInsert) {
  const channel = supabase
    .channel('inventory-snapshots')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'inventory_snapshots' },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
