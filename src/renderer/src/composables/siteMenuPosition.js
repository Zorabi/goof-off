export function computeSiteMenuPosition({ tileRect, menuSize, viewport, margin = 8, overlap = 4 }) {
  let placement = 'below'
  let top = tileRect.bottom - overlap
  if (top + menuSize.height > viewport.height - margin) {
    placement = 'above'
    top = tileRect.top + overlap - menuSize.height
  }
  const maxTop = viewport.height - menuSize.height - margin
  if (top < margin || top > maxTop) {
    top = Math.min(Math.max(top, margin), Math.max(margin, maxTop))
    placement = 'clamped'
  }
  const maxLeft = viewport.width - menuSize.width - margin
  const left = Math.min(
    Math.max(tileRect.right - menuSize.width, margin),
    Math.max(margin, maxLeft)
  )
  return { left, top, placement }
}
