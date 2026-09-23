<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { injectEpub } from '../composables/useEpub.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import { injectEpubSearch } from '../composables/useEpubSearch.js'
import { useEpubAutoTurn } from '../composables/useEpubAutoTurn.js'
import { useEpubKeyboard } from '../composables/useEpubKeyboard.js'
import { pushStatus } from '../composables/usePageMessages.js'
import { registerActiveReaderFlush } from '../composables/useActiveReaderFlush.js'
import { bootstrapReaderPrefs, useReaderPrefs } from '../composables/useReaderPrefs.js'
import { injectTrackpadGesture } from '../composables/useTrackpadGesture.js'
import { shouldDiscardMaintenanceProgress } from '../composables/useMaintenanceReset.js'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import {
  createAutoTurnChromePauseController,
  shouldPauseAutoTurnForChromeLocks
} from '../composables/useAutoTurnChromePause.js'
import { fontFamilyCss } from '../constants/fontFamilyOptions.js'
import {
  applySearchHighlights,
  clearSearchHighlights,
  injectSearchHighlightStyle
} from '../composables/epubSearchHighlight.js'
import { collectTextNodes, offsetFromDomPosition } from '../composables/epubSearchCore.js'
import {
  createEpubImageLayoutSettler,
  syncEpubImageVisibility
} from '../composables/epubImageVisibility.js'
import {
  canConfirmChapterNavigationLocation,
  hrefForChapterRelocation,
  isChapterNavigationSettled
} from './epubChapterNavigationHelpers.js'
import { findActiveTocItemByViewport } from './epubTocHelpers.js'
import { clampScrollOffset, scrollOffsetForViewportAnchor } from './epubResizeHelpers.js'

const props = defineProps({
  fileVisualState: { type: Object, default: null },
  isMini: { type: Boolean, default: false }
})

const epub = injectEpub()
const ctrl = injectEpubCtrl()
const search = injectEpubSearch()
const trackpadGesture = injectTrackpadGesture()
const chromeLocks = injectChromeLockRegistry()
const { epubPrefs } = useReaderPrefs()
const isDark = ref(document.documentElement.classList.contains('dark'))
let themeUnlisten = null
const EPUB_THEME_NAME = 'goof-off'
const FILE_DRAG_EVENT_TYPES = ['dragenter', 'dragover', 'dragleave', 'drop']

const containerRef = ref(null)
let rendition = null
let resizeObserver = null
let unregisterProgressCollector = null
let unregisterActiveFlush = null
let themeFailureNotified = false
let selectionHookRegistered = false
let searchHighlightHookRegistered = false
let imageVisibilityHookRegistered = false
let imageVisibilityGeneration = 0
let cancelImageLayoutSettlement = null
const trackpadContentCleanups = new Map()
let trackpadHookRegistered = false
const contentPointerCleanups = new Map()
let contentPointerHookRegistered = false
const fileDragContentCleanups = new Map()
let fileDragHookRegistered = false

const autoTurnSec = computed(() => epubPrefs.value.autoTurnSec || 30)
const autoTurn = useEpubAutoTurn({
  intervalSec: autoTurnSec,
  onTick: () => {
    const success = ctrl.guardedNextPage()
    return success !== false
  }
})

watch(
  () => autoTurn.running.value,
  (v) => {
    ctrl.autoTurnRunning.value = v
  },
  { immediate: true, flush: 'sync' }
)
watch(
  () => autoTurn.countdown.value,
  (v) => {
    ctrl.autoTurnCountdown.value = v
  },
  { immediate: true, flush: 'sync' }
)
watch(
  () => autoTurn.paused.value,
  (v) => {
    ctrl.autoTurnPaused.value = v
  },
  { immediate: true, flush: 'sync' }
)

const epubAutoTurnShouldPause = computed(
  () => !props.isMini && shouldPauseAutoTurnForChromeLocks(chromeLocks.bottomLocks.value)
)
const epubAutoTurnChromePause = createAutoTurnChromePauseController(autoTurn)
watch(
  () => [epubAutoTurnShouldPause.value, autoTurn.running.value],
  ([shouldPause]) => {
    epubAutoTurnChromePause.sync(shouldPause)
  },
  { immediate: true }
)

const { attachToRendition } = useEpubKeyboard(ctrl, {
  pageKeys: computed(() => epubPrefs.value.pageKeys || { next: 'Space', prev: 'Shift+Space' }),
  isMini: computed(() => props.isMini)
})

const handleToggleAutoTurn = () => autoTurn.toggle()

