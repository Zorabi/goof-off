import { CHROME_HOT_ZONE_HEIGHT } from './chromeLayoutModel.js'

export const STEALTH_REENTRY_MODE = 'reentry'
export const STEALTH_LEAVE_MODE = 'leave'
export const STEALTH_REVEAL_REGION_EDGES = 'edges'
export const STEALTH_REVEAL_REGION_WINDOW = 'window'

export function normalizeStealthWatcherMode(value) {
  return value === STEALTH_REENTRY_MODE ? STEALTH_REENTRY_MODE : STEALTH_LEAVE_MODE
}

export function normalizeStealthRevealRegion(value) {
  return value === STEALTH_REVEAL_REGION_WINDOW
    ? STEALTH_REVEAL_REGION_WINDOW
    : STEALTH_REVEAL_REGION_EDGES
}

function isPointInsideBounds(point, bounds) {
  const width = Math.max(0, Number(bounds?.width) || 0)
  const height = Math.max(0, Number(bounds?.height) || 0)
  const x = Number(point?.x)
  const y = Number(point?.y)
  const left = Number(bounds?.x) || 0
  const top = Number(bounds?.y) || 0
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= left &&
    x < left + width &&
    y >= top &&
    y < top + height
  )
}

export function resolveStealthRevealEdge(point, bounds, hotZoneHeight = CHROME_HOT_ZONE_HEIGHT) {
  const height = Math.max(0, Number(bounds?.height) || 0)
  const y = Number(point?.y)
  const top = Number(bounds?.y) || 0
  if (!isPointInsideBounds(point, bounds)) return null

  const revealHeight = Math.min(height, Math.max(0, Number(hotZoneHeight) || 0))
  const localY = y - top
  if (localY < revealHeight) return 'top'
  if (localY >= height - revealHeight) return 'bottom'
  return null
}

export function resolveStealthRevealTarget(
  point,
  bounds,
  revealRegion = STEALTH_REVEAL_REGION_EDGES,
  hotZoneHeight = CHROME_HOT_ZONE_HEIGHT
) {
  if (normalizeStealthRevealRegion(revealRegion) === STEALTH_REVEAL_REGION_WINDOW) {
    return isPointInsideBounds(point, bounds) ? 'window' : null
  }
  return resolveStealthRevealEdge(point, bounds, hotZoneHeight)
}
