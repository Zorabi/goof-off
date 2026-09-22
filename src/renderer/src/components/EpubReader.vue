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
let locationReportTimer = null
let lastKnownLocation = null
let lastViewportSize = null
let pendingChapterTarget = null
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

function beginChapterNavigation(href) {
  const canonicalHref = canonicalChapterHref(href)
  if (!canonicalHref) return null
  const target = { href, canonicalHref }
  pendingChapterTarget = target
  return target
}

function clearPendingChapterNavigation(target) {
  if (pendingChapterTarget === target) pendingChapterTarget = null
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

function resizeAnchor() {
  return (
    pendingChapterTarget?.href ||
    lastKnownLocation?.start?.cfi ||
    rendition?.location?.start?.cfi ||
    undefined
  )
}

function disableEpubJsWindowResize() {
  // epub.js 0.3.x 会自行注册一个 window.resize 监听器。它调用 manager.resize()
  // 时不会携带 cfi，随后 rendition 会重新 display 旧的 location.start.cfi。
  // 统一交给下方的 ResizeObserver 驱动，才能保证每次缩放都使用 resizeAnchor()。
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
      reportLocationNow()
    }
    ctrl.isNavigating.value = false
    autoTurn.resume()
  })

  navigationTimeout = setTimeout(() => {
    clearPendingChapterNavigation(target)
    ctrl.isNavigating.value = false
    autoTurn.resume()
  }, 3000)
}

function goToChapter(href) {
  if (!rendition?.display) return false
  const target = beginChapterNavigation(href)
  ctrl.isNavigating.value = true
  try {
    Promise.resolve(rendition.display(href))
      .catch(() => {
        clearPendingChapterNavigation(target)
        return false
      })
      .finally(() => {
        ctrl.isNavigating.value = false
        reportLocationNow()
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
  el.scrollTop = Math.round(el.scrollTop / el.clientHeight) * el.clientHeight
}

function matchTocChapter(href) {
  if (!epub.book.value || !epub.toc.value.length) return ''
  const canonical = epub.book.value.canonical(href).split('#')[0]
  function findInToc(items) {
    for (const item of items) {
      const itemHref = epub.book.value.canonical(item.href).split('#')[0]
      if (itemHref === canonical) return item.label
      if (item.subitems?.length) {
        const found = findInToc(item.subitems)
        if (found) return found
      }
    }
    return ''
  }
  return findInToc(epub.toc.value)
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
  await Promise.resolve(rendition.display(section.href))
  return moveVisibleViewToCfi(cfi, section)
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
  const canonicalHref = canonicalChapterHref(location.start.href)
  if (pendingChapterTarget && canonicalHref !== pendingChapterTarget.canonicalHref) {
    return
  }
  pendingChapterTarget = null
  lastKnownLocation = location
  const chapterLabel = matchTocChapter(location.start.href)
  const spineIndex = spineIndexFromLocation(location)
  const fileId = epub.fileId.value || ''
  ctrl.currentChapterLabel.value = chapterLabel
  ctrl.currentChapterHref.value = canonicalHref
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
    return
  }
  if (lastViewportSize?.width === size.width && lastViewportSize?.height === size.height) return
  lastViewportSize = size
  // epub.js 会在 resize 后重新 display 传入的位置；目录跳转尚未触发 relocated 时，
  // rendition.location 仍可能指向旧章节，因此要显式携带正在跳转的目标。
  if (rendition) {
    disableEpubJsWindowResize()
    rendition.resize(undefined, undefined, resizeAnchor())
  }
  snapToPaginateBoundary()
  reportLocationNow()
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
  rendition.once('attached', disableEpubJsWindowResize)
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
    pendingChapterTarget = null
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
  clearTimeout(locationReportTimer)
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
  pendingChapterTarget = null
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
