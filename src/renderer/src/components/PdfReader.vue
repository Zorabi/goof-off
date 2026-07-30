<script setup>
import { computed, ref, onMounted, onBeforeUnmount, onUnmounted, watch, nextTick, toRaw } from 'vue'
import { injectPdf } from '../composables/usePdf.js'
import { usePdfRenderer } from '../composables/usePdfRenderer.js'
import { usePdfZoom } from '../composables/usePdfZoom.js'
import { usePdfKeyboard } from '../composables/usePdfKeyboard.js'
import { pushStatus } from '../composables/usePageMessages.js'
import { useAppState } from '../composables/useAppState.js'
import { registerActiveReaderFlush } from '../composables/useActiveReaderFlush.js'
import { shouldDiscardMaintenanceProgress } from '../composables/useMaintenanceReset.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import { createPdfDuotoneFilterId } from '../composables/pdfDuotoneFilterId.js'
import { createPdfDuotoneMatrix, normalizePdfColorPrefs } from '../../../shared/pdfColorPrefs.js'

const { dispatch } = useAppState()
const pdf = injectPdf()
const { pdfPrefs } = useReaderPrefs()
const containerRef = ref(null)
const innerRef = ref(null)
const canvasRefs = ref({})
const failedPages = ref(new Set())
const pdfDuotoneFilterId = createPdfDuotoneFilterId()
const pdfDuotoneColors = computed(() => normalizePdfColorPrefs(pdfPrefs.value))
const pdfDuotoneMatrix = computed(() => createPdfDuotoneMatrix(pdfDuotoneColors.value))

const mountedFileId = pdf.fileId.value
const mountedSessionToken = pdf.sessionToken?.value
const mountedDoc = pdf.doc.value

function isMountedSessionCurrent() {
  return pdf.fileId.value === mountedFileId && pdf.doc.value === mountedDoc
}

const renderer = usePdfRenderer(pdf.doc, pdf.pageCount, pdf.zoom, containerRef)

const pdfZoom = usePdfZoom(
  pdf.zoom,
  containerRef,
  innerRef,
  onPdfWheelZoomSettle,
  () => renderer.effectiveScale(),
  onPdfWheelZoomStart,
  onPdfWheelZoomCancel
)

usePdfKeyboard(onKeyboardPdfZoomStep, onKeyboardPdfZoomReset)

const isDragging = ref(false)
const cursorStyle = ref('default')
const pdfReaderStyle = computed(() => ({
  cursor: cursorStyle.value,
  '--pdf-background-color': pdfDuotoneColors.value.backgroundColor,
  '--pdf-text-color': pdfDuotoneColors.value.textColor,
  '--pdf-duotone-filter': `url(#${pdfDuotoneFilterId})`
}))
let dragStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 }

let resizeObserver = null
let resizeDebounce = null
let renderPoolTimer = null
let progressSaveDebounce = null
let unregisterProgressCollector = null
let unregisterActiveFlush = null
const pendingRestoreAnchor = ref(null)
const initialRestorePending = ref(false)
let lastAppliedRestoreScrollTop = null
let zoomOwnsHorizontalRestore = false
let pendingTrackWidthAnchor = null
let observedViewportWidth = null
let stableHorizontalTrackAnchor = null
let pendingResizeHorizontalAnchor = null
let horizontalRestoreRevision = 0
let lastKnownHorizontalScrollLeft = null
let wheelZoomHorizontalAnchor = null

function invalidatePendingResizeHorizontalAnchor() {
  pendingResizeHorizontalAnchor = null
  horizontalRestoreRevision += 1
}

function claimPdfZoomHorizontalRestore() {
  zoomOwnsHorizontalRestore = true
  pendingTrackWidthAnchor = null
  invalidatePendingResizeHorizontalAnchor()
}

