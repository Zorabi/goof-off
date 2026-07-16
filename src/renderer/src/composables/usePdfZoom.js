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

export function usePdfZoom(zoomRef, containerRef, innerRef, onZoomSettle, getEffectiveScale) {
  const cssScale = ref(1)
  const transformOrigin = ref('50% 50%')
  let settleTimer = null
  let baseScale = 1
  let pinchOriginX = 0
  let pinchOriginY = 0

  function onWheel(e) {
    if (!e.ctrlKey || e.deltaY === 0) return
    e.preventDefault()

    if (cssScale.value === 1) {
      baseScale = getEffectiveScale()
    }

    const newScale = computeNewScale(baseScale * cssScale.value, e.deltaY)
    cssScale.value = newScale / baseScale

    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      pinchOriginX = e.clientX - rect.left
      pinchOriginY = e.clientY - rect.top
      const contentX = containerRef.value.scrollLeft + pinchOriginX
      const contentY = containerRef.value.scrollTop + pinchOriginY
      transformOrigin.value = `${contentX}px ${contentY}px`
    }

    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      const finalScale = baseScale * cssScale.value
      const scaleRatio = finalScale / baseScale

      if (containerRef.value) {
        const oldScrollLeft = containerRef.value.scrollLeft
        const oldScrollTop = containerRef.value.scrollTop
        const newScrollLeft = (pinchOriginX + oldScrollLeft) * scaleRatio - pinchOriginX
        const newScrollTop = (pinchOriginY + oldScrollTop) * scaleRatio - pinchOriginY
        cssScale.value = 1
        zoomRef.value = { mode: 'fixed', value: Math.round(finalScale * 100) }
        if (onZoomSettle) onZoomSettle(finalScale)
        nextTick(() => {
          containerRef.value.scrollLeft = Math.max(0, newScrollLeft)
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

  function stepZoom(direction) {
    zoomRef.value = computeSteppedPdfZoom(getEffectiveScale(), direction)
  }

  function resetZoom() {
    zoomRef.value = resolvePdfZoomPreset('fit-width')
  }

  function setPreset(preset) {
    zoomRef.value = resolvePdfZoomPreset(preset)
  }

  onUnmounted(() => {
    clearTimeout(settleTimer)
  })

  return {
    cssScale,
    transformOrigin,
    onWheel,
    stepZoom,
    resetZoom,
    setPreset
  }
}
