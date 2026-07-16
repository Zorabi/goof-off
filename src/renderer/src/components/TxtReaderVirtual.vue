<script setup>
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  onBeforeUpdate,
  onUpdated,
  nextTick,
  watch
} from 'vue'
import { splitParagraphByHits } from '../composables/txtSearchCore.js'
import { useAppState } from '../composables/useAppState.js'
import { injectTxt } from '../composables/useTxt.js'
import { registerActiveReaderFlush } from '../composables/useActiveReaderFlush.js'
import { injectTxtReaderController } from '../composables/useTxtReaderController.js'
import { injectTxtSearch } from '../composables/useTxtSearch.js'
import { useTxtParagraphs } from '../composables/useTxtParagraphs.js'
import { createKeydownHandler } from '../composables/useTxtKeyboard.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import { fontFamilyCss } from '../constants/fontFamilyOptions.js'
import { shouldDiscardMaintenanceProgress } from '../composables/useMaintenanceReset.js'
import {
  createVirtualScrollState,
  buildPrefixSums,
  findVisibleRange,
  computeSpacers,
  findIndexAtOffset
} from '../composables/useVirtualScroll.js'

const txt = injectTxt()
const ctrl = injectTxtReaderController()
const search = injectTxtSearch()
const { state } = useAppState()

const containerRef = ref(null)
const contentRef = ref(null)
const isRestoring = ref(true)
let mountedFileId = txt.fileId.value
let unregisterActiveFlush = null
let jumpSeq = 0
const PAGE_OVERLAP = 36
const BUFFER_COUNT = 30
const DEFAULT_CONTENT_WIDTH = 592
const MIN_AVERAGE_CHAR_WIDTH = 4

const { paragraphs } = useTxtParagraphs(txt)
const { txtPrefs } = useReaderPrefs()
const contentStyle = computed(() => {
  const style = {
    fontSize: `${txtPrefs.value.fontSize || 16}px`,
    lineHeight: String(txtPrefs.value.lineHeight || 1.7)
  }
  const fontFamily = fontFamilyCss(txtPrefs.value.fontFamily)
  if (fontFamily) style.fontFamily = fontFamily
  return style
})

function searchSegments(para) {
  if (!search?.active.value) return [{ text: para.text || ' ', highlighted: false, current: false }]
  return splitParagraphByHits(
    para,
    search.hits.value,
    search.queryLength.value,
    search.currentHitOffset.value
  )
}

const fontSize = ref(16)
const lineHeight = ref(1.7)
const charsPerLine = ref(30)
const verticalPadding = ref(32)
const contentPaddingTop = ref(16)

const vs = createVirtualScrollState({
  paragraphs,
  fontSize,
  lineHeight,
  charsPerLine
})

const scrollTop = ref(0)
const viewportHeight = ref(0)

const visibleRange = computed(() => {
  if (!paragraphs.value.length || !vs.treeRef.value) return { startIndex: 0, endIndex: 0 }
  return findVisibleRange(vs.treeRef.value, scrollTop.value, viewportHeight.value, BUFFER_COUNT)
})

const renderedParagraphs = computed(() => {
  const { startIndex, endIndex } = visibleRange.value
  return paragraphs.value
    .slice(startIndex, endIndex)
    .map((p, i) => ({ ...p, _index: startIndex + i }))
})

const spacers = computed(() => {
  if (!vs.treeRef.value) return { topSpacer: 0, bottomSpacer: 0 }
  const { startIndex, endIndex } = visibleRange.value
  return computeSpacers(vs.treeRef.value, startIndex, endIndex)
})

const totalHeight = computed(() => {
  return vs.treeRef.value ? vs.treeRef.value.total() : 0
})

const paginationTotalHeight = computed(() => vs.estimatedTotalHeight.value + verticalPadding.value)
const measuredScrollHeight = computed(() => totalHeight.value + verticalPadding.value)
const estimatedPrefixSums = computed(() => buildPrefixSums(vs.estimatedHeights.value))