function onPdfWheelZoomStart({ originX } = {}) {
  if (!containerRef.value) return
  claimPdfZoomHorizontalRestore()
  renderer.updateCurrentPage()
  const page = renderer.currentPage.value
  const viewportX = Number.isFinite(originX) ? originX : containerRef.value.clientWidth / 2
  wheelZoomHorizontalAnchor = {
    page,
    viewportX,
    pageWidth: scaledPageWidth(page),
    horizontalRatio: capturePdfHorizontalPageAnchor(page, viewportX)
  }
}

function onPdfWheelZoomCancel() {
  wheelZoomHorizontalAnchor = null
  zoomOwnsHorizontalRestore = false
}

function onPdfWheelZoomSettle(_finalScale, { originX } = {}) {
  if (!containerRef.value) {
    wheelZoomHorizontalAnchor = null
    zoomOwnsHorizontalRestore = false
    scheduleRenderPool()
    return null
  }
  const viewportX = Number.isFinite(originX) ? originX : containerRef.value.clientWidth / 2
  let anchor = wheelZoomHorizontalAnchor
  if (!anchor) {
    claimPdfZoomHorizontalRestore()
    renderer.updateCurrentPage()
    const page = renderer.currentPage.value
    anchor = {
      page,
      viewportX,
      pageWidth: scaledPageWidth(page),
      horizontalRatio: capturePdfHorizontalPageAnchor(page, viewportX)
    }
  } else if (viewportX !== anchor.viewportX) {
    if (Number.isFinite(anchor.horizontalRatio) && anchor.pageWidth > 0) {
      anchor.horizontalRatio += (viewportX - anchor.viewportX) / anchor.pageWidth
    } else {
      anchor.horizontalRatio = capturePdfHorizontalPageAnchor(anchor.page, viewportX)
    }
    anchor.viewportX = viewportX
  }
  scheduleRenderPool()
  return () => {
    try {
      if (!isMountedSessionCurrent() || !containerRef.value) return
      restorePdfHorizontalPageAnchor(anchor, anchor.page, anchor.viewportX)
    } finally {
      if (wheelZoomHorizontalAnchor === anchor) wheelZoomHorizontalAnchor = null
      zoomOwnsHorizontalRestore = false
    }
  }
}

function clearPendingRestoreAnchor() {
  pendingRestoreAnchor.value = null
  initialRestorePending.value = false
  lastAppliedRestoreScrollTop = null
}

function restoreAnchorPage(anchor) {
  const total = renderer.pageOffsets.value.length || pdf.pageCount.value || anchor?.page || 1
  return Math.max(1, Math.min(anchor?.page || 1, total))
}

function isPendingRestoreAnchorReady() {
  const anchor = pendingRestoreAnchor.value
  if (!anchor) return false
  const resolvedCount = renderer.resolvedBaseSizePageCount?.value
  if (typeof resolvedCount !== 'number') return true
  return resolvedCount >= restoreAnchorPage(anchor)
}

function applyPendingRestoreAnchor({ requireReady = false } = {}) {
  if (!pendingRestoreAnchor.value || !containerRef.value) return false
  if (renderer.pageOffsets.value.length === 0) return false
  if (requireReady && !isPendingRestoreAnchorReady()) return false
  lastAppliedRestoreScrollTop = restorePdfScrollAnchor(pendingRestoreAnchor.value)
  initialRestorePending.value = false
  flushRenderPool()
  if (isPendingRestoreAnchorReady()) clearPendingRestoreAnchor()
  return true
}

