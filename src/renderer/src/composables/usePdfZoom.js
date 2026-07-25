import { ref, nextTick, onUnmounted } from 'vue'

const MIN_SCALE = 0.25
const MAX_SCALE = 4.0
const SETTLE_MS = 150
const STEP = 0.25

export function computeNewScale(current, deltaY) {
  const raw = current * Math.exp(-deltaY * 0.01)
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw))
}

export function computeSteppedPdfZoom(currentScale, direction) {
  const safeCurrent = Number.isFinite(currentScale) ? currentScale : 1
  const rawNextScale = safeCurrent + (direction > 0 ? STEP : -STEP)
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawNextScale))
  return { mode: 'fixed', value: Math.round(nextScale * 100) }
}

export function resolvePdfZoomPreset(preset) {
  if (preset === 'fit-width') return { mode: 'fit-width', value: 1 }
  if (preset === 'fit-page') return { mode: 'fit-page', value: 1 }
  return { mode: 'fixed', value: preset }
}

export function usePdfZoom(
  zoomRef,
  containerRef,
  innerRef,
  onZoomSettle,
  getEffectiveScale,
  onZoomStart,
  onZoomCancel
) {
  const cssScale = ref(1)
  const transformOrigin = ref('50% 50%')
  let settleTimer = null
  let baseScale = 1
  let pinchOriginX = 0
  let pinchOriginY = 0

  function onWheel(e) {
    if (!e.ctrlKey || e.deltaY === 0) return
    e.preventDefault()

    const isGestureStart = settleTimer === null
    if (isGestureStart) {
      baseScale = getEffectiveScale()
    }

    const newScale = computeNewScale(baseScale * cssScale.value, e.deltaY)

    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      pinchOriginX = e.clientX - rect.left
      pinchOriginY = e.clientY - rect.top
      const contentX = containerRef.value.scrollLeft + pinchOriginX
      const contentY = containerRef.value.scrollTop + pinchOriginY
      transformOrigin.value = `${contentX}px ${contentY}px`
    }
    if (isGestureStart) {
      onZoomStart?.({ originX: pinchOriginX, originY: pinchOriginY, initialScale: baseScale })
    }
    cssScale.value = newScale / baseScale

    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      const finalScale = baseScale * cssScale.value
      const scaleRatio = finalScale / baseScale

      if (containerRef.value) {
        const oldScrollLeft = containerRef.value.scrollLeft
        const oldScrollTop = containerRef.value.scrollTop
        const newScrollLeft = (pinchOriginX + oldScrollLeft) * scaleRatio - pinchOriginX
        const newScrollTop = (pinchOriginY + oldScrollTop) * scaleRatio - pinchOriginY
        const restoreHorizontalAfterSettle = onZoomSettle?.(finalScale, {
          originX: pinchOriginX,
          originY: pinchOriginY,
          scaleRatio
        })
        cssScale.value = 1
        zoomRef.value = { mode: 'fixed', value: Math.round(finalScale * 100) }
        nextTick(() => {
          if (!containerRef.value) return
          if (typeof restoreHorizontalAfterSettle === 'function') {
            restoreHorizontalAfterSettle()
          } else {
            containerRef.value.scrollLeft = Math.max(0, newScrollLeft)
          }
          containerRef.value.scrollTop = Math.max(0, newScrollTop)
        })
      } else {
        cssScale.value = 1
        zoomRef.value = { mode: 'fixed', value: Math.round(finalScale * 100) }
        if (onZoomSettle) onZoomSettle(finalScale)
      }
      baseScale = finalScale
    }, SETTLE_MS)
  }

  function isGestureActive() {
    return settleTimer !== null
  }

  function cancelGesture() {
    if (!isGestureActive()) return false
    clearTimeout(settleTimer)
    settleTimer = null
    cssScale.value = 1
    baseScale = getEffectiveScale()
    onZoomCancel?.()
    return true
  }

  function stepZoom(direction) {
    if (isGestureActive()) {
      const next = computeSteppedPdfZoom(baseScale * cssScale.value, direction)
      cssScale.value = next.value / 100 / baseScale
      return next
    }
    zoomRef.value = computeSteppedPdfZoom(getEffectiveScale(), direction)
    return zoomRef.value
  }

  function resetZoom() {
    zoomRef.value = resolvePdfZoomPreset('fit-width')
  }

  function setPreset(preset) {
    zoomRef.value = resolvePdfZoomPreset(preset)
  }

  onUnmounted(() => {
    clearTimeout(settleTimer)
    settleTimer = null
  })

  return {
    cssScale,
    transformOrigin,
    onWheel,
    isGestureActive,
    cancelGesture,
    stepZoom,
    resetZoom,
    setPreset
  }
}