let measureCanvas = null

function toCssNumber(value, fallback = 0) {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

function getMeasureContext() {
  if (typeof document === 'undefined' || !document.createElement) return null
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  try {
    return measureCanvas.getContext?.('2d') || null
  } catch {
    return null
  }
}

function estimateAverageCharWidth(style, fallback) {
  const ctx = getMeasureContext()
  if (!ctx) return Math.max(MIN_AVERAGE_CHAR_WIDTH, fallback)

  const fontStyle = style.fontStyle || 'normal'
  const fontVariant = style.fontVariant || 'normal'
  const fontWeight = style.fontWeight || '400'
  const fontSizeText = style.fontSize || `${fallback}px`
  const fontFamily = style.fontFamily || 'sans-serif'
  ctx.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSizeText} ${fontFamily}`

  const raw = (txt.text.value || '').slice(0, 2000)
  const sample = raw.replace(/\s+/g, '').slice(0, 1200) || '汉字Abc123'
  const width = ctx.measureText(sample).width
  const average = width / sample.length
  return Math.max(MIN_AVERAGE_CHAR_WIDTH, average || fallback)
}

function updateTextMetrics() {
  if (!contentRef.value) return
  const style = getComputedStyle(contentRef.value)
  const paddingLeft = toCssNumber(style.paddingLeft)
  const paddingRight = toCssNumber(style.paddingRight)
  const paddingTop = toCssNumber(style.paddingTop)
  const paddingBottom = toCssNumber(style.paddingBottom)
  const width =
    contentRef.value.clientWidth ||
    Math.min(containerRef.value?.clientWidth || DEFAULT_CONTENT_WIDTH, DEFAULT_CONTENT_WIDTH)
  const innerWidth = Math.max(1, width - paddingLeft - paddingRight)
  const nextFontSize = toCssNumber(style.fontSize, 16)
  const lineHeightPx = toCssNumber(style.lineHeight, nextFontSize * 1.7)
  const averageCharWidth = estimateAverageCharWidth(style, nextFontSize)

  fontSize.value = nextFontSize
  lineHeight.value = lineHeightPx > 0 ? lineHeightPx / nextFontSize : 1.7
  charsPerLine.value = Math.max(1, Math.floor(innerWidth / averageCharWidth))
  verticalPadding.value = paddingTop + paddingBottom
  contentPaddingTop.value = paddingTop
}

function logicalMaxScroll() {
  return Math.max(0, paginationTotalHeight.value - viewportHeight.value)
}

function physicalMaxScroll() {
  if (!containerRef.value) {
    return Math.max(0, measuredScrollHeight.value - viewportHeight.value)
  }
  return Math.max(
    0,
    containerRef.value.scrollHeight - containerRef.value.clientHeight,
    measuredScrollHeight.value - viewportHeight.value
  )
}

function pageStep() {
  if (!containerRef.value) return 400
  const height = viewportHeight.value || containerRef.value.clientHeight || 400
  return Math.max(1, height - PAGE_OVERLAP)
}

function nextPage() {
  if (!containerRef.value) return false
  const el = containerRef.value
  const maxScroll = physicalMaxScroll()
  if (el.scrollTop >= maxScroll - 1) return false
  el.scrollBy({ top: pageStep(), behavior: 'smooth' })
  return true
}

function prevPage() {
  if (!containerRef.value) return false
  if (containerRef.value.scrollTop <= 1) return false
  containerRef.value.scrollBy({ top: -pageStep(), behavior: 'smooth' })
  return true
}

function findIndexAtLogicalTop(targetTop) {
  const sums = estimatedPrefixSums.value
  const total = sums.length - 1
  if (total <= 0) return 0
  let lo = 0
  let hi = total - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sums[mid] <= targetTop) lo = mid
    else hi = mid - 1
  }
  return lo
}

async function jumpToLogicalTop(targetTop) {
  if (!paragraphs.value.length) return
  const seq = ++jumpSeq
  const idx = findIndexAtLogicalTop(Math.max(0, targetTop))
  const para = paragraphs.value[idx]
  if (!para) return
  const paraTop = estimatedPrefixSums.value[idx] || 0
  const paraHeight = vs.estimatedHeights.value[idx] || 1
  const ratio = Math.max(0, Math.min(1, (targetTop - paraTop) / paraHeight))
  txt.offset.value = para.charOffset
  txt.intraBlockRatio.value = ratio
  scrollToOffset(para.charOffset, ratio)
  await new Promise((r) => requestAnimationFrame(r))
  await nextTick()
  if (jumpSeq !== seq) return
  scrollToOffset(para.charOffset, ratio)
}

function goToPage(n) {
  if (!containerRef.value) return
  const pageCount = ctrl.pageCount.value
  const page = Math.max(1, Math.min(n, pageCount))
  if (page >= pageCount) {
    containerRef.value.scrollTop = Math.max(logicalMaxScroll(), physicalMaxScroll())
    const lastPara = paragraphs.value.at(-1)
    txt.offset.value = lastPara ? lastPara.charOffset : txt.text.value.length
    txt.intraBlockRatio.value = 1
    syncAfterProgrammaticScroll({ updateOffset: false })
    return
  }
  const targetTop = Math.max(0, (page - 1) * pageStep() - contentPaddingTop.value)
  jumpToLogicalTop(targetTop)
}

function jumpToPercent(p) {
  if (!containerRef.value) return
  const ratio = Math.max(0, Math.min(1, p))
  if (ratio >= 1) {
    containerRef.value.scrollTop = Math.max(logicalMaxScroll(), physicalMaxScroll())
    const lastPara = paragraphs.value.at(-1)
    txt.offset.value = lastPara ? lastPara.charOffset : txt.text.value.length
    txt.intraBlockRatio.value = 1
    syncAfterProgrammaticScroll({ updateOffset: false })
    return
  }
  const totalContent = vs.estimatedTotalHeight.value
  if (totalContent <= 0) return
  jumpToLogicalTop(ratio * totalContent)
}

function topContextPx(options) {
  const lines = Number(options?.topContextLines) || 0
  if (lines <= 0) return 0
  return fontSize.value * lineHeight.value * lines
}

function scrollToOffset(charOffset, ratio = 0, options = {}) {
  if (!containerRef.value || !paragraphs.value.length || !vs.treeRef.value) return
  const idx = findIndexAtOffset(paragraphs.value, charOffset)
  let target = contentPaddingTop.value + vs.treeRef.value.prefixSum(idx)
  if (ratio > 0) {
    const h = vs.effectiveHeights.value[idx]
    target += ratio * h
  }
  containerRef.value.scrollTop = Math.max(0, target - topContextPx(options))
  txt.offset.value = charOffset
  txt.intraBlockRatio.value = ratio
  syncAfterProgrammaticScroll({ updateOffset: false })
}

// ========== 滚动 / 测量 ==========
let scrollRaf = null
let savePosThrottle = null

function onScroll() {
  if (!containerRef.value) return
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null
    if (!containerRef.value) return
    scrollTop.value = containerRef.value.scrollTop
    if (!isRestoring.value) {
      updateOffsetFromRendered()
      updatePageInfo()
    }
    if (!isRestoring.value && !savePosThrottle) {
      savePosThrottle = setTimeout(() => {
        savePosThrottle = null
        saveMountedPosition()
      }, 1000)
    }
  })
}

function updateOffsetFromRendered() {
  if (!containerRef.value) return
  const containerRect = containerRef.value.getBoundingClientRect()
  const items = containerRef.value.querySelectorAll('[data-char-offset]')
  let bestOffset = txt.offset.value
  let bestTop = Infinity
  for (const el of items) {
    const rect = el.getBoundingClientRect()
    if (rect.top >= containerRect.top - 1 && rect.top < bestTop) {
      bestTop = rect.top
      bestOffset = parseInt(el.dataset.charOffset, 10)
      const isOversize = el.offsetHeight > containerRef.value.clientHeight * 2
      txt.intraBlockRatio.value = isOversize
        ? (containerRef.value.scrollTop - el.offsetTop) / el.offsetHeight
        : 0
    }
  }
  txt.offset.value = bestOffset
}

function updatePageInfo() {
  if (!containerRef.value) return
  const step = pageStep()
  const pageCount = Math.max(1, Math.ceil(paginationTotalHeight.value / step))
  ctrl.pageCount.value = pageCount

  const atEnd = containerRef.value.scrollTop >= physicalMaxScroll() - 1
  if (atEnd) {
    ctrl.currentPage.value = pageCount
    return
  }

  if (!paragraphs.value.length) {
    ctrl.currentPage.value = 1
    return
  }
  const idx = findIndexAtOffset(paragraphs.value, txt.offset.value)
  const paraTop = estimatedPrefixSums.value[idx] || 0
  const paraHeight = vs.estimatedHeights.value[idx] || 0
  const logicalTop =
    contentPaddingTop.value + paraTop + paraHeight * (txt.intraBlockRatio.value || 0)
  ctrl.currentPage.value = Math.max(1, Math.min(pageCount, Math.floor(logicalTop / step) + 1))
}

function syncAfterProgrammaticScroll({ updateOffset = true } = {}) {
  if (!containerRef.value) return
  scrollTop.value = containerRef.value.scrollTop
  if (updateOffset) updateOffsetFromRendered()
  updatePageInfo()
}

// ========== 段落 ResizeObserver ==========
let paraRO = null

function observeNewParas() {
  if (!paraRO || !containerRef.value) return
  const items = containerRef.value.querySelectorAll('[data-char-offset]')
  items.forEach((el) => paraRO.observe(el))
}

onBeforeUpdate(() => {
  paraRO?.disconnect()
})

onUpdated(() => {
  observeNewParas()
})

function saveMountedPosition() {
  if (shouldDiscardMaintenanceProgress()) return
  if (txt.fileId.value !== mountedFileId) return
  txt.savePosition()
}

// ========== 键盘 ==========
const onKeydown = createKeydownHandler(ctrl, {
  nextPage,
  prevPage,
  goToTop: () => {
    if (!containerRef.value) return
    containerRef.value.scrollTop = 0
    txt.offset.value = 0
    txt.intraBlockRatio.value = 0
    syncAfterProgrammaticScroll({ updateOffset: false })
  },
  goToEnd: () => {
    if (!containerRef.value) return
    containerRef.value.scrollTop = containerRef.value.scrollHeight
    const lastPara = paragraphs.value.at(-1)
    txt.offset.value = lastPara ? lastPara.charOffset : txt.text.value.length
    txt.intraBlockRatio.value = 1
    syncAfterProgrammaticScroll({ updateOffset: false })
  },
  pageKeys: computed(() => txtPrefs.value.pageKeys || { next: 'Space', prev: 'Shift+Space' }),
  isMini: computed(() => state.form === 'mini')
})

// ========== 容器 RO ==========
let containerRO = null

// ========== 进度恢复 ==========
async function restoreAndCalibrate() {
  await txt.restoreProgress()
  scrollTop.value = 0
  await nextTick()
  updateTextMetrics()
  scrollToOffset(txt.offset.value, txt.intraBlockRatio.value)
  await new Promise((r) => requestAnimationFrame(r))
  await nextTick()
  scrollToOffset(txt.offset.value, txt.intraBlockRatio.value)
  scrollTop.value = containerRef.value?.scrollTop || 0
  updatePageInfo()
  isRestoring.value = false
}

// ========== watch text 重置 ==========
watch(paragraphs, async () => {
  if (!containerRef.value) return
  containerRef.value.scrollTop = 0
  scrollTop.value = 0
  await nextTick()
  updateTextMetrics()
  updatePageInfo()
})

watch(
  () => [txtPrefs.value.fontSize, txtPrefs.value.lineHeight, txtPrefs.value.fontFamily],
  async () => {
    if (!containerRef.value) return
    const offset = txt.offset.value
    const ratio = txt.intraBlockRatio.value
    await nextTick()
    updateTextMetrics()
    await nextTick()
    scrollToOffset(offset, ratio)
    scrollTop.value = containerRef.value.scrollTop
    updatePageInfo()
  }
)

onMounted(async () => {
  mountedFileId = txt.fileId.value
  await nextTick()
  viewportHeight.value = containerRef.value.clientHeight
  updateTextMetrics()

  paraRO = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const charOff = parseInt(entry.target.dataset?.charOffset, 10)
      if (isNaN(charOff)) continue
      const idx = findIndexAtOffset(paragraphs.value, charOff)
      const h = entry.contentRect.height
      vs.updateMeasuredHeight(idx, h)
    }
  })

  containerRO = new ResizeObserver(() => {
    if (!containerRef.value) return
    viewportHeight.value = containerRef.value.clientHeight
    updateTextMetrics()
    updatePageInfo()
  })
  containerRO.observe(containerRef.value)

  ctrl.register({ nextPage, prevPage, goToPage, jumpToPercent, scrollToOffset })
  unregisterActiveFlush = registerActiveReaderFlush(txt.flushCurrentProgress)
  document.addEventListener('keydown', onKeydown)

  await restoreAndCalibrate()
  observeNewParas()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  unregisterActiveFlush?.()
  ctrl.unregister()
  saveMountedPosition()
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
  if (savePosThrottle) clearTimeout(savePosThrottle)
  if (paraRO) paraRO.disconnect()
  if (containerRO) containerRO.disconnect()
})
</script>

<template>
  <div
    ref="containerRef"
    class="txt-reader"
    :style="{ visibility: isRestoring ? 'hidden' : 'visible' }"
    @scroll.passive="onScroll"
  >
    <div v-if="!txt.text.value" class="txt-empty">文件为空</div>
    <div v-else ref="contentRef" class="txt-content" :style="contentStyle">
      <div :style="{ height: spacers.topSpacer + 'px' }" />
      <p
        v-for="para in renderedParagraphs"
        :key="para._index"
        :data-char-offset="para.charOffset"
        class="txt-para"
      >
        <template v-for="(seg, segIndex) in searchSegments(para)" :key="segIndex">
          <mark v-if="seg.highlighted" class="txt-search-mark" :class="{ current: seg.current }">
            {{ seg.text }}
          </mark>
          <template v-else>{{ seg.text }}</template>
        </template>
      </p>
      <div :style="{ height: spacers.bottomSpacer + 'px' }" />
    </div>
  </div>
</template>

<style scoped>
.txt-reader {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  animation: reader-fade-in var(--motion-content) ease;
}
.txt-reader::-webkit-scrollbar {
  display: none;
}

.txt-content {
  max-width: 640px;
  margin: 0 auto;
  padding: 56px 24px 60px;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: var(--file-text-color, var(--text-primary));
  -webkit-font-smoothing: antialiased;
}

.txt-reader ::selection {
  background: var(--selection-bg, var(--selection-bg-fallback, rgba(128, 128, 128, 0.18)));
  color: inherit;
  text-shadow: var(--selection-text-shadow, none);
}

@supports (background: color-mix(in srgb, black 10%, transparent)) {
  .txt-reader ::selection {
    background: var(--selection-bg-enhanced, color-mix(in srgb, currentColor 18%, transparent));
  }
}

.txt-para {
  margin: 0;
  padding: 0;
  min-height: 1em;
}
.txt-search-mark {
  background: var(--color-search-hit-bg);
  color: inherit;
  border-radius: 2px;
}
.txt-search-mark.current {
  background: var(--color-search-hit-current-bg);
}
.txt-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: 14px;
}
@keyframes reader-fade-in {
  from {
    opacity: 0;
  }
}
</style>