onMounted(async () => {
  const initialProgress = pdf.consumePendingInitialProgress?.()
  if (initialProgress) {
    pdf.currentPage.value = initialProgress.page || 1
    pdf.initialInPageRatio.value = initialProgress.inPageRatio || 0
    if (initialProgress.zoom) pdf.zoom.value = initialProgress.zoom
    if ((initialProgress.page || 1) > 1 || (initialProgress.inPageRatio || 0) > 0) {
      pendingRestoreAnchor.value = {
        page: initialProgress.page || 1,
        ratio: initialProgress.inPageRatio || 0
      }
      initialRestorePending.value = true
    }
  }
  unregisterProgressCollector = pdf.registerProgressCollector(collectCurrentProgress)
  unregisterActiveFlush = registerActiveReaderFlush(pdf.flushCurrentProgress)

  try {
    await renderer.collectBaseSizes({
      priorityPage: pendingRestoreAnchor.value
        ? restoreAnchorPage(pendingRestoreAnchor.value)
        : null
    })
    await nextTick()
  } catch (err) {
    if (!isMountedSessionCurrent()) return
    console.error('PDF 元数据采集失败:', err)
    pushStatus('PDF 文件损坏或无法读取')
    dispatch({ type: 'NAVIGATE_HOME' })
    return
  }
  if (!isMountedSessionCurrent() || !containerRef.value) return
  restorePdfHorizontalTrackAnchor(0)
  observedViewportWidth = containerRef.value.clientWidth
  rememberStableHorizontalTrackAnchor()
  const targetPage = pdf.currentPage.value
  const ratio = pdf.initialInPageRatio.value || 0
  if (targetPage > 1 || ratio > 0) {
    applyPendingRestoreAnchor({ requireReady: true })
  }
  if (!initialRestorePending.value) {
    renderer.updateCurrentPage()
    syncPdfRuntimeProgress()
  }
  scheduleRenderPool()

  resizeObserver = new ResizeObserver(() => {
    if (!containerRef.value) return
    const viewportWidth = containerRef.value.clientWidth
    if (
      observedViewportWidth !== null &&
      viewportWidth !== observedViewportWidth &&
      !pendingResizeHorizontalAnchor
    ) {
      // ResizeObserver 仅在稳定锚点初始化后注册；上一轮回调结束时会让它与 observedViewportWidth 同步。
      const stableAnchor = stableHorizontalTrackAnchor
      pendingResizeHorizontalAnchor = {
        offset: stableAnchor.offset,
        revision: stableAnchor.revision
      }
    }
    observedViewportWidth = viewportWidth
    lastKnownHorizontalScrollLeft = containerRef.value.scrollLeft
    rememberStableHorizontalTrackAnchor()
    if (resizeDebounce) clearTimeout(resizeDebounce)
    resizeDebounce = setTimeout(async () => {
      const horizontalAnchor = pendingResizeHorizontalAnchor
      pendingResizeHorizontalAnchor = null
      if (zoomOwnsHorizontalRestore) return
      if (isResponsiveFitMode()) {
        const anchor = initialRestorePending.value ? null : capturePdfScrollAnchor()
        renderer.recomputeOffsets()
        if (anchor) {
          await nextTick()
          if (!isMountedSessionCurrent() || !containerRef.value) return
          restorePdfScrollAnchor(anchor)
        } else if (!initialRestorePending.value) {
          renderer.updateCurrentPage()
          syncPdfRuntimeProgress()
        }
        invalidateRenderedPages()
        scheduleRenderPool()
      } else if (
        horizontalAnchor?.revision === horizontalRestoreRevision &&
        isMountedSessionCurrent() &&
        containerRef.value
      ) {
        restorePdfHorizontalTrackAnchor(horizontalAnchor.offset)
      }
    }, 150)
  })
  resizeObserver.observe(containerRef.value)
})

function canPan() {
  if (!containerRef.value) return false
  return containerRef.value.scrollWidth > containerRef.value.clientWidth
}

function onMousedown(e) {
  if (!canPan() || e.button !== 0) return
  isDragging.value = true
  cursorStyle.value = 'grabbing'
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    scrollLeft: containerRef.value.scrollLeft,
    scrollTop: containerRef.value.scrollTop
  }
  window.addEventListener('mousemove', onMousemove)
  window.addEventListener('mouseup', onMouseup)
}

function onMousemove(e) {
  if (!isDragging.value) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  containerRef.value.scrollLeft = dragStart.scrollLeft - dx
  containerRef.value.scrollTop = dragStart.scrollTop - dy
}

