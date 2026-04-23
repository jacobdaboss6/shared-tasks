// Fisher-Yates.
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Given a list of people and a list of brand ids, return { personId: brandIds[] }.
// Round-robin after shuffling, so remainder brands are spread evenly.
export function distribute(people, brandIds) {
  if (!people.length) return {}
  const shuffled = shuffle(brandIds)
  const out = Object.fromEntries(people.map((p) => [p.id, []]))
  shuffled.forEach((bid, idx) => {
    const owner = people[idx % people.length]
    out[owner.id].push(bid)
  })
  return out
}
