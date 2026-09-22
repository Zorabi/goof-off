import { ref, provide, inject } from 'vue'

const CTRL_KEY = Symbol('epubReaderController')

export function createEpubReaderController() {
  const showToc = ref(false)
  const showSearch = ref(false)
  const showTypography = ref(false)
  const showAutoTurnPanel = ref(false)
  const mode = ref('scroll')
  const currentChapterLabel = ref('')
  const currentChapterHref = ref('')
  const currentTocHref = ref('')
  const isNavigating = ref(false)
  const autoTurnRunning = ref(false)
  const autoTurnPaused = ref(false)
  const autoTurnCountdown = ref(0)
  const currentFileId = ref('')
  const currentSpineIndex = ref(null)
  const currentSectionHref = ref('')
  const currentCfi = ref('')
  const currentChapterOffset = ref(0)
  const currentChapterOffsetKnown = ref(false)

  const handlers = {
    nextPage: null,
    prevPage: null,
    nextChapter: null,
    prevChapter: null,
    goToChapter: null,
    scrollDown: null,
    scrollUp: null,
    displayCfi: null
  }

  function register(fns) {
    handlers.nextPage = fns.nextPage ?? null
    handlers.prevPage = fns.prevPage ?? null
    handlers.nextChapter = fns.nextChapter ?? null
    handlers.prevChapter = fns.prevChapter ?? null
    handlers.goToChapter = fns.goToChapter ?? null
    handlers.scrollDown = fns.scrollDown ?? null
    handlers.scrollUp = fns.scrollUp ?? null
    handlers.displayCfi = fns.displayCfi ?? null
  }

  function unregister() {
    handlers.nextPage = null
    handlers.prevPage = null
    handlers.nextChapter = null
    handlers.prevChapter = null
    handlers.goToChapter = null
    handlers.scrollDown = null
    handlers.scrollUp = null
    handlers.displayCfi = null
  }

  function guarded(handlerName, ...args) {
    if (isNavigating.value || handlers[handlerName] == null) return false
    return handlers[handlerName](...args)
  }

  function guardedNextPage() {
    return guarded('nextPage')
  }
  function guardedPrevPage() {
    return guarded('prevPage')
  }
  function guardedNextChapter() {
    return guarded('nextChapter')
  }
  function guardedPrevChapter() {
    return guarded('prevChapter')
  }
  function guardedGoToChapter(href) {
    return guarded('goToChapter', href)
  }
  function guardedScrollDown() {
    return guarded('scrollDown')
  }
  function guardedScrollUp() {
    return guarded('scrollUp')
  }
  function guardedDisplayCfi(cfi) {
    return guarded('displayCfi', cfi)
  }

  function toggleToc() {
    const next = !showToc.value
    showToc.value = next
    if (next) {
      showSearch.value = false
      showTypography.value = false
      showAutoTurnPanel.value = false
    }
  }

  function closeToc() {
    showToc.value = false
  }

  function closeSearch() {
    showSearch.value = false
  }

  function toggleSearch() {
    const next = !showSearch.value
    showSearch.value = next
    if (next) {
      showToc.value = false
      showTypography.value = false
      showAutoTurnPanel.value = false
    }
  }

  function toggleTypography() {
    const next = !showTypography.value
    showTypography.value = next
    if (next) {
      showToc.value = false
      showSearch.value = false
      showAutoTurnPanel.value = false
    }
  }

  function closeTypography() {
    showTypography.value = false
  }

  function toggleAutoTurnPanel() {
    const next = !showAutoTurnPanel.value
    showAutoTurnPanel.value = next
    if (next) {
      showToc.value = false
      showSearch.value = false
      showTypography.value = false
    }
  }

  function closeAutoTurnPanel() {
    showAutoTurnPanel.value = false
  }

  function resetSearchAnchor() {
    currentFileId.value = ''
    currentSpineIndex.value = null
    currentSectionHref.value = ''
    currentCfi.value = ''
    currentChapterOffset.value = 0
    currentChapterOffsetKnown.value = false
  }

  function updateSearchAnchor({ fileId, spineIndex, sectionHref, currentCfi: cfi, chapterOffset }) {
    const nextFileId = fileId || ''
    const nextSpineIndex = Number.isFinite(spineIndex) ? spineIndex : null
    const nextSectionHref = sectionHref || ''
    const sameFile =
      Boolean(currentFileId.value) && Boolean(nextFileId) && currentFileId.value === nextFileId
    const hrefsComparable = Boolean(currentSectionHref.value) && Boolean(nextSectionHref)
    const sameHref = hrefsComparable && currentSectionHref.value === nextSectionHref
    const sameResolvedSpine =
      sameFile &&
      currentSpineIndex.value !== null &&
      nextSpineIndex !== null &&
      currentSpineIndex.value === nextSpineIndex &&
      (!hrefsComparable || sameHref)
    const sameHrefFallback =
      sameFile && sameHref && (currentSpineIndex.value === null || nextSpineIndex === null)
    const sameSection = currentChapterOffsetKnown.value && (sameResolvedSpine || sameHrefFallback)
    currentFileId.value = nextFileId
    currentSpineIndex.value = nextSpineIndex
    currentSectionHref.value = nextSectionHref
    currentCfi.value = cfi || ''
    if (Number.isFinite(chapterOffset)) {
      currentChapterOffsetKnown.value = true
      currentChapterOffset.value = Math.max(0, chapterOffset)
      return
    }
    if (sameSection) return
    currentChapterOffsetKnown.value = false
    currentChapterOffset.value = 0
  }

  function searchAnchorSnapshot() {
    return {
      fileId: currentFileId.value,
      spineIndex: currentSpineIndex.value,
      sectionHref: currentSectionHref.value,
      currentCfi: currentCfi.value,
      chapterOffset: currentChapterOffset.value,
      anchorKnown: currentChapterOffsetKnown.value
    }
  }

  return {
    showToc,
    showSearch,
    showTypography,
    showAutoTurnPanel,
    mode,
    currentChapterLabel,
    currentChapterHref,
    currentTocHref,
    isNavigating,
    autoTurnRunning,
    autoTurnPaused,
    autoTurnCountdown,
    currentFileId,
    currentSpineIndex,
    currentSectionHref,
    currentCfi,
    currentChapterOffset,
    currentChapterOffsetKnown,
    register,
    unregister,
    guardedNextPage,
    guardedPrevPage,
    guardedNextChapter,
    guardedPrevChapter,
    guardedGoToChapter,
    guardedScrollDown,
    guardedScrollUp,
    guardedDisplayCfi,
    toggleToc,
    closeToc,
    toggleSearch,
    closeSearch,
    toggleTypography,
    closeTypography,
    toggleAutoTurnPanel,
    closeAutoTurnPanel,
    resetSearchAnchor,
    updateSearchAnchor,
    searchAnchorSnapshot
  }
}

export function provideEpubCtrl(ctrl) {
  provide(CTRL_KEY, ctrl)
}

export function injectEpubCtrl() {
  return inject(CTRL_KEY)
}
