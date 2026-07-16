import { ref, shallowRef } from 'vue'

const DEFAULT_POOL_RADIUS = 3
const MEM_TIER1 = 64 * 1024 * 1024
const MEM_TIER2 = 128 * 1024 * 1024
const POOL_TIER1_TOTAL = 256 * 1024 * 1024
const POOL_TIER2_TOTAL = 384 * 1024 * 1024
const MAX_DIM = 4096

export function computePageOffsets(baseSizes, scale) {
  const offsets = []
  let y = 0
  for (const { h } of baseSizes) {
    offsets.push(y)
    y += Math.round(h * scale)
  }
  return offsets
}

export function findCurrentPage(pageOffsets, scrollTop, viewportHeight) {
  const y = scrollTop + viewportHeight / 2
  let lo = 0
  let hi = pageOffsets.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (pageOffsets[mid] <= y) lo = mid + 1
    else hi = mid
  }
  return Math.max(1, Math.min(lo, pageOffsets.length))
}

export function estimatePageMemory(w, h, scale, dpr) {
  const physW = w * scale * dpr
  const physH = h * scale * dpr
  const clampFactor = Math.min(1, MAX_DIM / Math.max(physW, physH))
  const finalW = physW * clampFactor
  const finalH = physH * clampFactor
  return finalW * finalH * 4
}

export function computePdfEffectiveScale({ zoom, containerWidth, containerHeight, baseSizes }) {
  const sizes = Array.isArray(baseSizes) ? baseSizes : []
  const z = zoom || { mode: 'fit-width', value: 1 }

  if ((z.mode === 'fit-width' || z.mode === 'fit-page') && sizes.length === 0) return 1

  if (z.mode === 'fit-width') {
    const maxW = Math.max(...sizes.map((s) => s.w))
    return maxW > 0 && containerWidth > 0 ? containerWidth / maxW : 1
  }

  if (z.mode === 'fit-page') {
    const maxW = Math.max(...sizes.map((s) => s.w))
    const maxH = Math.max(...sizes.map((s) => s.h))
    if (maxW <= 0 || maxH <= 0 || containerWidth <= 0 || containerHeight <= 0) return 1
    return Math.min(containerWidth / maxW, containerHeight / maxH)
  }

  return typeof z.value === 'number' ? z.value / 100 : 1
}

// 池预算按"实际即将进入池的页尺寸"逐页累加，不用全书平均值。
// 原因：spec §3.1 阈值是"单页 > 64MB / 池总和 > 256MB"，混合 A4/A3 + 单个超大扫描页时
// 平均值会掩盖单页超阈，降级机制失效。
//
// 单页内存按"理论需求"估算（base*scale*dpr*4，不应用 MAX_DIM clamp）：
// clamp 仅是渲染层 GPU 上限的安全网，最终 canvas 至多 4096×4096×4=64MB，
// 若 computePoolRadius 也用 clamp 后的值判断，单页阈值（>64MB / >128MB）将永不触发，
// 算法的"单页降级"分支变死代码。用未 clamp 的理论值才能让降级在用户意图渲染高分辨率页时触发。
export function computePoolRadius(baseSizes, scale, dpr, centerPage, pageCount) {
  if (baseSizes.length === 0) return DEFAULT_POOL_RADIUS
  const center = Math.max(1, Math.min(centerPage, pageCount))
  let totalBytes = 0
  let allowedRadius = DEFAULT_POOL_RADIUS

  for (let r = 0; r <= DEFAULT_POOL_RADIUS; r++) {
    const candidates = r === 0 ? [center] : [center - r, center + r]
    for (const pageNum of candidates) {
      if (pageNum < 1 || pageNum > pageCount) continue
      const idx = pageNum - 1
      if (idx >= baseSizes.length) continue
      const { w, h } = baseSizes[idx]
      const physW = w * scale * dpr
      const physH = h * scale * dpr
      const perPage = physW * physH * 4
      totalBytes += perPage

      if (perPage > MEM_TIER2) {
        return Math.min(allowedRadius, 0)
      }
      if (perPage > MEM_TIER1 || totalBytes > POOL_TIER2_TOTAL) {
        allowedRadius = Math.min(allowedRadius, Math.max(0, r - 1, 1))
        if (allowedRadius <= 1) return 1
      } else if (totalBytes > POOL_TIER1_TOTAL) {
        allowedRadius = Math.min(allowedRadius, Math.max(0, r - 1, 2))
      }
    }
  }
  return allowedRadius
}

