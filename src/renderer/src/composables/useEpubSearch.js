import { computed, inject, provide, ref, watch } from 'vue'
import {
  logDiagnostic as defaultLogDiagnostic,
  logDiagnosticError as defaultLogDiagnosticError
} from './useDiagnosticLog.js'
import { asciiLowerSlice, buildSnippet } from './txtSearchCore.js'
import {
  mergeWindowItems,
  selectAfterWindow,
  selectBeforeWindow,
  selectInitialWindow
} from './searchWindowModel.js'
import {
  collectTextNodes,
  compareEpubHitOrder,
  makeEpubResultKey,
  rangeFromOffsets,
  scanChapterText
} from './epubSearchCore.js'

const EPUB_SEARCH_KEY = Symbol('epubSearch')
const SEARCH_LIMIT = 500
const SEARCH_DEBOUNCE_MS = 300
const CFI_BATCH_SIZE = 50

function defaultYieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function loadedDocumentFrom(value) {
  if (value?.body) return value
  if (value?.ownerDocument?.body) return value.ownerDocument
  if (value?.document?.body) return value.document
  return null
}

function flattenToc(items = [], out = []) {
  for (const item of items) {
    out.push(item)
    if (item.subitems?.length) flattenToc(item.subitems, out)
  }
  return out
}

