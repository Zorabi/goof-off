export function normalizeSiteOrder(order, knownIds) {
  if (!Array.isArray(order)) return []
  const known = new Set(knownIds || [])
  const result = []
  for (const id of order) {
    if (typeof id !== 'string' || !known.has(id) || result.includes(id)) continue
    result.push(id)
  }
  return result
}

export function applySiteOrder(sites, order) {
  const source = Array.isArray(sites) ? sites : []
  if (!Array.isArray(order) || order.length === 0) return [...source]
  const byId = new Map(source.map((siteItem) => [siteItem.id, siteItem]))
  const ordered = []
  for (const id of order) {
    const siteItem = byId.get(id)
    if (!siteItem) continue
    ordered.push(siteItem)
    byId.delete(id)
  }
  return [...ordered, ...byId.values()]
}
