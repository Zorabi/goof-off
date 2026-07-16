function clampLimit(limit) {
  return Math.max(0, Math.floor(Number(limit) || 0))
}

function indexOfKey(items, cursorKey, getKey) {
  return items.findIndex((item) => getKey(item) === cursorKey)
}

function boundsFor(items, getKey) {
  return {
    beforeCursor: items.length ? getKey(items[0]) : null,
    afterCursor: items.length ? getKey(items[items.length - 1]) : null
  }
}

export function selectInitialWindow(items, { anchor, limit, getValue, getKey }) {
  const max = clampLimit(limit)
  const ordered = Array.isArray(items) ? [...items] : []
  if (!ordered.length || max <= 0) {
    return { items: [], hasBefore: false, hasAfter: false, beforeCursor: null, afterCursor: null }
  }
  const ranked = ordered
    .map((item, index) => ({ item, index, distance: Math.abs(getValue(item) - anchor) }))
    .sort(
      (a, b) => a.distance - b.distance || getValue(a.item) - getValue(b.item) || a.index - b.index
    )
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
  const selected = ranked.map((entry) => entry.item)
  const firstIndex = ranked[0].index
  const lastIndex = ranked[ranked.length - 1].index
  return {
    items: selected,
    hasBefore: firstIndex > 0,
    hasAfter: lastIndex < ordered.length - 1,
    ...boundsFor(selected, getKey)
  }
}

export function selectBeforeWindow(items, { cursorKey, limit, getKey }) {
  const max = clampLimit(limit)
  const ordered = Array.isArray(items) ? items : []
  const cursorIndex = indexOfKey(ordered, cursorKey, getKey)
  if (cursorIndex <= 0 || max <= 0) {
    return {
      items: [],
      hasBefore: cursorIndex > 0,
      hasAfter: cursorIndex >= 0,
      beforeCursor: null,
      afterCursor: null
    }
  }
  const start = Math.max(0, cursorIndex - max)
  const selected = ordered.slice(start, cursorIndex)
  return {
    items: selected,
    hasBefore: start > 0,
    hasAfter: true,
    ...boundsFor(selected, getKey)
  }
}

export function selectAfterWindow(items, { cursorKey, limit, getKey }) {
  const max = clampLimit(limit)
  const ordered = Array.isArray(items) ? items : []
  const cursorIndex = indexOfKey(ordered, cursorKey, getKey)
  if (cursorIndex < 0 || cursorIndex >= ordered.length - 1 || max <= 0) {
    return {
      items: [],
      hasBefore: cursorIndex >= 0,
      hasAfter: cursorIndex >= 0 && cursorIndex < ordered.length - 1,
      beforeCursor: null,
      afterCursor: null
    }
  }
  const end = Math.min(ordered.length, cursorIndex + 1 + max)
  const selected = ordered.slice(cursorIndex + 1, end)
  return {
    items: selected,
    hasBefore: true,
    hasAfter: end < ordered.length,
    ...boundsFor(selected, getKey)
  }
}

export function mergeWindowItems(
  currentItems,
  incomingItems,
  { direction, currentHitIndex, getKey }
) {
  const seen = new Set((currentItems || []).map((item) => getKey(item)))
  const uniqueIncoming = (incomingItems || []).filter((item) => {
    const key = getKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const addedCount = uniqueIncoming.length
  if (direction === 'before') {
    return {
      items: uniqueIncoming.concat(currentItems || []),
      addedCount,
      currentHitIndex: currentHitIndex >= 0 ? currentHitIndex + addedCount : currentHitIndex,
      indexShifted: addedCount > 0 && currentHitIndex >= 0
    }
  }
  return {
    items: (currentItems || []).concat(uniqueIncoming),
    addedCount,
    currentHitIndex,
    indexShifted: false
  }
}
