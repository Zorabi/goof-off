import { ref, provide, inject } from 'vue'

const CTRL_KEY = Symbol('txtReaderController')

export function useTxtReaderController() {
  const showToc = ref(false)
  const showTypography = ref(false)
  const showSearch = ref(false)
  const showAutoTurnPanel = ref(false)
  const currentPage = ref(1)
  const pageCount = ref(1)
  const autoTurnRunning = ref(false)
  const autoTurnPaused = ref(false)
  const autoTurnCountdown = ref(0)

  const handlers = {
    nextPage: null,
    prevPage: null,
    goToPage: null,
    jumpToPercent: null,
    scrollToOffset: null
  }

  function register(fns) {
    handlers.nextPage = fns.nextPage
    handlers.prevPage = fns.prevPage
    handlers.goToPage = fns.goToPage
    handlers.jumpToPercent = fns.jumpToPercent
    handlers.scrollToOffset = fns.scrollToOffset
  }

  function unregister() {
    handlers.nextPage = null
    handlers.prevPage = null
    handlers.goToPage = null
    handlers.jumpToPercent = null
    handlers.scrollToOffset = null
    currentPage.value = 1
    pageCount.value = 1
  }

  function nextPage() {
    return handlers.nextPage ? handlers.nextPage() : false
  }
  function prevPage() {
    return handlers.prevPage ? handlers.prevPage() : false
  }
  function guarded(handlerName, ...args) {
    if (handlers[handlerName] == null) return false
    return handlers[handlerName](...args)
  }
  function guardedNextPage() {
    return guarded('nextPage')
  }
  function guardedPrevPage() {
    return guarded('prevPage')
  }
  function goToPage(n) {
    handlers.goToPage?.(n)
  }
  function jumpToPercent(p) {
    handlers.jumpToPercent?.(p)
  }
  function scrollToOffset(off, ratio, options) {
    handlers.scrollToOffset?.(off, ratio, options)
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
  function toggleSearch() {
    const next = !showSearch.value
    showSearch.value = next
    if (next) {
      showToc.value = false
      showTypography.value = false
      showAutoTurnPanel.value = false
    }
  }
  function closeSearch() {
    showSearch.value = false
  }

  return {
    showToc,
    showTypography,
    showSearch,
    showAutoTurnPanel,
    currentPage,
    pageCount,
    autoTurnRunning,
    autoTurnPaused,
    autoTurnCountdown,
    register,
    unregister,
    nextPage,
    prevPage,
    guardedNextPage,
    guardedPrevPage,
    goToPage,
    jumpToPercent,
    scrollToOffset,
    toggleToc,
    closeToc,
    toggleTypography,
    closeTypography,
    toggleAutoTurnPanel,
    closeAutoTurnPanel,
    toggleSearch,
    closeSearch
  }
}

export function provideTxtReaderController() {
  const ctrl = useTxtReaderController()
  provide(CTRL_KEY, ctrl)
  return ctrl
}

export function injectTxtReaderController() {
  return inject(CTRL_KEY)
}
