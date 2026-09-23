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
