export function clampScrollOffset(offset, scrollSize, clientSize) {
  const value = Number.isFinite(offset) ? offset : 0
  const max = Math.max(0, (scrollSize || 0) - (clientSize || 0))
  return Math.min(Math.max(0, value), max)
}

export function scrollOffsetForViewportAnchor(
  scrollOffset,
  anchorOffset,
  viewportContentOffset,
  anchorInset
) {
  return scrollOffset + anchorOffset + anchorInset - viewportContentOffset
}