export function createEpubSearch({
  epub,
  ctrl,
  debounceMs = SEARCH_DEBOUNCE_MS,
  yieldToEventLoop = defaultYieldToEventLoop,
  logDiagnostic = defaultLogDiagnostic,
  logDiagnosticError = defaultLogDiagnosticError
}) {
  const query = ref('')
  const lastQuery = ref('')
  const results = ref([])
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
  const tocVersion = ref(0)

  let searchSeq = 0
  let debounceTimer = null
  let labelCache = new Map()
  let cheapHits = []
  let sectionMetrics = []
  let activeAnchorSnapshot = null
  let activeAnchorBookOffset = 0
  let loadRequestSeq = 0
  const pendingLoads = { before: null, after: null }

  const hitCount = computed(() => results.value.length)
  const currentHit = computed(() =>
    currentHitIndex.value >= 0 ? results.value[currentHitIndex.value] : null
  )
  const queryLength = computed(() => query.value.length)
  const active = computed(() =>
    Boolean(ctrl.showSearch?.value && query.value.length > 0 && results.value.length > 0)
  )

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

  function nearestResultIndex(anchorBookOffset, nextResults) {
    if (!nextResults.length) return -1
    let bestIndex = 0
    let bestDistance = Math.abs((nextResults[0].bookOffset ?? 0) - anchorBookOffset)
    for (let i = 1; i < nextResults.length; i++) {
      const distance = Math.abs((nextResults[i].bookOffset ?? 0) - anchorBookOffset)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    return bestIndex
  }

  function clearResults() {
    results.value = []
    currentHitIndex.value = -1
    truncated.value = false
    cheapHits = []
    sectionMetrics = []
    activeAnchorSnapshot = null
    activeAnchorBookOffset = 0
    resetWindowState()
  }

  function clearSearchState({ clearLastQuery = false } = {}) {
    query.value = ''
    clearResults()
    if (clearLastQuery) lastQuery.value = ''
  }

  function hasSearchState() {
    return (
      searching.value ||
      query.value.length > 0 ||
      results.value.length > 0 ||
      truncated.value ||
      currentHitIndex.value !== -1
    )
  }

  function cancelActive() {
    searchSeq++
    searching.value = false
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    resetWindowState()
  }

  function reset({ clearLastQuery = true } = {}) {
    cancelActive()
    clearSearchState({ clearLastQuery })
  }

  function canonical(href) {
    return epub.book.value?.canonical
      ? epub.book.value.canonical(href).split('#')[0]
      : href.split('#')[0]
  }

  function resolveLabel(section, spineIndex) {
    const key = `${tocVersion.value}:${canonical(section.href)}`
    if (labelCache.has(key)) return labelCache.get(key)
    const target = canonical(section.href)
    const item = flattenToc(epub.toc.value).find(
      (node) => node?.href && canonical(node.href) === target
    )
    const label = item?.label || `第 ${spineIndex + 1} 节`
    labelCache.set(key, label)
    return label
  }

  function isCurrentRenderedSection(section) {
    if (!ctrl.currentChapterHref?.value || !section?.href) return false
    return canonical(section.href) === ctrl.currentChapterHref.value
  }

  async function scanCheapHits({ book, lowerQuery, seq }) {
    const nextCheapHits = []
    const nextMetrics = []
    let bookStartOffset = 0
    let chapterErrorCount = 0
    for (let spineIndex = 0; spineIndex < book.spine.spineItems.length; spineIndex++) {
      if (seq !== searchSeq) return null
      const section = book.spine.spineItems[spineIndex]
      try {
        const doc = loadedDocumentFrom(await section.load(book.load.bind(book)))
        if (!doc || seq !== searchSeq) return null
        const collected = await collectTextNodes(doc, {
          shouldContinue: () => seq === searchSeq,
          yieldToEventLoop
        })
        if (!collected || seq !== searchSeq) return null
        const metric = {
          spineIndex,
          href: canonical(section.href),
          textLength: collected.text.length,
          bookStartOffset
        }
        nextMetrics.push(metric)
        const offsets = await scanChapterText(collected.text, lowerQuery, Number.MAX_SAFE_INTEGER, {
          shouldContinue: () => seq === searchSeq,
          yieldToEventLoop
        })
        if (!offsets || seq !== searchSeq) return null
        for (const chapterOffset of offsets) {
          const bookOffset = bookStartOffset + chapterOffset
          nextCheapHits.push({
            spineIndex,
            href: metric.href,
            chapterOffset,
            bookOffset,
            resultKey: makeEpubResultKey({
              bookOffset,
              spineIndex,
              chapterOffset,
              href: metric.href
            })
          })
        }
        bookStartOffset += collected.text.length
      } catch (error) {
        chapterErrorCount += 1
        logDiagnosticError('epub.search_error', error, { stage: 'chapter-load', spineIndex })
      } finally {
        if (!isCurrentRenderedSection(section)) section.unload?.()
      }
      await yieldToEventLoop()
    }
    nextCheapHits.sort(compareEpubHitOrder)
    return { cheapHits: nextCheapHits, sectionMetrics: nextMetrics, chapterErrorCount }
  }

  function resolveAnchorBookOffset(snapshot, metrics) {
    const snapshotSpineIndex = Number.isFinite(snapshot?.spineIndex) ? snapshot.spineIndex : null
    const snapshotHref = snapshot?.sectionHref ? canonical(snapshot.sectionHref) : ''
    const metric =
      (snapshotSpineIndex !== null &&
        snapshotHref &&
        metrics.find(
          (item) => item.spineIndex === snapshotSpineIndex && item.href === snapshotHref
        )) ||
      (snapshotSpineIndex !== null &&
        metrics.find((item) => item.spineIndex === snapshotSpineIndex)) ||
      (snapshotHref && metrics.find((item) => item.href === snapshotHref)) ||
      metrics[0]
    if (!metric) return 0
    const chapterOffset = Math.max(0, Math.min(metric.textLength, snapshot?.chapterOffset || 0))
    return metric.bookStartOffset + chapterOffset
  }

  async function materializeHits({ book, candidates, lowerQuery, queryLength, seq }) {
    const built = []
    const bySpine = new Map()
    for (const hit of candidates) {
      if (!bySpine.has(hit.spineIndex)) bySpine.set(hit.spineIndex, [])
      bySpine.get(hit.spineIndex).push(hit)
    }
    for (const [spineIndex, hitsForSection] of bySpine) {
      if (seq !== searchSeq) return null
      const section = book.spine.spineItems[spineIndex]
      try {
        const loaded = await section.load(book.load.bind(book))
        if (seq !== searchSeq) return null
        const doc = loadedDocumentFrom(loaded)
        if (!doc) throw new Error(`Unable to load EPUB search section ${spineIndex}`)
        const collected = await collectTextNodes(doc, {
          shouldContinue: () => seq === searchSeq,
          yieldToEventLoop
        })
        if (seq !== searchSeq) return null
        if (!collected) throw new Error(`Unable to collect EPUB search section ${spineIndex}`)
        const chapterLabel = resolveLabel(section, spineIndex)
        for (let i = 0; i < hitsForSection.length; i++) {
          if (seq !== searchSeq) return null
          const hit = hitsForSection[i]
          const range = rangeFromOffsets(doc, collected.nodes, hit.chapterOffset, queryLength)
          if (range) {
            try {
              built.push({
                ...hit,
                cfi: section.cfiFromRange(range),
                chapterLabel,
                snippet: buildSnippet(collected.text, hit.chapterOffset, queryLength),
                matchKey: `${hit.resultKey}:${lowerQuery}`
              })
            } catch {
              /* skip invalid hit */
            }
          }
          if ((i + 1) % CFI_BATCH_SIZE === 0) {
            await yieldToEventLoop()
            if (seq !== searchSeq) return null
          }
        }
      } finally {
        if (!isCurrentRenderedSection(section)) section?.unload?.()
      }
    }
    return built.sort(compareEpubHitOrder)
  }

  async function runSearch() {
    const q = query.value
    const book = epub.book.value
    if (!q || !book?.spine?.spineItems?.length) {
      clearResults()
      return
    }

    const seq = ++searchSeq
    let chapterErrorCount = 0
    let resultLogged = false
    const lowerQuery = asciiLowerSlice(q)
    logDiagnostic('epub.search_query', {
      queryLength: q.length,
      searchSeq: seq
    })
    searching.value = true
    clearResults()
    try {
      activeAnchorSnapshot = ctrl.searchAnchorSnapshot?.() || {
        spineIndex: null,
        sectionHref: '',
        currentCfi: '',
        chapterOffset: 0,
        anchorKnown: false
      }
      const scan = await scanCheapHits({ book, lowerQuery, seq })
      if (!scan || seq !== searchSeq) return
      cheapHits = scan.cheapHits
      sectionMetrics = scan.sectionMetrics
      chapterErrorCount = scan.chapterErrorCount
      activeAnchorBookOffset = resolveAnchorBookOffset(activeAnchorSnapshot, sectionMetrics)
      const initial = selectInitialWindow(cheapHits, {
        anchor: activeAnchorBookOffset,
        limit: SEARCH_LIMIT,
        getValue: (hit) => hit.bookOffset,
        getKey: (hit) => hit.resultKey
      })
      const built = await materializeHits({
        book,
        candidates: initial.items,
        lowerQuery,
        queryLength: q.length,
        seq
      })
      if (!built || seq !== searchSeq) return
      results.value = built
      hasBefore.value = initial.hasBefore
      hasAfter.value = initial.hasAfter
      beforeCursor.value = initial.beforeCursor
      afterCursor.value = initial.afterCursor
      truncated.value = hasBefore.value || hasAfter.value
      currentHitIndex.value = nearestResultIndex(activeAnchorBookOffset, built)
      if (currentHitIndex.value >= 0) markNavigation('initial')
      if (seq !== searchSeq) return
      logDiagnostic(
        'epub.search_result',
        {
          queryLength: q.length,
          hitCount: results.value.length,
          truncated: truncated.value,
          searchSeq: seq,
          chapterErrorCount
        },
        truncated.value || chapterErrorCount > 0 ? 'warn' : 'info'
      )
      resultLogged = true
    } catch (error) {
      if (seq !== searchSeq) return
      logDiagnosticError('epub.search_error', error, { stage: 'search' })
      clearResults()
      logDiagnostic(
        'epub.search_result',
        {
          queryLength: q.length,
          hitCount: 0,
          truncated: false,
          searchSeq: seq,
          chapterErrorCount
        },
        'warn'
      )
      resultLogged = true
    } finally {
      if (seq === searchSeq) {
        searching.value = false
        if (!resultLogged && results.value.length === 0) {
          logDiagnostic(
            'epub.search_result',
            {
              queryLength: q.length,
              hitCount: 0,
              truncated: false,
              searchSeq: seq,
              chapterErrorCount
            },
            chapterErrorCount > 0 ? 'warn' : 'info'
          )
        }
      }
    }
  }

  function setQuery(value) {
    query.value = value
    lastQuery.value = value
    cancelActive()
    clearResults()
    if (!value) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      runSearch()
    }, debounceMs)
  }

  async function goToHit(index) {
    if (!results.value.length) {
      logDiagnostic(
        'epub.search_jump',
        {
          index,
          hitCount: 0,
          ok: false,
          reason: 'no-hit'
        },
        'warn'
      )
      return false
    }
    const nextIndex = ((index % results.value.length) + results.value.length) % results.value.length
    const hit = results.value[nextIndex]
    const seq = searchSeq
    let ok = false
    try {
      ok = await ctrl.guardedDisplayCfi?.(hit.cfi)
    } catch (error) {
      logDiagnosticError('epub.search_error', error, {
        stage: 'display-cfi'
      })
      logDiagnostic(
        'epub.search_jump',
        {
          index: nextIndex,
          hitCount: results.value.length,
          ok: false,
          reason: 'display-cfi'
        },
        'warn'
      )
      return false
    }
    if (!ok) {
      logDiagnostic(
        'epub.search_jump',
        {
          index: nextIndex,
          hitCount: results.value.length,
          ok: false,
          reason: 'display-failed'
        },
        'warn'
      )
      return false
    }
    const currentResult = results.value[nextIndex]
    if (
      seq !== searchSeq ||
      currentResult?.cfi !== hit.cfi ||
      currentResult?.matchKey !== hit.matchKey
    ) {
      logDiagnostic(
        'epub.search_jump',
        {
          index: nextIndex,
          hitCount: results.value.length,
          ok: false,
          reason: 'stale'
        },
        'warn'
      )
      return false
    }
    currentHitIndex.value = nextIndex
    logDiagnostic('epub.search_jump', {
      index: nextIndex,
      hitCount: results.value.length,
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
    const cursorKey = direction === 'before' ? beforeCursor.value : afterCursor.value
    if (cursorKey == null || !query.value || !epub.book.value) {
      return Promise.resolve({ ok: false, reason: 'no-cursor' })
    }
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
    ;(async () => {
      try {
        const selected =
          direction === 'before'
            ? selectBeforeWindow(cheapHits, {
                cursorKey,
                limit: SEARCH_LIMIT,
                getKey: (hit) => hit.resultKey
              })
            : selectAfterWindow(cheapHits, {
                cursorKey,
                limit: SEARCH_LIMIT,
                getKey: (hit) => hit.resultKey
              })
        const built = await materializeHits({
          book: epub.book.value,
          candidates: selected.items,
          lowerQuery: asciiLowerSlice(query.value),
          queryLength: query.value.length,
          seq
        })
        if (seq !== searchSeq || pendingLoads[direction]?.requestId !== requestId) return
        if (!built) throw new Error(`EPUB search load-${direction} materialization returned null`)
        const merge = mergeWindowItems(results.value, built, {
          direction,
          currentHitIndex: currentHitIndex.value,
          getKey: (hit) => hit.resultKey
        })
        results.value = merge.items
        currentHitIndex.value = merge.currentHitIndex
        if (direction === 'before') {
          loadingBefore.value = false
          hasBefore.value = Boolean(selected.hasBefore)
          beforeCursor.value = selected.beforeCursor ?? beforeCursor.value
        } else {
          loadingAfter.value = false
          hasAfter.value = Boolean(selected.hasAfter)
          afterCursor.value = selected.afterCursor ?? afterCursor.value
        }
        truncated.value = hasBefore.value || hasAfter.value
        if (merge.indexShifted) markNavigation('index-shift')
        pendingLoads[direction] = null
        nextPending.resolve({ ok: true, addedCount: merge.addedCount })
      } catch (error) {
        if (seq === searchSeq && pendingLoads[direction]?.requestId === requestId) {
          if (direction === 'before') {
            loadingBefore.value = false
            loadBeforeFailed.value = true
          } else {
            loadingAfter.value = false
            loadAfterFailed.value = true
          }
          pendingLoads[direction] = null
          logDiagnosticError('epub.search_error', error, { stage: `load-${direction}` })
          nextPending.resolve({ ok: false, reason: 'load-failed' })
        }
      }
    })()

    return promise
  }

  const loadBefore = () => loadMore('before')
  const loadAfter = () => loadMore('after')

  async function nextHit() {
    if (!results.value.length) return false
    if (currentHitIndex.value >= results.value.length - 1) {
      if (hasAfter.value) {
        const oldLength = results.value.length
        const loaded = await loadAfter()
        if (!loaded.ok) return false
        if (loaded.addedCount > 0) return goToHit(oldLength)
        if (hasAfter.value) return false
      }
      return goToHit(0)
    }
    return goToHit(currentHitIndex.value < 0 ? 0 : currentHitIndex.value + 1)
  }

  async function prevHit() {
    if (!results.value.length) return false
    if (currentHitIndex.value <= 0) {
      if (hasBefore.value) {
        const loaded = await loadBefore()
        if (!loaded.ok) return false
        if (loaded.addedCount > 0) return goToHit(loaded.addedCount - 1)
        if (hasBefore.value) return false
      }
      return goToHit(results.value.length - 1)
    }
    return goToHit(currentHitIndex.value - 1)
  }

  function dispose() {
    reset({ clearLastQuery: true })
  }

  watch(
    () => epub.fileId.value,
    () => {
      ctrl.closeSearch?.()
      reset({ clearLastQuery: true })
    }
  )

  watch(
    () => epub.toc.value,
    () => {
      tocVersion.value++
      labelCache = new Map()
      if (!results.value.length || !epub.book.value?.spine?.spineItems?.length) return
      results.value = results.value.map((hit) => {
        const section = epub.book.value.spine.spineItems[hit.spineIndex]
        return section ? { ...hit, chapterLabel: resolveLabel(section, hit.spineIndex) } : hit
      })
    }
  )

  if (ctrl.showSearch) {
    watch(
      () => ctrl.showSearch.value,
      (open) => {
        logDiagnostic('epub.search_panel', {
          open: Boolean(open),
          source: 'main-window'
        })
        if (open) {
          if (lastQuery.value && !query.value) setQuery(lastQuery.value)
          return
        }
        if (hasSearchState()) reset({ clearLastQuery: false })
      },
      { flush: 'sync' }
    )
  }

  return {
    query,
    lastQuery,
    results,
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
    tocVersion,
    hitCount,
    currentHit,
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

export function provideEpubSearch(options) {
  const search = createEpubSearch(options)
  provide(EPUB_SEARCH_KEY, search)
  return search
}

export function injectEpubSearch() {
  return inject(EPUB_SEARCH_KEY, null)
}
