export const GESTURE_DELTA_MODE_PIXEL = 0
export const HORIZONTAL_DOMINANCE_RATIO = 1.6
export const GESTURE_WINDOW_MS = 220
export const GESTURE_THRESHOLD_PX = 140
export const GESTURE_COOLDOWN_MS = 500
export const GESTURE_ZOOM_MIN = 0.5
export const GESTURE_ZOOM_MAX = 2.0

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRendererPixelWheel(eventLike) {
  if (!('deltaMode' in eventLike)) return false
  return eventLike.deltaMode === GESTURE_DELTA_MODE_PIXEL
}

function isMainPreciseWheel(eventLike) {
  if (!('hasPreciseScrollingDeltas' in eventLike)) return false
  return eventLike.hasPreciseScrollingDeltas === true
}

function isPreciseWheel(eventLike) {
  return isRendererPixelWheel(eventLike) || isMainPreciseWheel(eventLike)
}

export function isControlWheel(eventLike = {}) {
  if (eventLike.ctrlKey === true) return true
  const modifiers = Array.isArray(eventLike.modifiers) ? eventLike.modifiers : []
  return modifiers.some((modifier) => {
    const normalized = String(modifier).toLowerCase()
    return normalized === 'control' || normalized === 'ctrl'
  })
}

export function normalizeHorizontalWheelDelta(eventLike = {}) {
  if (!isPreciseWheel(eventLike)) return 0
  if (isControlWheel(eventLike)) return 0
  if (eventLike.shiftKey === true) return 0

  const deltaX = finiteNumber(eventLike.deltaX)
  const deltaY = finiteNumber(eventLike.deltaY)
  if (deltaX === 0) return 0
  if (Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_DOMINANCE_RATIO) return 0
  return deltaX
}

export function classifyWheelGesture(eventLike = {}) {
  const deltaY = finiteNumber(eventLike.deltaY)
  if (isControlWheel(eventLike) && Math.abs(deltaY) > 0) {
    return {
      type: 'zoom',
      direction: deltaY < 0 ? 'in' : 'out',
      deltaY
    }
  }

  const deltaX = normalizeHorizontalWheelDelta(eventLike)
  if (deltaX === 0) return { type: 'none' }
  return {
    type: 'horizontal',
    deltaX,
    direction: deltaX > 0 ? 'left' : 'right'
  }
}

export function clampGestureZoom(value) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 1
  const clamped = Math.max(GESTURE_ZOOM_MIN, Math.min(GESTURE_ZOOM_MAX, numeric))
  return Math.round(clamped * 100) / 100
}

export function createWheelGestureRecognizer(options = {}) {
  const threshold = options.threshold ?? GESTURE_THRESHOLD_PX
  const windowMs = options.windowMs ?? GESTURE_WINDOW_MS
  const cooldownMs = options.cooldownMs ?? GESTURE_COOLDOWN_MS
  let windowStartedAt = 0
  let accumulatedX = 0
  let cooldownUntil = 0

  function reset() {
    windowStartedAt = 0
    accumulatedX = 0
    cooldownUntil = 0
  }

  function push(eventLike, now = Date.now()) {
    const gesture = classifyWheelGesture(eventLike)
    if (gesture.type !== 'horizontal') return { consumed: false, direction: null }

    if (now < cooldownUntil) return { consumed: true, direction: null }

    if (!windowStartedAt || now - windowStartedAt > windowMs) {
      windowStartedAt = now
      accumulatedX = 0
    }

    accumulatedX += gesture.deltaX
    if (Math.abs(accumulatedX) < threshold) return { consumed: true, direction: null }

    const direction = accumulatedX > 0 ? 'left' : 'right'
    windowStartedAt = 0
    accumulatedX = 0
    cooldownUntil = now + cooldownMs
    return { consumed: true, direction }
  }

  return { push, reset }
}
