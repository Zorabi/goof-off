import { CHROME_HOT_ZONE_HEIGHT } from './chromeLayoutModel.js'

export const STEALTH_REENTRY_MODE = 'reentry'
export const STEALTH_LEAVE_MODE = 'leave'

export function normalizeStealthWatcherMode(value) {
  return value === STEALTH_REENTRY_MODE ? STEALTH_REENTRY_MODE : STEALTH_LEAVE_MODE
}

export function resolveStealthRevealEdge(point, bounds, hotZoneHeight = CHROME_HOT_ZONE_HEIGHT) {
  const width = Math.max(0, Number(bounds?.width) || 0)
  const height = Math.max(0, Number(bounds?.height) || 0)
  const x = Number(point?.x)
  const y = Number(point?.y)
  const left = Number(bounds?.x) || 0
  const top = Number(bounds?.y) || 0
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < left ||
    x >= left + width ||
    y < top ||
    y >= top + height
  ) {
    return null
  }

  const revealHeight = Math.min(height, Math.max(0, Number(hotZoneHeight) || 0))
  const localY = y - top
  if (localY < revealHeight) return 'top'
  if (localY >= height - revealHeight) return 'bottom'
  return null
}