function onMouseup() {
  isDragging.value = false
  cursorStyle.value = canPan() ? 'grab' : 'default'
  window.removeEventListener('mousemove', onMousemove)
  window.removeEventListener('mouseup', onMouseup)
}

function isResponsiveFitMode() {
  return pdf.zoom.value.mode === 'fit-width' || pdf.zoom.value.mode === 'fit-page'
}

function horizontalTrackWidth(
  layoutWidth = renderer.totalWidth.value,
  viewportWidth = containerRef.value?.clientWidth || 0
) {
  const viewportW = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const contentW = Number.isFinite(layoutWidth) ? layoutWidth : 0
  return Math.max(viewportW, contentW)
}

function capturePdfHorizontalTrackAnchor(
  layoutWidth = renderer.totalWidth.value,
  viewportWidth = containerRef.value?.clientWidth || 0,
  scrollLeft = containerRef.value?.scrollLeft || 0
) {
  if (!containerRef.value) return 0
  const viewportW = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const scrollX = Number.isFinite(scrollLeft) ? scrollLeft : 0
  const viewportCenter = scrollX + viewportW / 2
  return viewportCenter - horizontalTrackWidth(layoutWidth, viewportW) / 2
}

function rememberStableHorizontalTrackAnchor() {
  if (!containerRef.value) return
  const viewportWidth = containerRef.value.clientWidth
  if (observedViewportWidth !== null && viewportWidth !== observedViewportWidth) return
  stableHorizontalTrackAnchor = {
    viewportWidth,
    offset: capturePdfHorizontalTrackAnchor(renderer.totalWidth.value, viewportWidth),
    revision: horizontalRestoreRevision
  }
}

function setPdfScrollLeft(
  targetLeft,
  layoutWidth = renderer.totalWidth.value,
  viewportWidth = containerRef.value?.clientWidth || 0
) {
  if (!containerRef.value) return
  const viewportW = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const maxLeft = Math.max(0, horizontalTrackWidth(layoutWidth, viewportW) - viewportW)
  containerRef.value.scrollLeft = Math.min(maxLeft, Math.max(0, targetLeft))
  lastKnownHorizontalScrollLeft = containerRef.value.scrollLeft
  rememberStableHorizontalTrackAnchor()
}

function restorePdfHorizontalTrackAnchor(
  offset = 0,
  layoutWidth = renderer.totalWidth.value,
  viewportWidth = containerRef.value?.clientWidth || 0
) {
  if (!containerRef.value) return
  const viewportW = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const targetLeft =
    horizontalTrackWidth(layoutWidth, viewportW) / 2 +
    (Number.isFinite(offset) ? offset : 0) -
    viewportW / 2
  setPdfScrollLeft(targetLeft, layoutWidth, viewportW)
}

function scaledPageWidth(page) {
  const size = renderer.baseSizes.value[page - 1]
  return size ? Math.round(size.w * currentLayoutScale()) : 0
}

function capturePdfHorizontalPageAnchor(page, viewportX = containerRef.value?.clientWidth / 2) {
  if (!containerRef.value) return null
  const pageW = scaledPageWidth(page)
  if (pageW <= 0) return null
  const pageLeft = (horizontalTrackWidth() - pageW) / 2
  const viewportPoint = containerRef.value.scrollLeft + viewportX
  return (viewportPoint - pageLeft) / pageW
}

function restorePdfHorizontalPageAnchor(
  anchor,
  page,
  viewportX = containerRef.value?.clientWidth / 2
) {
  const pageW = scaledPageWidth(page)
  if (!Number.isFinite(anchor?.horizontalRatio) || pageW <= 0) {
    restorePdfHorizontalTrackAnchor(0)
    return
  }
  const pageLeft = (horizontalTrackWidth() - pageW) / 2
  setPdfScrollLeft(pageLeft + pageW * anchor.horizontalRatio - viewportX)
}