export function usePdfRenderer(pdfDoc, pageCountRef, zoomRef, containerRef) {
  const baseSizes = shallowRef([])
  const pageOffsets = shallowRef([])
  const resolvedBaseSizePageCount = ref(0)
  const currentPage = ref(1)
  const totalHeight = ref(0)
  const layoutScale = ref(1)
  const renderedPages = ref(new Set())

  let renderTasks = new Map()
  let rafId = null
  let collectCancelled = false

  // 两阶段采集（spec §3.1.1）：阶段 1 用第 1 页尺寸快速填充占位，阶段 2 后台增量真实采集。
  async function collectBaseSizes() {
    if (!pdfDoc.value) return
    collectCancelled = false
    resolvedBaseSizePageCount.value = 0
    const doc = pdfDoc.value
    const count = pageCountRef.value

    // 阶段 1：首页立即采集 + 临时占位
    let firstPage
    try {
      firstPage = await doc.getPage(1)
    } catch (err) {
      console.error('首页元数据采集失败:', err)
      throw new Error('PDF 元数据读取失败')
    }
    if (collectCancelled || pdfDoc.value !== doc) {
      firstPage.cleanup()
      return
    }
    const firstVp = firstPage.getViewport({ scale: 1 })
    firstPage.cleanup()
    const tempSize = { w: firstVp.width, h: firstVp.height }
    baseSizes.value = Array.from({ length: count }, () => ({ ...tempSize }))
    resolvedBaseSizePageCount.value = count > 0 ? 1 : 0
    recomputeOffsets()

    // 阶段 2：后台增量真实采集（2-N 页），不阻塞调用方
    Promise.resolve().then(async () => {
      for (let i = 2; i <= count; i++) {
        if (collectCancelled || pdfDoc.value !== doc) return
        let page
        try {
          page = await doc.getPage(i)
        } catch (err) {
          console.error(`页面 ${i} 元数据采集失败:`, err)
          resolvedBaseSizePageCount.value = Math.max(resolvedBaseSizePageCount.value, i)
          recomputeOffsets()
          continue
        }
        if (collectCancelled || pdfDoc.value !== doc) {
          page.cleanup()
          return
        }
        const vp = page.getViewport({ scale: 1 })
        page.cleanup()
        baseSizes.value[i - 1] = { w: vp.width, h: vp.height }
        resolvedBaseSizePageCount.value = Math.max(resolvedBaseSizePageCount.value, i)
        recomputeOffsets()
      }
    })
  }

  function cancelCollect() {
    collectCancelled = true
  }

  function recomputeOffsets() {
    const scale = effectiveScale()
    layoutScale.value = scale
    const offsets = computePageOffsets(baseSizes.value, scale)
    pageOffsets.value = offsets
    if (offsets.length > 0 && baseSizes.value.length > 0) {
      const lastIdx = baseSizes.value.length - 1
      totalHeight.value = offsets[lastIdx] + Math.round(baseSizes.value[lastIdx].h * scale)
    }
  }

  function effectiveScale() {
    return computePdfEffectiveScale({
      zoom: zoomRef.value,
      containerWidth: containerRef.value?.clientWidth || 0,
      containerHeight: containerRef.value?.clientHeight || 0,
      baseSizes: baseSizes.value
    })
  }

  function updateCurrentPage() {
    if (!containerRef.value || pageOffsets.value.length === 0) return
    const scrollTop = containerRef.value.scrollTop
    const viewportH = containerRef.value.clientHeight
    currentPage.value = findCurrentPage(pageOffsets.value, scrollTop, viewportH)
  }

  function getPoolRange() {
    const dpr = window.devicePixelRatio || 1
    const radius = computePoolRadius(
      baseSizes.value,
      effectiveScale(),
      dpr,
      currentPage.value,
      pageCountRef.value
    )
    const center = currentPage.value
    const start = Math.max(1, center - radius)
    const end = Math.min(pageCountRef.value, center + radius)
    return { start, end }
  }

  async function renderPage(pageNum, canvas) {
    if (!pdfDoc.value) return
    const page = await pdfDoc.value.getPage(pageNum)
    const scale = effectiveScale()
    const dpr = window.devicePixelRatio || 1

    const base = page.getViewport({ scale: 1 })

    const targetW = base.width * scale * dpr
    const targetH = base.height * scale * dpr
    const clampFactor = Math.min(1, MAX_DIM / Math.max(targetW, targetH))
    const renderScale = scale * dpr * clampFactor

    const viewport = page.getViewport({ scale: renderScale })

    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    canvas.style.width = `${Math.floor(base.width * scale)}px`
    canvas.style.height = `${Math.floor(base.height * scale)}px`

    const ctx = canvas.getContext('2d')
    const renderTask = page.render({ canvasContext: ctx, viewport })

    renderTasks.set(pageNum, renderTask)
    try {
      await renderTask.promise
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') throw e
    } finally {
      renderTasks.delete(pageNum)
    }
  }

  function cancelPage(pageNum) {
    const task = renderTasks.get(pageNum)
    if (task) {
      task.cancel()
      renderTasks.delete(pageNum)
    }
  }

  function cancelAll() {
    for (const [, task] of renderTasks) {
      task.cancel()
    }
    renderTasks.clear()
  }

  function onScroll() {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      updateCurrentPage()
    })
  }

  function goToPage(n) {
    if (!containerRef.value || pageOffsets.value.length === 0) return
    const idx = Math.max(0, Math.min(n - 1, pageOffsets.value.length - 1))
    containerRef.value.scrollTop = pageOffsets.value[idx]
    updateCurrentPage()
  }

  function cleanup() {
    cancelCollect()
    cancelAll()
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return {
    baseSizes,
    pageOffsets,
    resolvedBaseSizePageCount,
    currentPage,
    totalHeight,
    layoutScale,
    renderedPages,
    collectBaseSizes,
    recomputeOffsets,
    effectiveScale,
    updateCurrentPage,
    getPoolRange,
    renderPage,
    cancelPage,
    cancelAll,
    cancelCollect,
    onScroll,
    goToPage,
    cleanup
  }
}
