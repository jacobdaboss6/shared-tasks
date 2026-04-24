import { supabase } from './supabase'

// Subscribe to inserts on inventory_snapshots. onInsert receives the new row.
// Returns an unsubscribe function.
//
// Each subscriber gets a unique channel name because Supabase reuses the
// same channel object for repeated `supabase.channel(name)` calls with the
// same name. If the channel has already been subscribed, adding another
// `.on(...)` throws "cannot add postgres_changes callbacks ... after
// subscribe()" and crashes the app. A unique name per subscription avoids
// this — multiple components can subscribe safely.
export function subscribeToSnapshots(onInsert) {
  const name = `inventory-snapshots:${Math.random().toString(36).slice(2)}:${Date.now()}`
  const channel = supabase
    .channel(name)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'inventory_snapshots' },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