function capturePdfScrollAnchor() {
  if (!containerRef.value || renderer.pageOffsets.value.length === 0) return null
  renderer.updateCurrentPage()
  const page = renderer.currentPage.value
  return {
    page,
    ratio: computeInPageRatio(),
    horizontalRatio: capturePdfHorizontalPageAnchor(page)
  }
}

function currentLayoutScale() {
  return renderer.layoutScale?.value ?? renderer.effectiveScale()
}

function restorePdfScrollAnchor(anchor) {
  if (!anchor || !containerRef.value || renderer.pageOffsets.value.length === 0) return
  const idx = restoreAnchorPage(anchor) - 1
  const pageTop = renderer.pageOffsets.value[idx] || 0
  const size = renderer.baseSizes.value[idx]
  const pageH = size ? Math.round(size.h * currentLayoutScale()) : 1
  const viewportH = containerRef.value.clientHeight
  const targetTop = Math.max(0, pageTop + pageH * anchor.ratio - viewportH / 2)
  restorePdfHorizontalPageAnchor(anchor, idx + 1)
  containerRef.value.scrollTop = targetTop
  renderer.updateCurrentPage()
  syncPdfRuntimeProgress()
  return targetTop
}

function applyPdfZoomChange(updateZoom) {
  pdfZoom.cancelGesture()
  clearPendingRestoreAnchor()
  const anchor = capturePdfScrollAnchor()
  claimPdfZoomHorizontalRestore()
  try {
    updateZoom()
  } catch (err) {
    zoomOwnsHorizontalRestore = false
    throw err
  }
  nextTick(() => {
    try {
      restorePdfScrollAnchor(anchor)
    } finally {
      zoomOwnsHorizontalRestore = false
    }
  })
}

function onKeyboardPdfZoomStep(direction) {
  const delta = Number(direction)
  if (delta !== 1 && delta !== -1) return
  if (pdfZoom.isGestureActive()) {
    pdfZoom.stepZoom(delta)
    return
  }
  applyPdfZoomChange(() => pdfZoom.stepZoom(delta))
}

function onKeyboardPdfZoomReset() {
  applyPdfZoomChange(() => pdfZoom.resetZoom())
}

function onZoomPreset(e) {
  applyPdfZoomChange(() => pdfZoom.setPreset(e.detail))
}

function onZoomStep(e) {
  onKeyboardPdfZoomStep(e.detail)
}

function onGoToPage(e) {
  const n = e.detail
  clearPendingRestoreAnchor()
  if (typeof n === 'number') {
    renderer.goToPage(n)
    flushRenderPool()
    syncPdfRuntimeProgress()
  }
}

onMounted(() => {
  window.addEventListener('pdf:go-to-page', onGoToPage)
  window.addEventListener('pdf:zoom-preset', onZoomPreset)
  window.addEventListener('pdf:zoom-step', onZoomStep)
  containerRef.value.addEventListener('wheel', pdfZoom.onWheel, { passive: false })
})

// Vue 在 unmounted 钩子前已置空模板 ref，computeInPageRatio 会因 containerRef
// 为 null 恒返 0，把防抖里存好的正确页内位置覆盖成页顶；保存必须在
// beforeUnmount（ref 仍存活）完成。与 TxtReader 同一处理。
onBeforeUnmount(() => {
  if (!shouldDiscardMaintenanceProgress()) {
    window.api.pdfFlushProgress(mountedFileId, collectCurrentProgress())
  }
})

