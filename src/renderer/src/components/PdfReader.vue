<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, toRaw } from 'vue'
import { injectPdf } from '../composables/usePdf.js'
import { usePdfRenderer } from '../composables/usePdfRenderer.js'
import { usePdfZoom } from '../composables/usePdfZoom.js'
import { usePdfKeyboard } from '../composables/usePdfKeyboard.js'
import { pushStatus } from '../composables/usePageMessages.js'
import { useAppState } from '../composables/useAppState.js'
import { registerActiveReaderFlush } from '../composables/useActiveReaderFlush.js'
import { shouldDiscardMaintenanceProgress } from '../composables/useMaintenanceReset.js'

const { dispatch } = useAppState()
const pdf = injectPdf()
const containerRef = ref(null)
const innerRef = ref(null)
const canvasRefs = ref({})
const failedPages = ref(new Set())

const mountedFileId = pdf.fileId.value
const mountedDoc = pdf.doc.value

function isMountedSessionCurrent() {
  return pdf.fileId.value === mountedFileId && pdf.doc.value === mountedDoc
}

const renderer = usePdfRenderer(pdf.doc, pdf.pageCount, pdf.zoom, containerRef)

const pdfZoom = usePdfZoom(
  pdf.zoom,
  containerRef,
  innerRef,
  () => {
    scheduleRenderPool()
  },
  () => renderer.effectiveScale()
)

usePdfKeyboard(onKeyboardPdfZoomStep, onKeyboardPdfZoomReset)

const isDragging = ref(false)
const cursorStyle = ref('default')
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
    await renderer.collectBaseSizes()
    await nextTick()
  } catch (err) {
    if (!isMountedSessionCurrent()) return
    console.error('PDF 元数据采集失败:', err)
    pushStatus('PDF 文件损坏或无法读取')
    dispatch({ type: 'NAVIGATE_HOME' })
    return
  }
  if (!isMountedSessionCurrent() || !containerRef.value) return
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
    if (resizeDebounce) clearTimeout(resizeDebounce)
    resizeDebounce = setTimeout(async () => {
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
        scheduleRenderPool()
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

function capturePdfScrollAnchor() {
  if (!containerRef.value || renderer.pageOffsets.value.length === 0) return null
  renderer.updateCurrentPage()
  return {
    page: renderer.currentPage.value,
    ratio: computeInPageRatio()
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
  containerRef.value.scrollTop = targetTop
  renderer.updateCurrentPage()
  syncPdfRuntimeProgress()
  return targetTop
}

function applyPdfZoomChange(updateZoom) {
  clearPendingRestoreAnchor()
  const anchor = capturePdfScrollAnchor()
  updateZoom()
  nextTick(() => restorePdfScrollAnchor(anchor))
}

function onKeyboardPdfZoomStep(direction) {
  const delta = Number(direction)
  if (delta !== 1 && delta !== -1) return
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

onUnmounted(() => {
  if (!shouldDiscardMaintenanceProgress()) {
    window.api.pdfFlushProgress(mountedFileId, collectCurrentProgress())
  }
  unregisterActiveFlush?.()
  unregisterProgressCollector?.()
  renderer.cleanup()
  if (mountedDoc && pdf.doc.value === mountedDoc) {
    mountedDoc.destroy()
    pdf.doc.value = null
  }
  window.api.pdfClose(mountedFileId)

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
    renderer.recomputeOffsets()
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
  () => renderer.pageOffsets.value,
  () => {
    if (!pendingRestoreAnchor.value) return
    applyPendingRestoreAnchor({ requireReady: true })
  },
  { flush: 'post' }
)
</script>

<template>
  <div
    ref="containerRef"
    class="pdf-scroll-container"
    :class="{ 'is-restoring-initial-scroll': initialRestorePending }"
    :style="{ cursor: cursorStyle }"
    @scroll="onScroll"
    @mousedown="onMousedown"
  >
    <div v-if="initialRestorePending" class="pdf-restore-placeholder" aria-hidden="true">
      <div class="pdf-restore-page"></div>
    </div>
    <div
      ref="innerRef"
      class="pdf-pages"
      :style="{
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
          width: Math.round(size.w * renderer.effectiveScale()) + 'px',
          height: Math.round(size.h * renderer.effectiveScale()) + 'px',
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
  width: 100%;
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
