export function canConfirmChapterNavigationLocation(target) {
  return Boolean(target?.awaitsLocationConfirmation && target.layoutAligned)
}

export function isChapterNavigationSettled(target) {
  if (!target?.awaitsLocationConfirmation) return true
  return Boolean(target.layoutAligned && target.locationConfirmed)
}

export function hrefForChapterRelocation({
  activeTocItem,
  currentChapterTarget,
  canonicalHref,
  locationHref
}) {
  if (activeTocItem?.href) return activeTocItem.href
  if (currentChapterTarget?.canonicalHref === canonicalHref && currentChapterTarget.href) {
    return currentChapterTarget.href
  }
  return locationHref || ''
}

export function flattenTocNavigationTargets(items = [], canonicalHref = (href) => href) {
  const targets = []
  const seenHrefs = new Set()

  function visit(entries) {
    for (const item of entries || []) {
      const href = String(item?.href || '').trim()
      if (href) {
        const canonical = canonicalHref(href) || href
        if (!seenHrefs.has(canonical)) {
          seenHrefs.add(canonical)
          targets.push(item)
        }
      }
      visit(item?.subitems)
    }
  }

  visit(items)
  return targets
}

export function findAdjacentTocNavigationTarget(
  targets = [],
  currentHref,
  direction,
  canonicalHref = (href) => href
) {
  const currentCanonicalHref = canonicalHref(currentHref)
  if (!currentCanonicalHref) return null

  const currentIndex = targets.findIndex(
    (target) => canonicalHref(target?.href) === currentCanonicalHref
  )
  if (currentIndex < 0) return null

  const step = direction === 'prev' ? -1 : 1
  return targets[currentIndex + step] || null
}