onUnmounted(() => {
  unregisterActiveFlush?.()
  unregisterProgressCollector?.()
  renderer.cleanup()
  if (mountedDoc && pdf.doc.value === mountedDoc) {
    mountedDoc.destroy()
    pdf.doc.value = null
  }
  // 定向关闭本阅读器挂载时的那次会话：若同一文件已被重新打开（新 token），主进程会忽略本次 close
  window.api.pdfClose(mountedFileId, mountedSessionToken)

  if (progressSaveDebounce) clearTimeout(progressSaveDebounce)
  if (resizeDebounce) clearTimeout(resizeDebounce)
  if (renderPoolTimer) cancelAnimationFrame(renderPoolTimer)
  if (resizeObserver) resizeObserver.disconnect()
  window.removeEventListener('pdf:go-to-page', onGoToPage)
  window.removeEventListener('pdf:zoom-preset', onZoomPreset)
  window.removeEventListener('pdf:zoom-step', onZoomStep)
  if (containerRef.value) {
    containerRef.value.removeEventListener('wheel', pdfZoom.onWheel)
  }
})

function collectCurrentProgress() {
  const zoom = toRaw(pdf.zoom.value)
  const pendingAnchor = initialRestorePending.value ? pendingRestoreAnchor.value : null
  if (pendingAnchor) {
    return {
      page: restoreAnchorPage(pendingAnchor),
      inPageRatio: Math.min(1, Math.max(0, pendingAnchor.ratio || 0)),
      zoom: zoom ? { ...zoom } : null
    }
  }
  return {
    page: renderer.currentPage.value,
    inPageRatio: computeInPageRatio(),
    zoom: zoom ? { ...zoom } : null
  }
}

function computeInPageRatio() {
  if (!containerRef.value || renderer.pageOffsets.value.length === 0) return 0
  const scrollTop = containerRef.value.scrollTop
  const viewportH = containerRef.value.clientHeight
  const centerY = scrollTop + viewportH / 2
  const idx = renderer.currentPage.value - 1
  const pageTop = renderer.pageOffsets.value[idx] || 0
  const pageH =
    idx < renderer.baseSizes.value.length
      ? Math.round(renderer.baseSizes.value[idx].h * currentLayoutScale())
      : 1
  return Math.min(1, Math.max(0, (centerY - pageTop) / pageH))
}

function computeProgressPercent() {
  const total = pdf.pageCount.value
  if (!total) return 0
  const pageIndex = Math.max(0, renderer.currentPage.value - 1)
  return Math.max(0, Math.min(100, Math.round(((pageIndex + computeInPageRatio()) / total) * 100)))
}

function syncPdfRuntimeProgress() {
  pdf.currentPage.value = renderer.currentPage.value
  pdf.progressPercent.value = computeProgressPercent()
}

