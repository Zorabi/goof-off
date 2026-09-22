export function flattenToc(items, expanded, depth = 0) {
  const result = []
  const cappedDepth = Math.min(depth, 3)
  for (const item of items) {
    const hasChildren = !!(item.subitems && item.subitems.length > 0)
    result.push({
      id: item.id,
      label: item.label?.trim() || '(无标题)',
      href: item.href,
      depth: cappedDepth,
      hasChildren
    })
    if (hasChildren && expanded.has(item.id)) {
      const children = flattenToc(item.subitems, expanded, depth + 1)
      result.push(...children)
    }
  }
  return result
}

export function findActiveNode(toc, canonicalHref, canonicalFn) {
  if (!canonicalHref) return ''
  const target = canonicalHref
  const targetSection = target.split('#')[0]
  let sectionFallback = ''

  function search(items) {
    for (const item of items) {
      const itemHref = canonicalFn ? canonicalFn(item.href) : item.href
      if (itemHref === target) return item.id
      if (!sectionFallback && (itemHref || '').split('#')[0] === targetSection) {
        sectionFallback = item.id
      }
      if (item.subitems && item.subitems.length > 0) {
        const found = search(item.subitems)
        if (found) return found
      }
    }
    return ''
  }

  return search(toc) || sectionFallback
}

export function findActiveTocItemByViewport(items, viewportTop, resolveTop, tolerance = 2) {
  if (!items?.length || !Number.isFinite(viewportTop) || typeof resolveTop !== 'function') {
    return items?.[0] || null
  }

  let active = null
  let activeTop = -Infinity
  for (const item of items) {
    const top = resolveTop(item)
    if (!Number.isFinite(top) || top > viewportTop + tolerance || top < activeTop) continue
    active = item
    activeTop = top
  }
  return active || items[0]
}

export function getParentChain(toc, targetId, chain = []) {
  for (const item of toc) {
    if (item.id === targetId) return chain
    if (item.subitems && item.subitems.length > 0) {
      const result = getParentChain(item.subitems, targetId, [...chain, item.id])
      if (result.length > 0 || item.subitems.some((s) => s.id === targetId)) {
        return result.length > 0 ? result : [...chain, item.id]
      }
    }
  }
  return []
}