function readHostThemeToken(name) {
  if (typeof getComputedStyle !== 'function' || !document?.documentElement) return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
const themeText = computed(() => {
  const fallback = isDark.value ? '#d0d0d0' : '#2a2a2a'
  return readHostThemeToken('--color-text-primary') || fallback
})
const themeAccent = computed(() => {
  const fallback = isDark.value ? '#6ab0f3' : '#1a6bc4'
  return readHostThemeToken('--color-accent') || fallback
})
const hiddenScrollbarRule = 'none !important'
const HIDDEN_SCROLLBAR_CLASS = 'goof-off-epub-scrollbar-hidden'

let saveDebounceTimer = null
let navigationTimeout = null
let chapterNavigationSettleTimer = null
let locationReportTimer = null
let resizeDebounceTimer = null
let resizeLocationSuppressionTimer = null
let resizeGeneration = 0
let suppressResizeLocationReports = false
let guardedResizeManager = null
let guardedResizeHandler = null
let guardedResizeEmitHandler = null
let lastKnownLocation = null
let lastViewportSize = null
let lastAppliedViewportSize = null
let currentChapterTarget = null
let pendingChapterTarget = null
let deferredViewportSize = null
let chapterTextNodeIndexCache = null
let chapterTextNodeIndexGeneration = 0

function getScrollContainer() {
  return rendition?.manager?.container || containerRef.value
}

function canonicalChapterHref(href) {
  if (!href) return ''
  try {
    return epub.book.value?.canonical(href).split('#')[0] || ''
  } catch {
    return String(href).split('#')[0]
  }
}

function canonicalTocHref(href) {
  if (!href) return ''
  try {
    return epub.book.value?.canonical(href) || ''
  } catch {
    return String(href)
  }
}

function tocFragmentTarget(href) {
  const hashIndex = String(href || '').indexOf('#')
  if (hashIndex < 0) return ''
  const fragment = String(href).slice(hashIndex + 1)
  try {
    return `#${decodeURIComponent(fragment)}`
  } catch {
    return `#${fragment}`
  }
}

function visitTocItems(items, visit) {
  for (const item of items) {
    if (visit(item) === false) return false
    if (item.subitems?.length && visitTocItems(item.subitems, visit) === false) return false
  }
  return true
}

function findTocItemByHref(href) {
  const target = canonicalTocHref(href)
  if (!target) return null
  let match = null
  visitTocItems(epub.toc.value, (item) => {
    if (canonicalTocHref(item.href) !== target) return true
    match = item
    return false
  })
  return match
}

function tocItemsForSection(canonicalSectionHref) {
  const matches = []
  visitTocItems(epub.toc.value, (item) => {
    if (canonicalChapterHref(item.href) === canonicalSectionHref) matches.push(item)
    return true
  })
  return matches
}

function sectionForCanonicalHref(canonicalSectionHref) {
  const spine = epub.book.value?.spine
  const items = spine?.spineItems || spine?.items || []
  return (
    items.find(
      (section) =>
        section?.canonical === canonicalSectionHref ||
        canonicalChapterHref(section?.href) === canonicalSectionHref
    ) || null
  )
}

function beginChapterNavigation(href, { awaitsLocationConfirmation = false } = {}) {
  const canonicalHref = canonicalChapterHref(href)
  if (!canonicalHref) return null
  clearTimeout(chapterNavigationSettleTimer)
  const target = {
    href,
    canonicalHref,
    previous: currentChapterTarget,
    awaitsLocationConfirmation,
    layoutAligned: !awaitsLocationConfirmation,
    locationConfirmed: !awaitsLocationConfirmation
  }
  currentChapterTarget = target
  pendingChapterTarget = target
  ctrl.currentChapterHref.value = canonicalHref
  const tocItem = findTocItemByHref(href)
  if (tocItem) {
    ctrl.currentChapterLabel.value = tocItem.label?.trim() || ''
    ctrl.currentTocHref.value = canonicalTocHref(tocItem.href)
  }
  return target
}

function clearPendingChapterNavigation(target) {
  if (pendingChapterTarget !== target) return
  clearTimeout(chapterNavigationSettleTimer)
  pendingChapterTarget = null
  if (currentChapterTarget === target) currentChapterTarget = target?.previous || null
  flushDeferredViewportResize()
}

function settlePendingChapterNavigation(target, { force = false } = {}) {
  if (!target?.awaitsLocationConfirmation || pendingChapterTarget !== target) return false
  if (!force && !isChapterNavigationSettled(target)) return false

  clearTimeout(chapterNavigationSettleTimer)
  pendingChapterTarget = null
  if (target?.awaitsLocationConfirmation) ctrl.isNavigating.value = false
  flushDeferredViewportResize()
  return true
}

function armChapterNavigationSettleTimeout(target) {
  clearTimeout(chapterNavigationSettleTimer)
  chapterNavigationSettleTimer = setTimeout(() => {
    // `display()` 已完成且目标锚点已经对齐；少数不触发 relocated 的 EPUB 仍需
    // 恢复重排能力，但绝不能在旧章节回调到来前提前解除保护。
    settlePendingChapterNavigation(target, { force: true })
  }, 900)
}

function deferViewportResize(size) {
  deferredViewportSize = size
}

function flushDeferredViewportResize() {
  const size = deferredViewportSize
  deferredViewportSize = null
  if (!size) return
  requestAnimationFrame(() => {
    if (!rendition) return
    if (pendingChapterTarget?.awaitsLocationConfirmation) {
      deferViewportResize(size)
      return
    }
    applyViewportResize(size)
  })
}

function adjacentChapterHref(direction) {
  const location = lastKnownLocation || rendition?.location
  const section =
    getSectionForCfi(location?.start?.cfi) ||
    epub.book.value?.spine?.get?.(location?.start?.href) ||
    null
  const adjacent = direction === 'next' ? section?.next?.() : section?.prev?.()
  return adjacent?.href || ''
}

function captureResizeViewportAnchor(container) {
  const manager = rendition?.manager
  const viewportBounds = container.getBoundingClientRect?.()
  if (!manager || !viewportBounds) return null

  // `manager.current()` is the last visible view, which can be the next chapter
  // near a section boundary. Anchor the view intersecting the viewport's top.
  const views = manager.visible?.() || manager.views?.displayed?.() || []
  const candidates = views
    .map((view) => ({
      view,
      iframe: view?.iframe,
      bounds: view?.iframe?.getBoundingClientRect?.()
    }))
    .filter(({ iframe, bounds }) => iframe?.isConnected && Number.isFinite(bounds?.bottom))
    .filter(({ bounds }) => bounds.bottom > viewportBounds.top)
    .sort((left, right) => left.bounds.top - right.bounds.top)
  const selected =
    candidates.find(({ bounds }) => bounds.top <= viewportBounds.top) || candidates[0]
  const iframe = selected?.iframe
  const document = selected?.view?.contents?.document || iframe?.contentDocument
  if (!iframe || !document?.elementFromPoint) return null

  const maxX = iframe.clientWidth - 1
  const maxY = iframe.clientHeight - 1
  if (maxX < 0 || maxY < 0) return null

  const viewportTopInFrame = viewportBounds.top - selected.bounds.top
  const sampleTop = Math.min(maxY, Math.max(0, viewportTopInFrame))
  const xSamples = [0.5, 0.35, 0.65, 0.2, 0.8].map((ratio) =>
    Math.min(maxX, Math.max(0, Math.round(maxX * ratio)))
  )
  const yOffsets = [0, 4, 8, 12, 18, 24, 32, 42, 54, 68, 84, 104, 128]

  for (const offset of yOffsets) {
    const y = Math.min(maxY, sampleTop + offset)
    const textAnchors = []
    for (const x of xSamples) {
      let caretRange = null
      try {
        caretRange = document.caretRangeFromPoint?.(x, y) || null
        if (!caretRange && document.caretPositionFromPoint) {
          const caret = document.caretPositionFromPoint(x, y)
          if (caret) {
            caretRange = document.createRange()
            caretRange.setStart(caret.offsetNode, caret.offset)
            caretRange.collapse(true)
          }
        }
      } catch {
        caretRange = null
      }

      const textNode = caretRange?.startContainer
      const text = textNode?.nodeType === 3 ? textNode.nodeValue || '' : ''
      if (!text.trim()) continue

      const start = Math.min(caretRange.startOffset, text.length - 1)
      let foundAnchor = false
      for (let distance = 0; distance < Math.min(text.length, 24); distance += 1) {
        const offsets = distance === 0 ? [start] : [start + distance, start - distance]
        for (const textOffset of offsets) {
          if (textOffset < 0 || textOffset >= text.length || /\s/.test(text[textOffset])) continue
          const codePoint = text.codePointAt(textOffset)
          const end = Math.min(text.length, textOffset + (codePoint > 0xffff ? 2 : 1))
          const range = document.createRange()
          range.setStart(textNode, textOffset)
          range.setEnd(textNode, end)
          const bounds = range.getBoundingClientRect?.()
          if (!Number.isFinite(bounds?.top) || bounds.height <= 0) continue
          textAnchors.push({ range, bounds })
          foundAnchor = true
          break
        }
        if (foundAnchor) break
      }
    }
    if (textAnchors.length) {
      textAnchors.sort(
        (left, right) =>
          Math.abs(left.bounds.top - viewportTopInFrame) -
          Math.abs(right.bounds.top - viewportTopInFrame)
      )
      return {
        iframe,
        range: textAnchors[0].range,
        inset: viewportTopInFrame - textAnchors[0].bounds.top
      }
    }
  }

  // Image-only pages may not expose a text range. Keep a meaningful content
  // element as a fallback, but never treat html/body as the reading anchor.
  for (const offset of yOffsets) {
    const y = Math.min(maxY, sampleTop + offset)
    for (const x of xSamples) {
      const hit = document.elementFromPoint(x, y)
      const element = hit?.closest?.(
        'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, table, img, figure, svg, canvas, video'
      )
      if (!element?.isConnected) continue
      const bounds = element.getBoundingClientRect?.()
      if (!Number.isFinite(bounds?.top) || bounds.height <= 0) continue
      return { iframe, element, inset: viewportTopInFrame - bounds.top }
    }
  }

  return null
}

function captureResizeScrollPosition() {
  const container = getScrollContainer()
  if (!container || pendingChapterTarget) return null
  return {
    left: container.scrollLeft,
    top: container.scrollTop,
    anchor: captureResizeViewportAnchor(container)
  }
}

function restoreResizeScrollPosition(position) {
  const container = getScrollContainer()
  if (!container || !position) return
  const anchor = position.anchor
  let top = position.top
  if (anchor?.iframe?.isConnected) {
    const viewportBounds = container.getBoundingClientRect?.()
    const iframeBounds = anchor.iframe.getBoundingClientRect?.()
    const anchorIsConnected = anchor.range
      ? anchor.range.startContainer?.isConnected
      : anchor.element?.isConnected
    const anchorBounds = anchorIsConnected
      ? anchor.range?.getBoundingClientRect?.() || anchor.element?.getBoundingClientRect?.()
      : null
    if (
      Number.isFinite(viewportBounds?.top) &&
      Number.isFinite(iframeBounds?.top) &&
      Number.isFinite(anchorBounds?.top)
    ) {
      top = scrollOffsetForViewportAnchor(
        container.scrollTop,
        anchorBounds.top,
        viewportBounds.top - iframeBounds.top,
        anchor.inset
      )
    }
  }
  const left = clampScrollOffset(position.left, container.scrollWidth, container.clientWidth)
  const nextTop = clampScrollOffset(top, container.scrollHeight, container.clientHeight)
  const manager = rendition?.manager
  if (manager?.container === container && typeof manager.scrollTo === 'function') {
    const previousLeft = container.scrollLeft
    const previousTop = container.scrollTop
    manager.scrollTo(left, nextTop, true)
    if (previousLeft === container.scrollLeft && previousTop === container.scrollTop) {
      manager.ignore = false
    }
    return
  }
  container.scrollLeft = left
  container.scrollTop = nextTop
}

function resizeLayoutSignature(manager) {
  const views = manager?.views?.displayed?.() || []
  return views
    .map((view) => {
      const iframe = view?.iframe
      const document = view?.contents?.document || iframe?.contentDocument
      return [
        iframe?.clientWidth || 0,
        iframe?.clientHeight || 0,
        document?.documentElement?.scrollWidth || 0,
        document?.documentElement?.scrollHeight || 0,
        document?.body?.scrollHeight || 0
      ].join(':')
    })
    .join('|')
}

async function waitForResizeLayoutToSettle(manager, activeRendition, generation) {
  let previous = ''
  let stableFrames = 0
  for (let frame = 0; frame < 12; frame += 1) {
    await nextAnimationFrame()
    if (rendition !== activeRendition || generation !== resizeGeneration) return false
    const signature = resizeLayoutSignature(manager)
    if (!signature) return true
    if (signature === previous) {
      stableFrames += 1
      if (stableFrames >= 2) return true
    } else {
      stableFrames = 0
    }
    previous = signature
  }
  return true
}

function reflowManagerWithoutRedisplay(manager, width, height, position) {
  const stageSize = manager?.stage?.size?.(width, height)
  if (!stageSize || !manager?.layout) return

  clearTimeout(locationReportTimer)
  locationReportTimer = null
  // 后续 `currentLocation()` 会再次调用 stage.size()。把本次实际尺寸写回 Stage，
  // 防止它恢复到旧的百分比设置并对已稳定的 iframe 再次重排。
  if (Number.isFinite(width) && width > 0) manager.stage.settings.width = width
  if (Number.isFinite(height) && height > 0) manager.stage.settings.height = height
  manager._stageSize = stageSize
  manager._bounds = manager.bounds?.()
  if (manager.isPaginated) {
    manager.layout.calculate(stageSize.width, stageSize.height, manager.settings?.gap)
    manager.settings.offset = manager.layout.delta / manager.layout.divisor
  } else {
    manager.layout.calculate(stageSize.width, stageSize.height)
  }
  manager.viewSettings.width = manager.layout.width
  manager.viewSettings.height = manager.layout.height
  suppressResizeLocationReports = true
  clearTimeout(resizeLocationSuppressionTimer)
  manager.setLayout(manager.layout)

  const activeRendition = rendition
  const generation = ++resizeGeneration
  void (async () => {
    const settled = await waitForResizeLayoutToSettle(manager, activeRendition, generation)
    if (!settled || rendition !== activeRendition || generation !== resizeGeneration) return
    restoreResizeScrollPosition(position)
    snapToPaginateBoundary()
    // DOM scrolling emitted by reflow is not a new reading position. epub.js
    // turns SCROLLED into reportLocation(), which runs updateLayout() again.
    resizeLocationSuppressionTimer = setTimeout(() => {
      suppressResizeLocationReports = false
      resizeLocationSuppressionTimer = null
    }, 80)
  })()
}

function guardEpubJsResize() {
  const manager = rendition?.manager
  if (!manager) return
  if (manager.emit !== guardedResizeEmitHandler) {
    const emit = manager.emit
    guardedResizeEmitHandler = function (event, ...args) {
      // Rendition 对 manager 的 `resized` 事件会调用 display(旧 CFI)。即使第三方
      // 路径绕过了下方的 resize 覆盖，也不能允许该事件重新触发章节导航。
      if (event === 'resized') return undefined
      if (event === 'scrolled' && suppressResizeLocationReports) return undefined
      return emit.call(this, event, ...args)
    }
    manager.emit = guardedResizeEmitHandler
  }
  if (guardedResizeManager === manager && manager.resize === guardedResizeHandler) return
  guardedResizeManager = manager
  guardedResizeHandler = (width, height) => {
    // epub.js 默认 resize 会 clear() 后再 display(旧 CFI)。resize 必须只重排
    // 已经挂载的 iframe；不能从已改变的几何关系反推 CFI，更不能触发章节导航。
    // 目录跳转尚未收到目标 location 时，当前 iframe 可能仍是上一章；此时只能
    // 等待本组件的 ResizeObserver 在导航落定后重排，不能碰旧视图。
    if (pendingChapterTarget?.awaitsLocationConfirmation) return
    reflowManagerWithoutRedisplay(manager, width, height, captureResizeScrollPosition())
  }
  manager.resize = guardedResizeHandler
}

function disableEpubJsWindowResize() {
  // epub.js 0.3.x 会自行注册一个 window.resize 监听器。它调用 manager.resize()
  // 时不会携带 cfi，随后 rendition 会重新 display 旧的 location.start.cfi。
  // 统一交给下方的 ResizeObserver 驱动；它只重排当前 iframe，不会用 CFI 导航。
  const resizeListener = rendition?.manager?.stage?.resizeFunc
  if (typeof resizeListener !== 'function') return
  window.removeEventListener('resize', resizeListener, false)
  resizeListener.cancel?.()
}

function hideScrollbar(el) {
  if (!el) return
  el.classList?.add(HIDDEN_SCROLLBAR_CLASS)
  el.style.scrollbarWidth = 'none'
  el.style.setProperty('scrollbar-width', 'none')
  el.style.setProperty('-ms-overflow-style', 'none')
}

function clampPercentage(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function spineItemCount() {
  const spine = epub.book.value?.spine
  return spine?.spineItems?.length || spine?.items?.length || spine?.length || 0
}

function directPercentageFromLocation(location) {
  const direct = clampPercentage(location?.start?.percentage)
  if (direct == null) return null
  if (direct > 0 || location?.atStart) return direct

  const index = Number(location?.start?.index)
  const page = Number(location?.start?.displayed?.page)
  const isPastStart = (Number.isFinite(index) && index > 0) || (Number.isFinite(page) && page > 1)
  return isPastStart ? null : direct
}

function estimatePercentageFromLocation(location) {
  const direct = directPercentageFromLocation(location)
  if (direct != null) return direct

  const count = spineItemCount()
  const index = Number(location?.start?.index)
  if (!count || !Number.isFinite(index)) return null

  const displayed = location?.start?.displayed || {}
  const page = Number(displayed.page)
  const total = Number(displayed.total)
  const pageOffset =
    Number.isFinite(page) && Number.isFinite(total) && total > 0
      ? Math.max(0, Math.min(1, (Math.max(1, page) - 1) / total))
      : 0
  const spineOffset = Math.max(0, Math.min(count - 1, index))
  return clampPercentage((spineOffset + pageOffset) / count)
}

function percentageFromLocation(location) {
  if (epub.locationsReady.value && location?.start?.cfi && epub.book.value?.locations) {
    const pct = epub.book.value.locations.percentageFromCfi(location.start.cfi)
    const exact = clampPercentage(pct)
    if (exact != null) return exact
  }
  return estimatePercentageFromLocation(location)
}

function updateProgressFromLocation(location) {
  const pct = percentageFromLocation(location)
  if (pct == null) return null
  epub.percentage.value = pct
  return pct
}

function currentLocationForProgress() {
  return lastKnownLocation || rendition?.location || null
}

function reportLocationNow() {
  if (!rendition) return
  if (suppressResizeLocationReports) return
  if (typeof rendition.reportLocation === 'function') {
    rendition.reportLocation()
    return
  }
  updateProgressFromLocation(currentLocationForProgress())
}

function scheduleLocationReport(delay = 120) {
  clearTimeout(locationReportTimer)
  locationReportTimer = setTimeout(reportLocationNow, delay)
}

function nextPage() {
  const el = getScrollContainer()
  if (!el || !rendition) return false
  const before = el.scrollTop
  el.scrollBy({ top: el.clientHeight - 40, behavior: 'auto' })
  const after = el.scrollTop
  if (after === before) {
    if (rendition.location?.atEnd) {
      pushStatus('已到末尾')
      return false
    }
    navigateChapter('next')
    return true
  }
  reportLocationNow()
  return true
}

function prevPage() {
  const el = getScrollContainer()
  if (!el || !rendition) return false
  if (el.scrollTop <= 1) {
    if (rendition.location?.atStart) {
      pushStatus('已到开头')
      return false
    }
    navigateChapter('prev')
    return false
  }
  el.scrollBy({ top: -(el.clientHeight - 40), behavior: 'auto' })
  reportLocationNow()
  return true
}

function scrollDown() {
  const el = getScrollContainer()
  if (!el) return false
  if (ctrl.mode.value === 'paginate') return nextPage()
  el.scrollBy({ top: 80, behavior: 'smooth' })
  scheduleLocationReport()
  return true
}

function scrollUp() {
  const el = getScrollContainer()
  if (!el) return false
  if (ctrl.mode.value === 'paginate') return prevPage()
  el.scrollBy({ top: -80, behavior: 'smooth' })
  scheduleLocationReport()
  return true
}

function navigateChapter(direction) {
  if (!rendition) return
  const target = beginChapterNavigation(adjacentChapterHref(direction))
  ctrl.isNavigating.value = true
  autoTurn.pause()

  Promise.resolve(direction === 'next' ? rendition.next() : rendition.prev()).catch(() => {
    clearPendingChapterNavigation(target)
    clearTimeout(navigationTimeout)
    ctrl.isNavigating.value = false
    autoTurn.resume()
  })

  rendition.once('rendered', () => {
    clearTimeout(navigationTimeout)
    const el = getScrollContainer()
    if (el) {
      el.scrollTop = direction === 'prev' ? el.scrollHeight - el.clientHeight : 0
      if (pendingChapterTarget === target) pendingChapterTarget = null
      reportLocationNow()
    }
    ctrl.isNavigating.value = false
    autoTurn.resume()
  })

  navigationTimeout = setTimeout(() => {
    if (pendingChapterTarget === target) pendingChapterTarget = null
    ctrl.isNavigating.value = false
    autoTurn.resume()
  }, 3000)
}

function goToChapter(href) {
  if (!rendition?.display) return false
  const target = beginChapterNavigation(href, { awaitsLocationConfirmation: true })
  ctrl.isNavigating.value = true
  try {
    Promise.resolve(rendition.display(href))
      .then(async () => {
        await alignChapterTargetToTop(target)
        if (pendingChapterTarget !== target) return false
        target.layoutAligned = true
        armChapterNavigationSettleTimeout(target)
        settlePendingChapterNavigation(target)
        return true
      })
      .catch(() => {
        clearPendingChapterNavigation(target)
        ctrl.isNavigating.value = false
        return false
      })
      .finally(() => {
        if (pendingChapterTarget !== target) ctrl.isNavigating.value = false
      })
  } catch {
    clearPendingChapterNavigation(target)
    ctrl.isNavigating.value = false
    return false
  }
  return true
}

function snapToPaginateBoundary() {
  if (ctrl.mode.value !== 'paginate') return
  const el = getScrollContainer()
  if (!el || el.clientHeight === 0) return
  const top = Math.round(el.scrollTop / el.clientHeight) * el.clientHeight
  const manager = rendition?.manager
  if (manager?.container === el && typeof manager.scrollTo === 'function') {
    const previousTop = el.scrollTop
    manager.scrollTo(el.scrollLeft, top, true)
    if (previousTop === el.scrollTop) manager.ignore = false
    return
  }
  el.scrollTop = top
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

function moveChapterTargetToTop(target) {
  if (!target || currentChapterTarget !== target) return false
  const section = sectionForCanonicalHref(target.canonicalHref)
  const view = section ? visibleViewForSection(section) : null
  if (!view || !rendition?.manager) return false
  const fragmentTarget = tocFragmentTarget(target.href)
  if (!fragmentTarget) {
    const offset = typeof view.offset === 'function' ? view.offset() : { left: 0, top: 0 }
    const container = getScrollContainer()
    const previousLeft = container?.scrollLeft
    const previousTop = container?.scrollTop
    rendition.manager.scrollTo(offset.left || 0, offset.top || 0, true)
    if (container && previousLeft === container.scrollLeft && previousTop === container.scrollTop) {
      rendition.manager.ignore = false
    }
    return true
  }
  try {
    const offset = view.locationOf(fragmentTarget)
    const width = typeof view.width === 'function' ? view.width() : undefined
    const container = getScrollContainer()
    const previousLeft = container?.scrollLeft
    const previousTop = container?.scrollTop
    rendition.manager.moveTo(offset, width)
    if (container && previousLeft === container.scrollLeft && previousTop === container.scrollTop) {
      rendition.manager.ignore = false
    }
    return true
  } catch {
    return false
  }
}

async function alignChapterTargetToTop(target) {
  if (!target) return false
  await nextAnimationFrame()
  moveChapterTargetToTop(target)
  await nextAnimationFrame()
  return moveChapterTargetToTop(target)
}

function currentTocItem(canonicalSectionHref) {
  const items = tocItemsForSection(canonicalSectionHref)
  if (!items.length) return null

  const pending = pendingChapterTarget
  if (pending?.canonicalHref === canonicalSectionHref) {
    const pendingItem = findTocItemByHref(pending.href)
    if (pendingItem) return pendingItem
  }

  const section = sectionForCanonicalHref(canonicalSectionHref)
  const view = section ? visibleViewForSection(section) : null
  const viewportTop = getScrollContainer()?.getBoundingClientRect?.().top
  const viewTop = view?.iframe?.getBoundingClientRect?.().top ?? view?.position?.().top
  if (!view || !Number.isFinite(viewportTop) || !Number.isFinite(viewTop)) return items[0]

  return findActiveTocItemByViewport(items, viewportTop, (item) => {
    const fragmentTarget = tocFragmentTarget(item.href)
    if (!fragmentTarget) return viewTop
    if (!view.contents?.document?.getElementById(fragmentTarget.slice(1))) return null
    try {
      const localTop = view.locationOf(fragmentTarget).top
      return Number.isFinite(localTop) ? viewTop + localTop : null
    } catch {
      return null
    }
  })
}

function clearChapterTextNodeIndexCache() {
  chapterTextNodeIndexGeneration += 1
  chapterTextNodeIndexCache = null
}

function yieldEpubAnchorIndexing() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function currentChapterTextNodeIndexGeneration() {
  return chapterTextNodeIndexGeneration
}

function isChapterTextNodeIndexGenerationCurrent(generation) {
  return generation === chapterTextNodeIndexGeneration
}

function canonicalContentsHref(contents) {
  const sectionHref = contents?.section?.href || contents?.content?.section?.href || contents?.href
  return sectionHref ? epub.book.value.canonical(sectionHref).split('#')[0] : ''
}

function findContentsForCanonicalHref(canonicalHref) {
  const contentsList = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  return contentsList.find((contents) => canonicalContentsHref(contents) === canonicalHref) || null
}

function isCurrentChapterTextNodeIndexCache(cache) {
  return (
    chapterTextNodeIndexCache === cache &&
    cache.generation === chapterTextNodeIndexGeneration &&
    cache.document === cache.contents?.document
  )
}

function cachedTextNodeIndexForContents(contents, canonicalHref, generation) {
  const cached = chapterTextNodeIndexCache
  const sameCachedContents =
    cached &&
    cached.generation === generation &&
    cached.contents === contents &&
    cached.document === contents.document &&
    cached.href === canonicalHref
  if (sameCachedContents) {
    return cached.collected
      ? Promise.resolve({ collected: cached.collected, generation: cached.generation })
      : cached.promise
  }

  const nextCache = {
    contents,
    document: contents.document,
    href: canonicalHref,
    generation,
    collected: null,
    promise: null
  }
  nextCache.promise = collectTextNodes(contents.document, {
    yieldToEventLoop: yieldEpubAnchorIndexing
  })
    .then((collected) => {
      if (!isCurrentChapterTextNodeIndexCache(nextCache)) return null
      nextCache.collected = collected
      return { collected, generation: nextCache.generation }
    })
    .catch((error) => {
      if (isCurrentChapterTextNodeIndexCache(nextCache)) clearChapterTextNodeIndexCache()
      throw error
    })
  chapterTextNodeIndexCache = nextCache
  return nextCache.promise
}

async function resolveCurrentChapterOffset(
  location,
  generation = currentChapterTextNodeIndexGeneration()
) {
  const cfi = location?.start?.cfi
  const href = location?.start?.href
  if (!cfi || !href || !rendition?.getContents) return null
  if (!isChapterTextNodeIndexGenerationCurrent(generation)) return null
  const canonicalHref = epub.book.value.canonical(href).split('#')[0]
  const contents = findContentsForCanonicalHref(canonicalHref)
  if (!contents?.document || typeof contents.range !== 'function') return null
  let range = null
  try {
    range = contents.range(cfi)
  } catch {
    return null
  }
  if (!range?.startContainer) return null
  let indexed = null
  try {
    indexed = await cachedTextNodeIndexForContents(contents, canonicalHref, generation)
  } catch {
    return null
  }
  if (!indexed?.collected || !isChapterTextNodeIndexGenerationCurrent(generation)) return null
  const chapterOffset = offsetFromDomPosition(
    indexed.collected.nodes,
    range.startContainer,
    range.startOffset
  )
  if (chapterOffset === null) return null
  return { chapterOffset, generation }
}

function spineIndexFromLocation(location) {
  const raw = location?.start?.index
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function scheduleSave() {
  clearTimeout(saveDebounceTimer)
  saveDebounceTimer = setTimeout(() => {
    if (shouldDiscardMaintenanceProgress()) return
    if (!rendition || !rendition.location) return
    const loc = rendition.location
    const pct = updateProgressFromLocation(loc) ?? epub.percentage.value ?? 0
    epub.savePosition({ cfi: loc.start.cfi, percentage: pct, mode: ctrl.mode.value })
  }, 2000)
}

function flushSave() {
  clearTimeout(saveDebounceTimer)
  if (shouldDiscardMaintenanceProgress()) return
  if (!rendition || !rendition.location) return
  const loc = rendition.location
  const pct = updateProgressFromLocation(loc) ?? epub.percentage.value ?? 0
  window.api.epubFlushProgress(epub.fileId.value, {
    cfi: loc.start.cfi,
    percentage: pct,
    mode: ctrl.mode.value
  })
}

function collectCurrentProgress() {
  if (!rendition || !rendition.location) return null
  const loc = rendition.location
  const pct = updateProgressFromLocation(loc) ?? epub.percentage.value ?? 0
  return {
    cfi: loc.start.cfi,
    percentage: pct,
    mode: ctrl.mode.value
  }
}

function injectSelectionEnhancement(contents) {
  const doc = contents?.document
  if (!doc?.head) return
  const enhanced = props.fileVisualState?.selectionCssVars?.['--selection-bg-enhanced']
  if (!enhanced) return
  let style = doc.head.querySelector('style[data-goof-off-selection="true"]')
  if (!style) {
    style = doc.createElement('style')
    style.dataset.goofOffSelection = 'true'
    doc.head.appendChild(style)
  }
  style.textContent = `
@supports (background: color-mix(in srgb, black 10%, transparent)) {
  ::selection,
  *::selection {
    background: ${enhanced} !important;
    color: inherit !important;
  }
}
`
}

function refreshLoadedSelectionEnhancements() {
  const contents = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  for (const content of contents) {
    injectSelectionEnhancement(content)
  }
}

function ensureSelectionHook() {
  if (selectionHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(injectSelectionEnhancement)
  selectionHookRegistered = true
}

function getLoadedContents() {
  return typeof rendition?.getContents === 'function' ? rendition.getContents() : []
}

function shouldHideEpubImages() {
  return epubPrefs.value.hideImages !== false
}

function injectImageVisibilityFromHook(contents) {
  syncEpubImageVisibility(contents, shouldHideEpubImages())
}

function ensureImageVisibilityHook() {
  if (imageVisibilityHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(injectImageVisibilityFromHook)
  imageVisibilityHookRegistered = true
}

function syncLoadedImageVisibility(hideImages = shouldHideEpubImages()) {
  for (const contents of getLoadedContents()) {
    syncEpubImageVisibility(contents, hideImages)
  }
}

function injectSearchHighlightStyleFromHook(contents) {
  injectSearchHighlightStyle(contents)
}

function ensureSearchHighlightHook() {
  if (searchHighlightHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(injectSearchHighlightStyleFromHook)
  searchHighlightHookRegistered = true
}

function refreshSearchHighlights() {
  if (!rendition || !search) return
  applySearchHighlights(getLoadedContents(), {
    active: search.active.value,
    results: search.results.value,
    currentHitIndex: search.currentHitIndex.value
  })
}

function clearLoadedSearchHighlights() {
  clearSearchHighlights(getLoadedContents())
}

function attachTrackpadGestureToContents(contents) {
  const doc = contents?.document
  if (!doc || trackpadContentCleanups.has(doc) || !trackpadGesture) return
  const handler = (event) => trackpadGesture.handleWheel(event, 'epub-content')
  doc.addEventListener('wheel', handler, { passive: false })
  trackpadContentCleanups.set(doc, () => doc.removeEventListener('wheel', handler))
}

function attachTrackpadGestureToLoadedContents() {
  const contents = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  for (const content of contents) attachTrackpadGestureToContents(content)
}

function attachTrackpadGestureFromHook(contents) {
  attachTrackpadGestureToContents(contents)
}

function ensureTrackpadGestureHook() {
  if (trackpadHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(attachTrackpadGestureFromHook)
  trackpadHookRegistered = true
}

function clearTrackpadGestureContentListeners() {
  for (const cleanup of trackpadContentCleanups.values()) cleanup()
  trackpadContentCleanups.clear()
  trackpadHookRegistered = false
}

function isFileDragEvent(event) {
  return Array.from(event?.dataTransfer?.types || []).includes('Files')
}

function forwardFileDragEventFromContents(sourceEvent) {
  const host = containerRef.value
  if (!host?.dispatchEvent || !isFileDragEvent(sourceEvent)) return

  const EventCtor = host.ownerDocument?.defaultView?.Event || Event
  const forwardedEvent = new EventCtor(sourceEvent.type, {
    bubbles: true,
    cancelable: true,
    composed: true
  })
  Object.defineProperty(forwardedEvent, 'dataTransfer', {
    configurable: true,
    value: sourceEvent.dataTransfer
  })

  host.dispatchEvent(forwardedEvent)
  if (forwardedEvent.defaultPrevented) {
    sourceEvent.preventDefault()
    sourceEvent.stopPropagation()
  }
}

function attachFileDragToContents(contents) {
  const doc = contents?.document
  if (
    !doc ||
    typeof doc.addEventListener !== 'function' ||
    typeof doc.removeEventListener !== 'function' ||
    fileDragContentCleanups.has(doc)
  ) {
    return
  }

  for (const type of FILE_DRAG_EVENT_TYPES) {
    doc.addEventListener(type, forwardFileDragEventFromContents, true)
  }
  fileDragContentCleanups.set(doc, () => {
    for (const type of FILE_DRAG_EVENT_TYPES) {
      doc.removeEventListener(type, forwardFileDragEventFromContents, true)
    }
  })
}

function attachFileDragToLoadedContents() {
  const contents = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  for (const content of contents) attachFileDragToContents(content)
}

function attachFileDragFromHook(contents) {
  attachFileDragToContents(contents)
}

function ensureFileDragHook() {
  if (fileDragHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(attachFileDragFromHook)
  fileDragHookRegistered = true
}

function clearFileDragContentListeners() {
  for (const cleanup of fileDragContentCleanups.values()) cleanup()
  fileDragContentCleanups.clear()
  fileDragHookRegistered = false
}

function attachContentPointerToContents(contents) {
  const doc = contents?.document
  if (
    !doc ||
    typeof doc.addEventListener !== 'function' ||
    typeof doc.removeEventListener !== 'function' ||
    contentPointerCleanups.has(doc)
  ) {
    return
  }
  const handler = () => {
    chromeLocks.handleOutsidePointer({
      reason: 'epub-content-pointer',
      restoreFocus: false
    })
  }
  doc.addEventListener('pointerdown', handler, true)
  contentPointerCleanups.set(doc, () => doc.removeEventListener('pointerdown', handler, true))
}

function attachContentPointerToLoadedContents() {
  const contents = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  for (const content of contents) attachContentPointerToContents(content)
}

function attachContentPointerFromHook(contents) {
  attachContentPointerToContents(contents)
}

function ensureContentPointerHook() {
  if (contentPointerHookRegistered || !rendition?.hooks?.content?.register) return
  rendition.hooks.content.register(attachContentPointerFromHook)
  contentPointerHookRegistered = true
}

function clearContentPointerListeners() {
  for (const cleanup of contentPointerCleanups.values()) cleanup()
  contentPointerCleanups.clear()
  contentPointerHookRegistered = false
}

function clearLoadedEpubThemeStyles() {
  const contents = typeof rendition?.getContents === 'function' ? rendition.getContents() : []
  for (const content of contents) {
    const style = content?.document?.head?.querySelector?.(
      `#epubjs-inserted-css-${EPUB_THEME_NAME}`
    )
    style?.remove()
  }
}

function buildEpubTheme() {
  const visual = props.fileVisualState
  const background = visual?.hasCustomGradient ? visual.gradientCss : 'transparent'
  const textColor = visual?.effectiveTextColor || themeText.value
  const selectionBg =
    visual?.selectionCssVars?.['--selection-bg'] ||
    visual?.selectionCssVars?.['--selection-bg-fallback'] ||
    'rgba(128, 128, 128, 0.18)'
  const selectionTextShadow = visual?.selectionCssVars?.['--selection-text-shadow'] || 'none'
  const fontFamily = fontFamilyCss(epubPrefs.value.fontFamily)
  const bodyDescendantRules = {
    color: `${textColor} !important`,
    background: 'transparent !important'
  }
  if (fontFamily) {
    bodyDescendantRules['font-family'] = `${fontFamily} !important`
  }

  return {
    html: {
      background: `${background} !important`,
      'scrollbar-width': hiddenScrollbarRule
    },
    body: {
      background: 'transparent !important',
      'font-size': `${epubPrefs.value.fontSize || 16}px !important`,
      'line-height': `${epubPrefs.value.lineHeight || 1.7} !important`,
      'scrollbar-width': hiddenScrollbarRule
    },
    '::-webkit-scrollbar': { display: hiddenScrollbarRule },
    'body, body *': bodyDescendantRules,
    'a, a *': { color: `${themeAccent.value} !important` },
    img: { 'max-width': '100% !important', height: 'auto !important' },
    '::selection': {
      background: `${selectionBg} !important`,
      color: 'inherit !important',
      'text-shadow': `${selectionTextShadow} !important`
    },
    '*::selection': {
      background: `${selectionBg} !important`,
      color: 'inherit !important',
      'text-shadow': `${selectionTextShadow} !important`
    }
  }
}

function applyTheme() {
  if (!rendition) return
  try {
    ensureSelectionHook()
    clearLoadedEpubThemeStyles()
    rendition.themes.register(EPUB_THEME_NAME, buildEpubTheme())
    rendition.themes.select(EPUB_THEME_NAME)
    refreshLoadedSelectionEnhancements()
    if (search?.active?.value) refreshSearchHighlights()
  } catch (e) {
    if (!themeFailureNotified) {
      themeFailureNotified = true
      pushStatus('EPUB 视觉样式应用失败')
    }
    console.error('[EpubReader] apply theme failed:', e)
  }
}

function applyMode(newMode) {
  const el = getScrollContainer()
  if (!el || !rendition) return
  el.style.overflow = newMode === 'scroll' ? 'auto' : 'hidden'
  hideScrollbar(el)
  snapToPaginateBoundary()
}

function getSectionForCfi(cfi) {
  try {
    return epub.book.value?.spine?.get?.(cfi) || null
  } catch {
    return null
  }
}

function visibleViewForSection(section) {
  try {
    return rendition?.manager?.views?.find?.(section) || null
  } catch {
    return null
  }
}

function moveVisibleViewToCfi(cfi, section, view = visibleViewForSection(section)) {
  try {
    if (!view?.locationOf || !rendition?.manager?.moveTo) return false
    const offset = view.locationOf(cfi)
    if (!offset || (typeof offset.left !== 'number' && typeof offset.top !== 'number')) {
      return false
    }
    const width = typeof view.width === 'function' ? view.width() : undefined
    rendition.manager.moveTo(offset, width)
    return true
  } catch {
    return false
  }
}

function scrollRangeRatio(element) {
  if (!element) return 0
  const range = Math.max(0, element.scrollHeight - element.clientHeight)
  return range > 0 ? clampPercentage(element.scrollTop / range) || 0 : 0
}

function restoreScrollRangeRatio(element, ratio) {
  if (!element) return
  const range = Math.max(0, element.scrollHeight - element.clientHeight)
  element.scrollTop = range * ratio
}

async function applyImageVisibilityPreservingPosition(hideImages) {
  const activeRendition = rendition
  if (!activeRendition) return

  const generation = ++imageVisibilityGeneration
  cancelImageLayoutSettlement?.()
  const location = currentLocationForProgress()
  const cfi = location?.start?.cfi || ''
  const section = cfi ? getSectionForCfi(cfi) : null
  const ratio = scrollRangeRatio(getScrollContainer())
  const layoutSettler = createEpubImageLayoutSettler(getLoadedContents(), {
    manager: activeRendition.manager,
    view: section ? visibleViewForSection(section) : null,
    waitForImages: hideImages === false
  })
  cancelImageLayoutSettlement = layoutSettler.cancel

  autoTurn.pause()
  try {
    syncLoadedImageVisibility(hideImages)
    await layoutSettler.promise

    if (generation !== imageVisibilityGeneration || rendition !== activeRendition) return

    const restoredCfi = Boolean(cfi && section && moveVisibleViewToCfi(cfi, section))
    if (!restoredCfi) restoreScrollRangeRatio(getScrollContainer(), ratio)
    snapToPaginateBoundary()
    reportLocationNow()
  } finally {
    layoutSettler.cancel()
    if (cancelImageLayoutSettlement === layoutSettler.cancel) {
      cancelImageLayoutSettlement = null
    }
    autoTurn.resume()
  }
}

async function displaySavedCfi(cfi) {
  const section = getSectionForCfi(cfi)
  if (!section?.href) return false
  const target = beginChapterNavigation(section.href)
  try {
    await Promise.resolve(rendition.display(section.href))
    const moved = moveVisibleViewToCfi(cfi, section)
    if (pendingChapterTarget === target) pendingChapterTarget = null
    return moved
  } catch (error) {
    clearPendingChapterNavigation(target)
    throw error
  }
}

async function displayCfi(cfi) {
  if (!rendition) return false
  ctrl.isNavigating.value = true
  autoTurn.pause()
  try {
    const ok = await displaySavedCfi(cfi)
    if (ok) snapToPaginateBoundary()
    if (ok) reportLocationNow()
    return ok
  } catch {
    return false
  } finally {
    ctrl.isNavigating.value = false
    autoTurn.resume()
  }
}

async function restorePosition() {
  const saved = await window.api.epubGetProgress(epub.fileId.value)
  if (saved?.mode) {
    ctrl.mode.value = saved.mode
  }
  if (saved?.cfi) {
    try {
      if (await displaySavedCfi(saved.cfi)) return true
    } catch {
      /* fallback */
    }
  }
  if (saved?.percentage && saved.percentage > 0) {
    if (epub.locationsReady.value) {
      const cfi = epub.book.value.locations.cfiFromPercentage(saved.percentage)
      try {
        if (await displaySavedCfi(cfi)) return true
      } catch {
        /* fallback */
      }
    } else {
      await new Promise((resolve) => {
        const unwatch = watch(
          () => epub.locationsReady.value,
          (ready) => {
            if (ready) {
              unwatch()
              resolve()
            }
          }
        )
        setTimeout(() => {
          unwatch()
          resolve()
        }, 10000)
      })
      if (epub.locationsReady.value) {
        const cfi = epub.book.value.locations.cfiFromPercentage(saved.percentage)
        try {
          if (await displaySavedCfi(cfi)) return true
        } catch {
          /* fallback */
        }
      }
    }
  }
  await rendition.display()
  return false
}

function remindIframeRepaint() {
  // 弱 GPU 会话（Chromium GPU CommandBuffer 创建失败）下，恢复定位后 iframe 图层可能
  // 整页未光栅化（白屏），直到一次滚动才显示内容；这里以不可见方式模拟该治愈动作：
  // translateZ 触发图层重建 + 1px 滚动往返（同 epub.js show() 对 Safari 的重绘提醒）。
  const iframe = containerRef.value?.querySelector('iframe')
  if (iframe) {
    iframe.style.transform = 'translateZ(0)'
    void iframe.offsetWidth
    iframe.style.transform = ''
  }
  const el = getScrollContainer()
  if (!el) return
  const top = el.scrollTop
  el.scrollTop = top + 1
  requestAnimationFrame(() => {
    el.scrollTop = top
  })
}

function handleRelocated(location) {
  if (!location?.start?.href) return
  if (suppressResizeLocationReports) return
  const canonicalHref = canonicalChapterHref(location.start.href)
  const pendingTarget = pendingChapterTarget
  const pendingHref = pendingTarget?.canonicalHref
  if (pendingHref && canonicalHref !== pendingHref) return
  // A location callback can be queued before a menu display has finished. It
  // describes the old scroll position even when it reaches this handler after
  // the new section's iframe has been rendered, so it must not update any
  // chapter state until the target anchor has been aligned.
  if (pendingTarget?.awaitsLocationConfirmation && !pendingTarget.layoutAligned) return
  // 标题必须与当前已经渲染的 iframe 同步，而不是与历史 relocated 事件同步。
  const renderedHref = canonicalChapterHref(rendition?.manager?.current?.()?.section?.href)
  if (renderedHref && canonicalHref !== renderedHref) return
  const activeTocItem =
    (pendingTarget && findTocItemByHref(pendingTarget.href)) || currentTocItem(canonicalHref)
  // 同一 XHTML 内的目录项共享章节路径，菜单点击前排队的旧 relocated 事件也会
  // 命中该路径。只有目标锚点已经完成两帧对齐后，才允许它确认本次导航。
  if (canConfirmChapterNavigationLocation(pendingTarget)) {
    pendingTarget.locationConfirmed = true
  } else if (!pendingTarget) {
    currentChapterTarget = {
      href: hrefForChapterRelocation({
        activeTocItem,
        currentChapterTarget,
        canonicalHref,
        locationHref: location.start.href
      }),
      canonicalHref,
      previous: null
    }
  }
  lastKnownLocation = location
  const spineIndex = spineIndexFromLocation(location)
  const fileId = epub.fileId.value || ''
  ctrl.currentChapterLabel.value = activeTocItem?.label?.trim() || ''
  ctrl.currentChapterHref.value = canonicalHref
  ctrl.currentTocHref.value = activeTocItem ? canonicalTocHref(activeTocItem.href) : canonicalHref
  ctrl.updateSearchAnchor({
    fileId,
    spineIndex,
    sectionHref: canonicalHref,
    currentCfi: location.start.cfi || '',
    chapterOffset: null
  })
  const anchorGeneration = currentChapterTextNodeIndexGeneration()
  resolveCurrentChapterOffset(location, anchorGeneration).then((resolved) => {
    if (!resolved) return
    if (!isChapterTextNodeIndexGenerationCurrent(resolved.generation)) return
    if (epub.fileId.value !== fileId) return
    if (lastKnownLocation?.start?.cfi !== location.start.cfi) return
    ctrl.updateSearchAnchor({
      fileId,
      spineIndex,
      sectionHref: canonicalHref,
      currentCfi: location.start.cfi || '',
      chapterOffset: resolved.chapterOffset
    })
  })
  updateProgressFromLocation(location)
  scheduleSave()
  if (pendingTarget?.awaitsLocationConfirmation) {
    settlePendingChapterNavigation(pendingTarget)
  }
}

function observedViewportSize(entry) {
  const rect = entry?.contentRect
  if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
    return { width: rect.width, height: rect.height }
  }
  const bounds = containerRef.value?.getBoundingClientRect?.()
  return {
    width: bounds?.width || 0,
    height: bounds?.height || 0
  }
}

function handleViewportResize(entries) {
  const size = observedViewportSize(entries?.[0])
  if (!lastViewportSize) {
    lastViewportSize = size
    lastAppliedViewportSize = size
    return
  }
  if (lastViewportSize?.width === size.width && lastViewportSize?.height === size.height) return
  lastViewportSize = size
  clearTimeout(resizeDebounceTimer)
  resizeDebounceTimer = setTimeout(() => applyViewportResize(size), 140)
}

function applyViewportResize(size) {
  if (!rendition) return
  if (pendingChapterTarget?.awaitsLocationConfirmation) {
    deferViewportResize(size)
    return
  }
  if (
    lastAppliedViewportSize?.width === size.width &&
    lastAppliedViewportSize?.height === size.height
  ) {
    return
  }

  lastAppliedViewportSize = size
  guardEpubJsResize()
  disableEpubJsWindowResize()
  reflowManagerWithoutRedisplay(
    rendition.manager,
    size.width,
    size.height,
    captureResizeScrollPosition()
  )
}

onMounted(async () => {
  if (!epub.book.value || !containerRef.value) return

  await bootstrapReaderPrefs()
  ctrl.mode.value = epubPrefs.value.defaultMode || 'scroll'

  themeUnlisten = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeUnlisten.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  rendition = epub.book.value.renderTo(containerRef.value, {
    flow: 'scrolled-doc',
    width: '100%',
    height: '100%'
  })
  rendition.once('attached', () => {
    guardEpubJsResize()
    disableEpubJsWindowResize()
  })
  hideScrollbar(getScrollContainer())

  ensureImageVisibilityHook()
  syncLoadedImageVisibility()
  ensureSearchHighlightHook()
  ensureTrackpadGestureHook()
  ensureFileDragHook()
  ensureContentPointerHook()
  attachTrackpadGestureToLoadedContents()
  attachFileDragToLoadedContents()
  attachContentPointerToLoadedContents()
  rendition.on('rendered', clearChapterTextNodeIndexCache)
  rendition.on('rendered', attachTrackpadGestureToLoadedContents)
  rendition.on('rendered', attachFileDragToLoadedContents)
  rendition.on('rendered', attachContentPointerToLoadedContents)
  rendition.on('rendered', refreshSearchHighlights)

  applyTheme()

  epub.registerRenditionCleanup(({ discardProgress } = {}) => {
    if (!discardProgress && !shouldDiscardMaintenanceProgress()) flushSave()
    clearLoadedSearchHighlights()
    imageVisibilityGeneration += 1
    cancelImageLayoutSettlement?.()
    cancelImageLayoutSettlement = null
    imageVisibilityHookRegistered = false
    clearTrackpadGestureContentListeners()
    clearFileDragContentListeners()
    clearContentPointerListeners()
    clearChapterTextNodeIndexCache()
    clearTimeout(chapterNavigationSettleTimer)
    clearTimeout(resizeDebounceTimer)
    clearTimeout(resizeLocationSuppressionTimer)
    resizeLocationSuppressionTimer = null
    suppressResizeLocationReports = false
    resizeGeneration += 1
    guardedResizeManager = null
    guardedResizeHandler = null
    guardedResizeEmitHandler = null
    currentChapterTarget = null
    pendingChapterTarget = null
    deferredViewportSize = null
    ctrl.currentTocHref.value = ''
    ctrl.resetSearchAnchor()
    if (rendition) {
      rendition.destroy()
      rendition = null
    }
  })
  unregisterProgressCollector = epub.registerProgressCollector(collectCurrentProgress)
  unregisterActiveFlush = registerActiveReaderFlush(epub.flushCurrentProgress)

  rendition.on('loaderror', (_section, err) => {
    pushStatus('部分内容加载失败')
    console.error('[EpubReader] loaderror:', err)
  })

  rendition.on('relocated', handleRelocated)

  const restoredSavedPosition = await restorePosition()
  if (!rendition) return
  guardEpubJsResize()
  disableEpubJsWindowResize()
  reportLocationNow()
  if (restoredSavedPosition) remindIframeRepaint()

  ctrl.register({
    nextPage,
    prevPage,
    nextChapter: () => navigateChapter('next'),
    prevChapter: () => navigateChapter('prev'),
    goToChapter,
    scrollDown,
    scrollUp,
    displayCfi
  })

  attachToRendition(rendition)

  resizeObserver = new ResizeObserver(handleViewportResize)
  resizeObserver.observe(containerRef.value)

  applyMode(ctrl.mode.value)
  window.addEventListener('epub:toggle-auto-turn', handleToggleAutoTurn)
})

onUnmounted(() => {
  flushSave()
  autoTurn.stop()
  window.removeEventListener('epub:toggle-auto-turn', handleToggleAutoTurn)
  ctrl.unregister()
  clearTimeout(navigationTimeout)
  clearTimeout(chapterNavigationSettleTimer)
  clearTimeout(locationReportTimer)
  clearTimeout(resizeDebounceTimer)
  clearTimeout(resizeLocationSuppressionTimer)
  resizeLocationSuppressionTimer = null
  suppressResizeLocationReports = false
  resizeGeneration += 1
  guardedResizeManager = null
  guardedResizeHandler = null
  guardedResizeEmitHandler = null
  themeUnlisten?.disconnect()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  clearTrackpadGestureContentListeners()
  clearFileDragContentListeners()
  clearContentPointerListeners()
  clearLoadedSearchHighlights()
  imageVisibilityGeneration += 1
  cancelImageLayoutSettlement?.()
  cancelImageLayoutSettlement = null
  imageVisibilityHookRegistered = false
  clearChapterTextNodeIndexCache()
  currentChapterTarget = null
  pendingChapterTarget = null
  deferredViewportSize = null
  ctrl.currentTocHref.value = ''
  ctrl.resetSearchAnchor()
  if (rendition) {
    rendition.destroy()
    rendition = null
  }
  epub.unregisterRenditionCleanup()
  unregisterActiveFlush?.()
  unregisterProgressCollector?.()
})

watch(
  [
    themeText,
    themeAccent,
    () => props.fileVisualState,
    () => props.isMini,
    () => epubPrefs.value.fontSize,
    () => epubPrefs.value.lineHeight,
    () => epubPrefs.value.fontFamily
  ],
  applyTheme,
  { deep: true }
)

watch(
  () => epubPrefs.value.defaultMode,
  (newMode) => {
    const mode = newMode === 'paginate' ? 'paginate' : 'scroll'
    if (ctrl.mode.value !== mode) ctrl.mode.value = mode
  }
)

watch(
  () => epubPrefs.value.hideImages,
  (hideImages) => {
    if (!rendition) return
    void applyImageVisibilityPreservingPosition(hideImages !== false)
  },
  { flush: 'sync' }
)

watch(
  () => ctrl.mode.value,
  (newMode) => {
    const el = getScrollContainer()
    if (!el || !rendition) return
    autoTurn.pause()
    const oldScrollTop = el.scrollTop
    const oldScrollHeight = el.scrollHeight
    applyMode(newMode)
    if (oldScrollHeight > 0) {
      setTimeout(() => {
        const newScrollHeight = el.scrollHeight
        el.scrollTop = oldScrollTop * (newScrollHeight / oldScrollHeight)
        snapToPaginateBoundary()
        autoTurn.resume()
      }, 0)
    } else {
      autoTurn.resume()
    }
  }
)

watch(
  () => epub.locationsReady.value,
  (ready) => {
    if (!ready) return
    if (updateProgressFromLocation(currentLocationForProgress()) == null) {
      reportLocationNow()
    } else {
      scheduleSave()
    }
  }
)

watch(
  () => [
    search?.active.value,
    search?.results.value,
    search?.currentHitIndex.value,
    ctrl.currentChapterHref.value
  ],
  () => {
    if (!search) return
    if (search.active.value) refreshSearchHighlights()
    else clearLoadedSearchHighlights()
  },
  { deep: false }
)
</script>

<template>
  <div class="epub-reader" :class="{ 'is-mini': isMini }">
    <div ref="containerRef" class="epub-view-container" />
  </div>
</template>

<style scoped>
.epub-reader {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: reader-fade-in var(--motion-content) ease;
}
.epub-view-container {
  flex: 1;
  overflow: auto;
  scrollbar-width: none;
  padding: 56px 0 60px;
  box-sizing: border-box;
  background: transparent;
}
.epub-view-container :deep(iframe) {
  background: transparent !important;
}
.epub-view-container :deep(.goof-off-epub-scrollbar-hidden) {
  scrollbar-width: none;
}
.epub-view-container::-webkit-scrollbar {
  display: none;
}
.epub-view-container :deep(.goof-off-epub-scrollbar-hidden::-webkit-scrollbar) {
  display: none;
}
@keyframes reader-fade-in {
  from {
    opacity: 0;
  }
}
</style>