function invalidateRenderedPages() {
  renderer.cancelAll()
  for (const pageNum of renderer.renderedPages.value) {
    const canvas = canvasRefs.value[pageNum]
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
  renderer.renderedPages.value = new Set()
  failedPages.value = new Set()
}

function scheduleRenderPool() {
  if (renderPoolTimer) return
  renderPoolTimer = requestAnimationFrame(() => {
    renderPoolTimer = null
    updateRenderPool()
  })
}

function flushRenderPool() {
  if (renderPoolTimer) {
    cancelAnimationFrame(renderPoolTimer)
    renderPoolTimer = null
  }
  updateRenderPool()
}

function updateRenderPool() {
  const { start, end } = renderer.getPoolRange()
  const targetSet = new Set()
  for (let i = start; i <= end; i++) targetSet.add(i)

  for (const pageNum of renderer.renderedPages.value) {
    if (!targetSet.has(pageNum)) {
      renderer.cancelPage(pageNum)
      const canvas = canvasRefs.value[pageNum]
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }

  const nextRenderedPages = new Set()
  for (const pageNum of targetSet) {
    if (!renderer.renderedPages.value.has(pageNum)) {
      const canvas = canvasRefs.value[pageNum]
      if (canvas) {
        failedPages.value.delete(pageNum)
        renderer.renderPage(pageNum, canvas).catch((err) => {
          if (!isMountedSessionCurrent()) return
          if (err?.name === 'RenderingCancelledException') return

          const msg = err?.message || ''
          if (msg.includes('Range') || msg.includes('network') || msg.includes('abort')) {
            pushStatus('文件读取中断')
            dispatch({ type: 'NAVIGATE_HOME' })
            return
          }

          console.error(`页面 ${pageNum} 渲染失败:`, err)
          failedPages.value = new Set(failedPages.value).add(pageNum)
        })
        nextRenderedPages.add(pageNum)
      }
    } else if (canvasRefs.value[pageNum]) {
      nextRenderedPages.add(pageNum)
    }
  }

  renderer.renderedPages.value = nextRenderedPages
}

function schedulePdfProgressSave() {
  if (progressSaveDebounce) clearTimeout(progressSaveDebounce)
  progressSaveDebounce = setTimeout(() => {
    if (shouldDiscardMaintenanceProgress()) return
    window.api.pdfSaveProgress(mountedFileId, collectCurrentProgress())
  }, 1000)
}

function onScroll() {
  const scrollLeft = containerRef.value?.scrollLeft
  if (
    Number.isFinite(scrollLeft) &&
    Number.isFinite(lastKnownHorizontalScrollLeft) &&
    Math.abs(scrollLeft - lastKnownHorizontalScrollLeft) > 0.5
  ) {
    invalidatePendingResizeHorizontalAnchor()
  }
  lastKnownHorizontalScrollLeft = scrollLeft
  rememberStableHorizontalTrackAnchor()
  if (initialRestorePending.value) return
  if (
    pendingRestoreAnchor.value &&
    Math.abs(containerRef.value.scrollTop - (lastAppliedRestoreScrollTop ?? -1)) > 1
  ) {
    clearPendingRestoreAnchor()
  }
  renderer.onScroll()
  scheduleRenderPool()
  syncPdfRuntimeProgress()

  schedulePdfProgressSave()
}

watch(
  () => pdf.zoom.value,
  () => {
    invalidatePendingResizeHorizontalAnchor()
    renderer.recomputeOffsets()
    invalidateRenderedPages()
    scheduleRenderPool()
    schedulePdfProgressSave()
    nextTick(() => {
      cursorStyle.value = canPan() ? 'grab' : 'default'
    })
  },
  { deep: true }
)

watch(
  () => renderer.currentPage.value,
  () => {
    syncPdfRuntimeProgress()
    schedulePdfProgressSave()
  }
)

watch(
  () => renderer.baseSizes.value.length,
  () => {
    nextTick(() => scheduleRenderPool())
  }
)

watch(
  () => renderer.layoutScale.value,
  () => {
    if (!initialRestorePending.value) renderer.updateCurrentPage()
    if (renderer.renderedPages.value.size > 0) invalidateRenderedPages()
    scheduleRenderPool()
  },
  { flush: 'post' }
)

watch(
  () => renderer.pageOffsets.value,
  () => {
    if (!pendingRestoreAnchor.value) return
    applyPendingRestoreAnchor({ requireReady: true })
  },
  { flush: 'post' }
)

watch(
  () => renderer.resolvedBaseSizePageCount?.value,
  () => {
    if (!pendingRestoreAnchor.value || !isPendingRestoreAnchorReady()) return
    applyPendingRestoreAnchor({ requireReady: true })
  },
  { flush: 'post' }
)

watch(
  () => renderer.totalWidth.value,
  (_nextWidth, previousWidth) => {
    if (!containerRef.value || zoomOwnsHorizontalRestore) return
    if (!pendingTrackWidthAnchor) {
      pendingTrackWidthAnchor = {
        offset: capturePdfHorizontalTrackAnchor(previousWidth),
        layoutWidth: _nextWidth
      }
    } else {
      pendingTrackWidthAnchor.layoutWidth = _nextWidth
    }
    const anchor = pendingTrackWidthAnchor
    nextTick(() => {
      if (pendingTrackWidthAnchor !== anchor) return
      pendingTrackWidthAnchor = null
      if (zoomOwnsHorizontalRestore || !isMountedSessionCurrent() || !containerRef.value) return
      restorePdfHorizontalTrackAnchor(anchor.offset, anchor.layoutWidth)
    })
  }
)
</script>

<template>
  <div
    ref="containerRef"
    class="pdf-scroll-container"
    :class="{
      'is-restoring-initial-scroll': initialRestorePending,
      'is-custom-colors': pdfPrefs.invertColors
    }"
    :style="pdfReaderStyle"
    @scroll="onScroll"
    @mousedown="onMousedown"
  >
    <svg class="pdf-duotone-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter :id="pdfDuotoneFilterId" color-interpolation-filters="sRGB">
          <feColorMatrix data-test="pdf-duotone-matrix" type="matrix" :values="pdfDuotoneMatrix" />
        </filter>
      </defs>
    </svg>
    <div v-if="initialRestorePending" class="pdf-restore-placeholder" aria-hidden="true">
      <div class="pdf-restore-page"></div>
    </div>
    <div
      ref="innerRef"
      class="pdf-pages"
      :style="{
        width: renderer.totalWidth.value + 'px',
        height: renderer.totalHeight.value + 'px',
        transform: pdfZoom.cssScale.value !== 1 ? `scale(${pdfZoom.cssScale.value})` : undefined,
        transformOrigin: pdfZoom.transformOrigin.value
      }"
    >
      <div
        v-for="(size, idx) in renderer.baseSizes.value"
        :key="idx"
        class="pdf-page-slot"
        :style="{
          position: 'absolute',
          top: (renderer.pageOffsets.value[idx] || 0) + 'px',
          width: Math.round(size.w * renderer.layoutScale.value) + 'px',
          height: Math.round(size.h * renderer.layoutScale.value) + 'px',
          left: '50%',
          transform: 'translateX(-50%)'
        }"
      >
        <canvas
          :ref="
            (el) => {
              if (el) canvasRefs[idx + 1] = el
              else delete canvasRefs[idx + 1]
            }
          "
          class="pdf-canvas"
          :style="{ display: failedPages.has(idx + 1) ? 'none' : 'block' }"
        />
        <div v-if="failedPages.has(idx + 1)" class="pdf-page-error">
          页面 {{ idx + 1 }} 渲染失败
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pdf-scroll-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
  background: var(--panel-bg);
  overflow-anchor: none;
  animation: reader-fade-in var(--motion-content) ease;
}
.pdf-scroll-container.is-restoring-initial-scroll {
  pointer-events: none;
}
.pdf-scroll-container.is-custom-colors {
  background: var(--pdf-background-color);
}
.pdf-scroll-container.is-restoring-initial-scroll .pdf-pages {
  visibility: hidden;
}
.pdf-restore-placeholder {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.pdf-duotone-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
.pdf-restore-page {
  width: min(72%, 420px);
  height: min(72%, 560px);
  max-height: calc(100% - 48px);
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.32));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 8px 24px rgba(0, 0, 0, 0.12);
  opacity: 0.62;
  animation: pdf-restore-pulse 900ms ease-in-out infinite alternate;
}
.pdf-pages {
  position: relative;
  min-width: 100%;
}
.pdf-page-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.pdf-canvas {
  display: block;
}
.pdf-scroll-container.is-custom-colors .pdf-page-slot {
  background: var(--pdf-background-color);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.36);
}
.pdf-scroll-container.is-custom-colors .pdf-canvas {
  filter: var(--pdf-duotone-filter);
}
.pdf-scroll-container.is-custom-colors .pdf-restore-page {
  background: var(--pdf-background-color);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 8px 24px rgba(0, 0, 0, 0.28);
}
.pdf-scroll-container.is-custom-colors .pdf-page-error {
  color: var(--pdf-text-color);
}
.pdf-page-error {
  color: var(--text-secondary);
  font-size: 13px;
  user-select: none;
}
@keyframes pdf-restore-pulse {
  from {
    opacity: 0.42;
  }
  to {
    opacity: 0.68;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pdf-restore-page {
    animation: none;
  }
}
@keyframes reader-fade-in {
  from {
    opacity: 0;
  }
}
</style>
