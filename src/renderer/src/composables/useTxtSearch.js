import { computed, inject, provide, ref, watch } from 'vue'
import {
  logDiagnostic as defaultLogDiagnostic,
  logDiagnosticError as defaultLogDiagnosticError
} from './useDiagnosticLog.js'
import { findIndexAtOffset } from './useVirtualScroll.js'
import { mergeWindowItems } from './searchWindowModel.js'
import { useTxtParagraphs } from './useTxtParagraphs.js'

const TXT_SEARCH_KEY = Symbol('txtSearch')
const SEARCH_LIMIT = 500
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_JUMP_TOP_CONTEXT_LINES = 3

export async function createTxtSearchWorker() {
  const WorkerClass = (await import('../workers/txtSearch.worker.js?worker')).default
  return new WorkerClass()
}

function resolveWorkerResult(workerOrPromise) {
  return Promise.resolve(workerOrPromise)
}

export function createTxtSearch({
  txt,
  ctrl,
  pushStatus,
  createWorker = createTxtSearchWorker,
  debounceMs = SEARCH_DEBOUNCE_MS,
  logDiagnostic = defaultLogDiagnostic,
  logDiagnosticError = defaultLogDiagnosticError
}) {
  const { paragraphs } = useTxtParagraphs(txt)
  const query = ref('')
  const lastQuery = ref('')
  const hits = ref([])
  const currentHitIndex = ref(-1)
  const searching = ref(false)
  const truncated = ref(false)
  const hasBefore = ref(false)
  const hasAfter = ref(false)
  const beforeCursor = ref(null)
  const afterCursor = ref(null)
  const loadingBefore = ref(false)
  const loadingAfter = ref(false)
  const loadBeforeFailed = ref(false)
  const loadAfterFailed = ref(false)
  const navigationIntent = ref({ id: 0, reason: 'none' })
  const textVersion = ref(0)

  let worker = null
  let workerPromise = null
  let loadedTextToken = null
  let searchSeq = 0
  let debounceTimer = null
  let workerUnavailableNotified = false
  let activeAnchorSnapshot = null
  let loadRequestSeq = 0
  const pendingLoads = {
    before: null,
    after: null
  }

  const hitCount = computed(() => hits.value.length)
  const currentHitOffset = computed(() =>
    currentHitIndex.value >= 0 ? hits.value[currentHitIndex.value] : null
  )
  const queryLength = computed(() => query.value.length)
  const active = computed(() =>
    Boolean(ctrl.showSearch?.value && query.value.length > 0 && hits.value.length > 0)
  )

  function makeTextToken() {
    return `${txt.fileId.value || 'none'}:${txt.encoding.value}:${textVersion.value}`
  }

  function markNavigation(reason) {
    navigationIntent.value = { id: navigationIntent.value.id + 1, reason }
  }

  function resetWindowState() {
    const pendingBefore = pendingLoads.before
    const pendingAfter = pendingLoads.after
    hasBefore.value = false
    hasAfter.value = false
    beforeCursor.value = null
    afterCursor.value = null
    loadingBefore.value = false
    loadingAfter.value = false
    loadBeforeFailed.value = false
    loadAfterFailed.value = false
    pendingLoads.before = null
    pendingLoads.after = null
    pendingBefore?.resolve?.({ ok: false, reason: 'cancelled' })
    pendingAfter?.resolve?.({ ok: false, reason: 'cancelled' })
  }

  function nearestHitIndex(anchorOffset, nextHits) {
    if (!nextHits.length) return -1
    let bestIndex = 0
    let bestDistance = Math.abs(nextHits[0] - anchorOffset)
    for (let i = 1; i < nextHits.length; i++) {
      const distance = Math.abs(nextHits[i] - anchorOffset)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    return bestIndex
  }

  function clearSearchResults({ resetWindow = true } = {}) {
    searching.value = false
    hits.value = []
    truncated.value = false
    currentHitIndex.value = -1
    activeAnchorSnapshot = null
    if (resetWindow) resetWindowState()
  }

  function clearSearchState({ clearLastQuery = false } = {}) {
    query.value = ''
    clearSearchResults()
    if (clearLastQuery) lastQuery.value = ''
  }

  function hasSearchState() {
    return (
      searching.value ||
      query.value.length > 0 ||
      hits.value.length > 0 ||
      truncated.value ||
      currentHitIndex.value !== -1
    )
  }

  function markWorkerUnavailable() {
    const failedWorker = worker
    failedWorker?.removeEventListener?.('message', onWorkerMessage)
    failedWorker?.removeEventListener?.('error', onWorkerError)
    failedWorker?.removeEventListener?.('messageerror', onWorkerError)
    failedWorker?.terminate?.()
    worker = null
    workerPromise = null
    loadedTextToken = null
    clearSearchState({ clearLastQuery: true })
    if (!workerUnavailableNotified) {
      workerUnavailableNotified = true
      pushStatus?.('搜索暂不可用')
    }
  }

  async function ensureWorker() {
    if (worker) return worker
    if (!workerPromise) {
      workerPromise = resolveWorkerResult(createWorker())
        .then((w) => {
          worker = w
          worker.addEventListener('message', onWorkerMessage)
          worker.addEventListener?.('error', onWorkerError)
          worker.addEventListener?.('messageerror', onWorkerError)
          workerUnavailableNotified = false
          return worker
        })
        .catch((error) => {
          worker = null
          workerPromise = null
          loadedTextToken = null
          logDiagnosticError('txt.search_error', error, { stage: 'worker-create' })
          throw error
        })
    }
    return workerPromise
  }

  function postToWorker(message, { notifyOnFailure = false } = {}) {
    if (!worker && !workerPromise && message.type !== 'search' && message.type !== 'loadText') {
      return Promise.resolve(false)
    }
    if (worker) {
      try {
        worker.postMessage(message)
        return Promise.resolve(true)
      } catch {
        if (notifyOnFailure) markWorkerUnavailable()
        return Promise.resolve(false)
      }
    }
    return ensureWorker()
      .then((w) => {
        w.postMessage(message)
        return true
      })
      .catch(() => {
        if (notifyOnFailure) markWorkerUnavailable()
        return false
      })
  }

  function cancelActive() {
    searchSeq++
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    searching.value = false
    resetWindowState()
    postToWorker({ type: 'cancel', seq: searchSeq })
  }

  async function loadTextIfNeeded(token) {
    if (loadedTextToken === token) return true
    try {
      const w = await ensureWorker()
      loadedTextToken = token
      w.postMessage({
        type: 'loadText',
        seq: searchSeq,
        textToken: token,
        text: txt.text.value || ''
      })
      return true
    } catch {
      markWorkerUnavailable()
      return false
    }
  }

  async function runSearch() {
    const q = query.value
    if (!q || !txt.text.value) {
      clearSearchResults()
      return
    }
    const seq = ++searchSeq
    const textToken = makeTextToken()
    activeAnchorSnapshot = {
      offset: Number.isFinite(txt.offset.value) ? txt.offset.value : 0
    }
    logDiagnostic('txt.search_query', {
      queryLength: q.length,
      searchSeq: seq
    })
    searching.value = true
    resetWindowState()
    hits.value = []
    truncated.value = false
    currentHitIndex.value = -1
    const loaded = await loadTextIfNeeded(textToken)
    if (!loaded) return
    if (seq !== searchSeq) return
    await postToWorker(
      {
        type: 'search',
        seq,
        textToken,
        query: q,
        limit: SEARCH_LIMIT,
        anchorOffset: activeAnchorSnapshot.offset
      },
      { notifyOnFailure: true }
    )
  }

  function setQuery(value) {
    query.value = value
    lastQuery.value = value
    cancelActive()
    clearSearchResults({ resetWindow: false })
    if (!value) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      runSearch()
    }, debounceMs)
  }

  function onWorkerMessage(event) {
    const msg = event.data || {}
    if (msg.seq !== searchSeq) return
    if (msg.type === 'result') {
      searching.value = false
      const nextHits = Array.isArray(msg.hits) ? [...msg.hits].sort((a, b) => a - b) : []
      hits.value = nextHits
      hasBefore.value = Boolean(msg.hasBefore)
      hasAfter.value = Boolean(msg.hasAfter)
      beforeCursor.value = msg.beforeCursor ?? nextHits[0] ?? null
      afterCursor.value = msg.afterCursor ?? nextHits.at(-1) ?? null
      truncated.value = Boolean(msg.truncated || hasBefore.value || hasAfter.value)
      currentHitIndex.value = nearestHitIndex(activeAnchorSnapshot?.offset ?? 0, nextHits)
      if (currentHitIndex.value >= 0) markNavigation('initial')
      logDiagnostic('txt.search_result', {
        queryLength: query.value.length,
        hitCount: hits.value.length,
        truncated: truncated.value,
        searchSeq
      })
      return
    }
    if (msg.type === 'error' && msg.requestId && msg.direction) {
      const pending = pendingLoads[msg.direction]
      if (!pending || pending.requestId !== msg.requestId) return
      pendingLoads[msg.direction] = null
      if (msg.direction === 'before') {
        loadingBefore.value = false
        loadBeforeFailed.value = true
      } else {
        loadingAfter.value = false
        loadAfterFailed.value = true
      }
      pending.resolve({ ok: false, reason: msg.reason || 'load-failed' })
      return
    }
    if (msg.type === 'loadMoreResult') {
      const pending = pendingLoads[msg.direction]
      if (!pending || pending.requestId !== msg.requestId) return
      pendingLoads[msg.direction] = null
      if (msg.direction === 'before') loadingBefore.value = false
      else loadingAfter.value = false
      const merge = mergeWindowItems(hits.value, msg.hits || [], {
        direction: msg.direction,
        currentHitIndex: currentHitIndex.value,
        getKey: (offset) => offset
      })
      hits.value = merge.items
      currentHitIndex.value = merge.currentHitIndex
      if (msg.direction === 'before') hasBefore.value = Boolean(msg.hasBefore)
      else hasAfter.value = Boolean(msg.hasAfter)
      beforeCursor.value = hits.value[0] ?? null
      afterCursor.value = hits.value.at(-1) ?? null
      truncated.value = hasBefore.value || hasAfter.value
      if (merge.indexShifted) markNavigation('index-shift')
      pending.resolve({ ok: true, addedCount: merge.addedCount })
      return
    }
    if (msg.type === 'error') {
      searching.value = false
      clearSearchResults()
      logDiagnosticError('txt.search_error', msg.error || new Error('worker search failed'), {
        stage: 'worker-message'
      })
    }
  }

  function onWorkerError(error) {
    logDiagnosticError('txt.search_error', error?.error || error || new Error('worker error'), {
      stage: 'worker-error'
    })
    markWorkerUnavailable()
  }

  function goToHit(index) {
    if (!hits.value.length || !paragraphs.value.length) {
      logDiagnostic(
        'txt.search_jump',
        {
          index,
          hitCount: hits.value.length,
          ok: false,
          reason: 'no-hit'
        },
        'warn'
      )
      return false
    }
    const nextIndex = ((index % hits.value.length) + hits.value.length) % hits.value.length
    const hitOffset = hits.value[nextIndex]
    const paraIndex = findIndexAtOffset(paragraphs.value, hitOffset)
    const para = paragraphs.value[paraIndex]
    if (!para) {
      logDiagnostic(
        'txt.search_jump',
        {
          index: nextIndex,
          hitCount: hits.value.length,
          ok: false,
          reason: 'paragraph-not-found'
        },
        'warn'
      )
      return false
    }
    currentHitIndex.value = nextIndex
    const ratio = para.text.length ? (hitOffset - para.charOffset) / para.text.length : 0
    ctrl.scrollToOffset(para.charOffset, Math.max(0, Math.min(1, ratio)), {
      topContextLines: SEARCH_JUMP_TOP_CONTEXT_LINES
    })
    logDiagnostic('txt.search_jump', {
      index: nextIndex,
      hitCount: hits.value.length,
      ok: true
    })
    markNavigation('explicit')
    return true
  }

  function loadMore(direction) {
    const pending = pendingLoads[direction]
    if (direction === 'before') {
      if (!hasBefore.value) return Promise.resolve({ ok: false, reason: 'no-more' })
      if (loadingBefore.value) {
        return pending?.promise ?? Promise.resolve({ ok: false, reason: 'load-state-mismatch' })
      }
    }
    if (direction === 'after') {
      if (!hasAfter.value) return Promise.resolve({ ok: false, reason: 'no-more' })
      if (loadingAfter.value) {
        return pending?.promise ?? Promise.resolve({ ok: false, reason: 'load-state-mismatch' })
      }
    }
    const cursor = direction === 'before' ? beforeCursor.value : afterCursor.value
    if (cursor == null || !query.value) return Promise.resolve({ ok: false, reason: 'no-cursor' })
    const seq = searchSeq
    const requestId = `${direction}:${++loadRequestSeq}`
    if (direction === 'before') {
      loadingBefore.value = true
      loadBeforeFailed.value = false
    } else {
      loadingAfter.value = true
      loadAfterFailed.value = false
    }
    const nextPending = { requestId, promise: null, resolve: null }
    const promise = new Promise((resolve) => {
      nextPending.resolve = resolve
    })
    nextPending.promise = promise
    pendingLoads[direction] = nextPending
    postToWorker({
      type: 'loadMore',
      seq,
      requestId,
      textToken: makeTextToken(),
      query: query.value,
      direction,
      cursor,
      limit: SEARCH_LIMIT
    }).then((posted) => {
      if (posted) return
      const pending = pendingLoads[direction]
      if (!pending || pending.requestId !== requestId || seq !== searchSeq) return
      if (direction === 'before') {
        loadingBefore.value = false
        loadBeforeFailed.value = true
      } else {
        loadingAfter.value = false
        loadAfterFailed.value = true
      }
      pendingLoads[direction] = null
      pending.resolve({ ok: false, reason: 'post-failed' })
    })
    return promise
  }

  const loadBefore = () => loadMore('before')
  const loadAfter = () => loadMore('after')

  async function nextHit() {
    if (!hits.value.length) return false
    if (currentHitIndex.value >= hits.value.length - 1 && hasAfter.value) {
      const oldLength = hits.value.length
      const loaded = await loadAfter()
      if (!loaded.ok || loaded.addedCount <= 0) return false
      return goToHit(oldLength)
    }
    return goToHit(currentHitIndex.value < 0 ? 0 : currentHitIndex.value + 1)
  }

  async function prevHit() {
    if (!hits.value.length) return false
    if ((currentHitIndex.value <= 0 || currentHitIndex.value < 0) && hasBefore.value) {
      const loaded = await loadBefore()
      if (!loaded.ok || loaded.addedCount <= 0) return false
      return goToHit(loaded.addedCount - 1)
    }
    return goToHit(currentHitIndex.value < 0 ? hits.value.length - 1 : currentHitIndex.value - 1)
  }

  async function reset({ clearWorkerText = false, clearLastQuery = clearWorkerText } = {}) {
    cancelActive()
    clearSearchState({ clearLastQuery })
    if (clearWorkerText) {
      loadedTextToken = null
      await postToWorker({ type: 'clearText', seq: searchSeq })
    }
  }

  function resetForTextLifecycle() {
    reset({ clearWorkerText: true })
    ctrl.closeSearch?.()
  }

  function dispose() {
    cancelActive()
    if (worker) {
      worker.removeEventListener?.('message', onWorkerMessage)
      worker.removeEventListener?.('error', onWorkerError)
      worker.removeEventListener?.('messageerror', onWorkerError)
      worker.terminate?.()
    }
    worker = null
    workerPromise = null
    loadedTextToken = null
  }

  watch(
    () => txt.text.value,
    () => {
      textVersion.value++
      resetForTextLifecycle()
    }
  )

  watch(
    () => txt.fileId.value,
    () => resetForTextLifecycle()
  )

  watch(
    () => txt.encoding.value,
    () => resetForTextLifecycle()
  )

  if (ctrl.showSearch) {
    watch(
      () => ctrl.showSearch.value,
      (open) => {
        logDiagnostic('txt.search_panel', {
          open: Boolean(open),
          source: 'main-window'
        })
        if (open) {
          if (lastQuery.value && !query.value) setQuery(lastQuery.value)
          return
        }
        if (hasSearchState()) reset({ clearWorkerText: false, clearLastQuery: false })
      },
      { flush: 'sync' }
    )
  }

  return {
    query,
    lastQuery,
    hits,
    currentHitIndex,
    searching,
    truncated,
    hasBefore,
    hasAfter,
    beforeCursor,
    afterCursor,
    loadingBefore,
    loadingAfter,
    loadBeforeFailed,
    loadAfterFailed,
    navigationIntent,
    textVersion,
    hitCount,
    currentHitOffset,
    queryLength,
    active,
    setQuery,
    runSearch,
    goToHit,
    nextHit,
    prevHit,
    loadBefore,
    loadAfter,
    reset,
    dispose
  }
}

export function provideTxtSearch(options) {
  const search = createTxtSearch(options)
  provide(TXT_SEARCH_KEY, search)
  return search
}

export function injectTxtSearch() {
  return inject(TXT_SEARCH_KEY)
}
