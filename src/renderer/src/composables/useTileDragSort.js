import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

const DRAG_THRESHOLD_PX = 5
const EDGE_ZONE_PX = 24
const EDGE_MAX_SPEED_PX = 14

export function computeInsertIndex(rects, point) {
  let index = 0
  for (const rect of rects) {
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const sameRow = Math.abs(point.y - centerY) <= rect.height / 2
    if (sameRow ? point.x > centerX : point.y > centerY) index += 1
  }
  return index
}

export function buildReorderedIds(ids, draggedId, insertIndex) {
  const rest = ids.filter((id) => id !== draggedId)
  const clamped = Math.max(0, Math.min(insertIndex, rest.length))
  return [...rest.slice(0, clamped), draggedId, ...rest.slice(clamped)]
}

function defaultMeasureTiles(container, draggedId) {
  const rects = []
  for (const el of container.querySelectorAll('[data-site-id]')) {
    const id = el.getAttribute('data-site-id')
    if (id === draggedId) continue
    rects.push({
      id,
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight
    })
  }
  return rects
}

export function useTileDragSort({
  getContainer,
  getScrollContainer,
  getOrderedIds,
  onReorder,
  isBlocked = () => false,
  measureTiles = defaultMeasureTiles
}) {
  const draggingId = ref(null)
  const previewIds = ref(null)

  let pending = null
  let ghost = null
  let ghostOrigin = null
  let lastClient = null
  let suppressNextClick = false
  let gestureBlocked = false
  let edgeSpeed = 0
  let edgeFrame = 0

  function toContentPoint(clientX, clientY) {
    const scroller = getScrollContainer?.()
    if (!scroller) return { x: clientX, y: clientY }
    const rect = scroller.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top + scroller.scrollTop }
  }

  function createGhost(tileEl, clientX, clientY) {
    const rect = tileEl.getBoundingClientRect()
    ghost = tileEl.cloneNode(true)
    ghost.setAttribute('data-drag-ghost', '')
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      zIndex: 'var(--z-popover)',
      pointerEvents: 'none',
      background: 'var(--color-hover-bg)',
      borderRadius: 'var(--radius-tile)',
      boxShadow: 'var(--shadow-float)',
      transition: 'none',
      transform: 'scale(1.03)'
    })
    ghostOrigin = { x: clientX, y: clientY }
    document.body.appendChild(ghost)
  }

  function moveGhost(clientX, clientY) {
    if (!ghost) return
    ghost.style.transform = `translate(${clientX - ghostOrigin.x}px, ${clientY - ghostOrigin.y}px) scale(1.03)`
  }

  function updatePreview() {
    const container = getContainer?.()
    if (!container || !draggingId.value || !lastClient) return
    const point = toContentPoint(lastClient.x, lastClient.y)
    const rects = measureTiles(container, draggingId.value)
    const index = computeInsertIndex(rects, point)
    const next = buildReorderedIds(previewIds.value, draggingId.value, index)
    if (next.some((id, i) => id !== previewIds.value[i])) previewIds.value = next
  }

  function edgeTick() {
    edgeFrame = 0
    const scroller = getScrollContainer?.()
    if (!scroller || !draggingId.value || edgeSpeed === 0) return
    scroller.scrollTop += edgeSpeed
    updatePreview()
    edgeFrame = requestAnimationFrame(edgeTick)
  }

  function updateEdgeScroll() {
    const scroller = getScrollContainer?.()
    if (!scroller || !lastClient) {
      edgeSpeed = 0
      return
    }
    const rect = scroller.getBoundingClientRect()
    const topGap = lastClient.y - rect.top
    const bottomGap = rect.bottom - lastClient.y
    if (topGap < EDGE_ZONE_PX) {
      edgeSpeed = -Math.ceil(((EDGE_ZONE_PX - topGap) / EDGE_ZONE_PX) * EDGE_MAX_SPEED_PX)
    } else if (bottomGap < EDGE_ZONE_PX) {
      edgeSpeed = Math.ceil(((EDGE_ZONE_PX - bottomGap) / EDGE_ZONE_PX) * EDGE_MAX_SPEED_PX)
    } else {
      edgeSpeed = 0
    }
    if (edgeSpeed !== 0 && !edgeFrame) edgeFrame = requestAnimationFrame(edgeTick)
  }

  function beginDrag(event) {
    draggingId.value = pending.id
    previewIds.value = [...getOrderedIds()]
    createGhost(pending.tileEl, event.clientX, event.clientY)
    getContainer?.()?.setPointerCapture?.(pending.pointerId)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', onWindowBlur)
  }

  function onWindowPointermove(event) {
    if (!pending) return
    if (!draggingId.value) {
      const dx = event.clientX - pending.startX
      const dy = event.clientY - pending.startY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      beginDrag(event)
    }
    lastClient = { x: event.clientX, y: event.clientY }
    moveGhost(event.clientX, event.clientY)
    updatePreview()
    updateEdgeScroll()
  }

  function onWindowPointerup() {
    if (draggingId.value) {
      const ids = [...previewIds.value]
      cleanup(true)
      onReorder?.(ids)
      return
    }
    cleanup(false)
  }

  function onWindowPointercancel() {
    cancelDrag()
  }

  function onWindowBlur() {
    cancelDrag()
  }

  function onKeydown(event) {
    if (event.key !== 'Escape' || !draggingId.value) return
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
  }

  function cancelDrag() {
    cleanup(draggingId.value != null)
  }

  function cleanup(suppress) {
    window.removeEventListener('pointermove', onWindowPointermove)
    window.removeEventListener('pointerup', onWindowPointerup)
    window.removeEventListener('pointercancel', onWindowPointercancel)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('blur', onWindowBlur)
    if (edgeFrame) {
      cancelAnimationFrame(edgeFrame)
      edgeFrame = 0
    }
    edgeSpeed = 0
    ghost?.remove()
    ghost = null
    ghostOrigin = null
    lastClient = null
    pending = null
    draggingId.value = null
    previewIds.value = null
    suppressNextClick = suppress
  }

  function onPointerdown(event) {
    if (event.button !== 0 || event.pointerType === 'touch') return
    if (gestureBlocked || isBlocked()) return
    const container = getContainer?.()
    const tileEl = event.target?.closest?.('[data-site-id]')
    if (!container || !tileEl || !container.contains(tileEl)) return
    pending = {
      id: tileEl.getAttribute('data-site-id'),
      tileEl,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    }
    window.addEventListener('pointermove', onWindowPointermove)
    window.addEventListener('pointerup', onWindowPointerup)
    window.addEventListener('pointercancel', onWindowPointercancel)
  }

  function onClickCapture(event) {
    if (!suppressNextClick) return
    suppressNextClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  function onContextmenuCapture(event) {
    if (!draggingId.value) return
    event.preventDefault()
    event.stopPropagation()
  }

  function onGesturePointerdownCapture() {
    suppressNextClick = false
    gestureBlocked = isBlocked()
  }

  document.addEventListener('pointerdown', onGesturePointerdownCapture, true)

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      document.removeEventListener('pointerdown', onGesturePointerdownCapture, true)
      cleanup(false)
    })
  }

  return { draggingId, previewIds, onPointerdown, onClickCapture, onContextmenuCapture }
}
