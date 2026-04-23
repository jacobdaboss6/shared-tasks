// Comparable form of a string: lowercase + strip to [a-z0-9].
// Used everywhere we compare brand/model names across sources.
export function norm(s) {
  return (s ?? '').toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function esc(s) {
  return (s ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
