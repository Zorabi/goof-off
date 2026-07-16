<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
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

const txt = injectTxt()
const ctrl = injectTxtReaderController()
const search = injectTxtSearch()
const { state } = useAppState()
const containerRef = ref(null)
const isRestoring = ref(true)
let mountedFileId = txt.fileId.value
let unregisterActiveFlush = null

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

const searchSegmentsByOffset = computed(() => {
  const map = new Map()
  if (!search?.active.value) return map
  const hits = search.hits.value
  const queryLength = search.queryLength.value
  const currentHitOffset = search.currentHitOffset.value
  for (const para of paragraphs.value) {
    map.set(para.charOffset, splitParagraphByHits(para, hits, queryLength, currentHitOffset))
  }
  return map
})

function searchSegments(para) {
  return (
    searchSegmentsByOffset.value.get(para.charOffset) || [
      { text: para.text || ' ', highlighted: false, current: false }
    ]
  )
}

const PAGE_OVERLAP = 36

function pageStep() {
  if (!containerRef.value) return 400
  return Math.max(1, containerRef.value.clientHeight - PAGE_OVERLAP)
}

function nextPage() {
  if (!containerRef.value) return false
  const el = containerRef.value
  const maxScroll = el.scrollHeight - el.clientHeight
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

function goToTop() {
  if (!containerRef.value) return
  containerRef.value.scrollTop = 0
  syncAfterProgrammaticScroll()
}

function goToEnd() {
  if (!containerRef.value) return
  containerRef.value.scrollTop = containerRef.value.scrollHeight
  syncAfterProgrammaticScroll()
}

function goToPage(n) {
  if (!containerRef.value) return
  const el = containerRef.value
  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  const page = Math.max(1, Math.min(n, ctrl.pageCount.value))
  const target = Math.max(0, Math.min(maxScroll, (page - 1) * pageStep()))
  el.scrollTop = target
  syncAfterProgrammaticScroll()
}

function jumpToPercent(p) {
  if (!containerRef.value) return
  const el = containerRef.value
  const max = el.scrollHeight - el.clientHeight
  el.scrollTop = Math.max(0, Math.min(1, p)) * max
  syncAfterProgrammaticScroll()
}

function resolveLineHeightPx() {
  const content = containerRef.value?.querySelector('.txt-content')
  const style = content ? getComputedStyle(content) : null
  const fontSize = parseFloat(style?.fontSize) || txtPrefs.value.fontSize || 16
  const lineHeight = parseFloat(style?.lineHeight)
  if (Number.isFinite(lineHeight)) {
    return lineHeight <= 4 ? fontSize * lineHeight : lineHeight
  }
  return fontSize * (txtPrefs.value.lineHeight || 1.7)
}

function topContextPx(options) {
  const lines = Number(options?.topContextLines) || 0
  if (lines <= 0) return 0
  return resolveLineHeightPx() * lines
}

function scrollToOffset(charOffset, ratio = 0, options = {}) {
  if (!containerRef.value) return
  const el = containerRef.value
  const target = el.querySelector(`[data-char-offset="${charOffset}"]`)
  if (target) {
    const targetTop = target.offsetTop + ratio * target.offsetHeight
    el.scrollTop = Math.max(0, targetTop - topContextPx(options))
    syncAfterProgrammaticScroll()
  }
}

// ========== IntersectionObserver ==========
const visibleEntries = new Map()
let io = null

function setupObserver() {
  if (!containerRef.value) return
  if (io) io.disconnect()
  visibleEntries.clear()
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visibleEntries.set(e.target, e)
        else visibleEntries.delete(e.target)
      }
    },
    { root: containerRef.value, threshold: 0 }
  )
  containerRef.value.querySelectorAll('[data-char-offset]').forEach((el) => io.observe(el))
}

function updateOffsetFromVisible() {
  if (!containerRef.value || visibleEntries.size === 0) return
  const containerRect = containerRef.value.getBoundingClientRect()
  let bestOffset = txt.offset.value
  let bestTop = Infinity
  for (const el of visibleEntries.keys()) {
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

// ========== ResizeObserver + 页码 ==========
let ro = null

function updatePageInfo() {
  if (!containerRef.value) return
  const step = pageStep()
  ctrl.currentPage.value = Math.floor(containerRef.value.scrollTop / step) + 1
  ctrl.pageCount.value = Math.max(1, Math.ceil(containerRef.value.scrollHeight / step))
}

function syncAfterProgrammaticScroll() {
  updateOffsetFromRendered()
  updatePageInfo()
}

// ========== 滚动 / 键盘 ==========
let scrollThrottle = null
function saveMountedPosition() {
  if (shouldDiscardMaintenanceProgress()) return
  if (txt.fileId.value !== mountedFileId) return
  txt.savePosition()
}

function onScroll() {
  if (isRestoring.value) return
  updateOffsetFromVisible()
  updatePageInfo()
  if (scrollThrottle) return
  scrollThrottle = setTimeout(() => {
    scrollThrottle = null
    saveMountedPosition()
  }, 1000)
}

const onKeydown = createKeydownHandler(ctrl, {
  nextPage,
  prevPage,
  goToTop,
  goToEnd,
  pageKeys: computed(() => txtPrefs.value.pageKeys || { next: 'Space', prev: 'Shift+Space' }),
  isMini: computed(() => state.form === 'mini')
})

// ========== 监听 text / font 变化 ==========
watch(
  () => txt.text.value,
  async () => {
    await nextTick()
    setupObserver()
    updatePageInfo()
  }
)

watch(
  () => [txtPrefs.value.fontSize, txtPrefs.value.lineHeight, txtPrefs.value.fontFamily],
  async () => {
    const offset = txt.offset.value
    const ratio = txt.intraBlockRatio.value
    await nextTick()
    setupObserver()
    scrollToOffset(offset, ratio)
    updatePageInfo()
  }
)

onMounted(async () => {
  mountedFileId = txt.fileId.value
  await nextTick()
  await txt.restoreProgress()
  setupObserver()
  await nextTick()
  scrollToOffset(txt.offset.value, txt.intraBlockRatio.value)
  updatePageInfo()
  isRestoring.value = false

  ro = new ResizeObserver(() => updatePageInfo())
  ro.observe(containerRef.value)

  ctrl.register({ nextPage, prevPage, goToPage, jumpToPercent, scrollToOffset })
  unregisterActiveFlush = registerActiveReaderFlush(txt.flushCurrentProgress)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  unregisterActiveFlush?.()
  ctrl.unregister()
  saveMountedPosition()
  if (scrollThrottle) {
    clearTimeout(scrollThrottle)
    scrollThrottle = null
  }
  if (io) {
    io.disconnect()
    io = null
  }
  if (ro) {
    ro.disconnect()
    ro = null
  }
  visibleEntries.clear()
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
    <div v-else class="txt-content" :style="contentStyle">
      <p
        v-for="(para, i) in paragraphs"
        :key="i"
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
