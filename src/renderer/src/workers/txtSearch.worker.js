import { asciiLowerSlice } from '../composables/txtSearchCore.js'

export const TXT_SEARCH_CHUNK_SIZE = 512 * 1024
export const TXT_SEARCH_LIMIT = 500

function defaultYieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function emptyWindow() {
  return { items: [], hasBefore: false, hasAfter: false, beforeCursor: null, afterCursor: null }
}

function compareInitialCandidate(a, b, anchor) {
  return Math.abs(a - anchor) - Math.abs(b - anchor) || a - b
}

function isWorseInitialCandidate(a, b, anchor) {
  return compareInitialCandidate(a, b, anchor) > 0
}

function swap(heap, a, b) {
  const value = heap[a]
  heap[a] = heap[b]
  heap[b] = value
}

function bubbleUpWorstInitial(heap, index, anchor) {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (!isWorseInitialCandidate(heap[index], heap[parent], anchor)) return
    swap(heap, index, parent)
    index = parent
  }
}

function sinkWorstInitial(heap, index, anchor) {
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let worst = index
    if (left < heap.length && isWorseInitialCandidate(heap[left], heap[worst], anchor)) {
      worst = left
    }
    if (right < heap.length && isWorseInitialCandidate(heap[right], heap[worst], anchor)) {
      worst = right
    }
    if (worst === index) return
    swap(heap, index, worst)
    index = worst
  }
}

function rememberInitialHit(candidateHeap, offset, { anchor, limit }) {
  if (candidateHeap.length < limit) {
    candidateHeap.push(offset)
    bubbleUpWorstInitial(candidateHeap, candidateHeap.length - 1, anchor)
    return
  }
  if (compareInitialCandidate(offset, candidateHeap[0], anchor) < 0) {
    candidateHeap[0] = offset
    sinkWorstInitial(candidateHeap, 0, anchor)
  }
}

function forEachMatchInChunk(lowerChunk, lowerQuery, chunkBaseOffset, minHitOffset, onHit) {
  if (!lowerQuery) return true
  let idx = lowerChunk.indexOf(lowerQuery)
  while (idx !== -1) {
    const hitOffset = chunkBaseOffset + idx
    if (hitOffset >= minHitOffset && onHit(hitOffset) === false) return false
    idx = lowerChunk.indexOf(lowerQuery, idx + 1)
  }
  return true
}

function finishWindow(
  items,
  { firstHit = null, lastHit = null, hasBefore = false, hasAfter = false } = {}
) {
  const selected = [...items].sort((a, b) => a - b)
  const before = selected.length
    ? Boolean(hasBefore || (firstHit !== null && firstHit < selected[0]))
    : false
  const after = selected.length
    ? Boolean(hasAfter || (lastHit !== null && lastHit > selected.at(-1)))
    : false
  return {
    items: selected,
    hasBefore: before,
    hasAfter: after,
    beforeCursor: selected[0] ?? null,
    afterCursor: selected.at(-1) ?? null
  }
}

async function collectInitialWindowHits(activeText, lowerQuery, options) {
  const { chunkSize, seq, getActiveSeq, yieldToEventLoop } = options
  const limit = Math.max(0, Math.floor(options.limit || 0))
  const anchor = Number.isFinite(options.anchor) ? options.anchor : 0
  if (limit <= 0) return emptyWindow()

  const candidateHeap = []
  let firstHit = null
  let lastHit = null
  for (let from = 0; from < activeText.length; from += chunkSize) {
    if (seq !== getActiveSeq()) return null
    const to = Math.min(from + chunkSize + lowerQuery.length - 1, activeText.length)
    const lowerChunk = asciiLowerSlice(activeText, from, to)
    forEachMatchInChunk(lowerChunk, lowerQuery, from, from, (offset) => {
      if (firstHit === null) firstHit = offset
      lastHit = offset
      rememberInitialHit(candidateHeap, offset, { anchor, limit })
    })
    await yieldToEventLoop()
  }
  return finishWindow(candidateHeap, { firstHit, lastHit })
}

async function collectDirectionalWindowHits(activeText, lowerQuery, options) {
  const { chunkSize, cursor, direction, seq, getActiveSeq, yieldToEventLoop } = options
  const limit = Math.max(0, Math.floor(options.limit || 0))
  if (!Number.isFinite(cursor) || limit <= 0) return emptyWindow()

  const hits = []
  let hasBefore = direction === 'after'
  let hasAfter = direction === 'before'
  for (let from = 0; from < activeText.length; from += chunkSize) {
    if (seq !== getActiveSeq()) return null
    const to = Math.min(from + chunkSize + lowerQuery.length - 1, activeText.length)
    const lowerChunk = asciiLowerSlice(activeText, from, to)
    let reachedCursor = false
    let reachedLimit = false
    forEachMatchInChunk(lowerChunk, lowerQuery, from, from, (offset) => {
      if (direction === 'before') {
        if (offset >= cursor) {
          reachedCursor = true
          return false
        }
        hits.push(offset)
        if (hits.length > limit) {
          hits.shift()
          hasBefore = true
        }
        return true
      }
      if (offset <= cursor) {
        hasBefore = true
        return true
      }
      hits.push(offset)
      if (hits.length > limit) {
        hits.pop()
        hasAfter = true
        reachedLimit = true
        return false
      }
      return true
    })
    if (reachedCursor) return finishWindow(hits, { hasBefore, hasAfter: true })
    if (reachedLimit) return finishWindow(hits, { hasBefore, hasAfter })
    await yieldToEventLoop()
  }
  return finishWindow(hits, { hasBefore, hasAfter })
}

export function createTxtSearchWorkerScope(
  scope,
  { chunkSize = TXT_SEARCH_CHUNK_SIZE, yieldToEventLoop = defaultYieldToEventLoop } = {}
) {
  let activeSeq = 0
  let activeTextToken = null
  let activeText = ''

  scope.onmessage = async (event) => {
    const msg = event.data || {}

    if (msg.type === 'loadText') {
      if (msg.seq >= activeSeq) activeSeq = msg.seq
      activeTextToken = msg.textToken
      activeText = msg.text || ''
      return
    }

    if (msg.type === 'cancel') {
      if (msg.seq >= activeSeq) activeSeq = msg.seq
      return
    }

    if (msg.type === 'clearText') {
      if (msg.seq >= activeSeq) activeSeq = msg.seq
      activeTextToken = null
      activeText = ''
      return
    }

    if (msg.type === 'loadMore') {
      if (msg.seq < activeSeq) return
      const seq = msg.seq
      const limit = msg.limit || TXT_SEARCH_LIMIT
      const query = msg.query || ''
      if (!query || msg.textToken !== activeTextToken) {
        scope.postMessage({
          type: 'error',
          seq,
          requestId: msg.requestId,
          direction: msg.direction,
          reason: 'stale-text'
        })
        return
      }
      const lowerQuery = asciiLowerSlice(query, 0, query.length)
      const result = await collectDirectionalWindowHits(activeText, lowerQuery, {
        chunkSize,
        cursor: msg.cursor,
        direction: msg.direction,
        limit,
        seq,
        getActiveSeq: () => activeSeq,
        yieldToEventLoop
      })
      if (!result || seq !== activeSeq) return
      scope.postMessage({
        type: 'loadMoreResult',
        seq,
        requestId: msg.requestId,
        direction: msg.direction,
        hits: result.items,
        hasBefore: result.hasBefore,
        hasAfter: result.hasAfter,
        beforeCursor: result.beforeCursor,
        afterCursor: result.afterCursor,
        truncated: result.hasBefore || result.hasAfter
      })
      return
    }

    if (msg.type !== 'search') return
    if (msg.seq < activeSeq) return
    activeSeq = msg.seq

    const seq = msg.seq
    const limit = msg.limit || TXT_SEARCH_LIMIT
    const query = msg.query || ''
    if (!query || msg.textToken !== activeTextToken) {
      scope.postMessage({ type: 'error', seq, reason: 'stale-text' })
      return
    }

    const lowerQuery = asciiLowerSlice(query, 0, query.length)
    const result = await collectInitialWindowHits(activeText, lowerQuery, {
      chunkSize,
      limit,
      anchor: Number.isFinite(msg.anchorOffset) ? msg.anchorOffset : 0,
      seq,
      getActiveSeq: () => activeSeq,
      yieldToEventLoop
    })
    if (!result || seq !== activeSeq) return
    scope.postMessage({
      type: 'result',
      seq,
      hits: result.items,
      hasBefore: result.hasBefore,
      hasAfter: result.hasAfter,
      beforeCursor: result.beforeCursor,
      afterCursor: result.afterCursor,
      truncated: result.hasBefore || result.hasAfter
    })
  }
}

if (typeof self !== 'undefined') {
  createTxtSearchWorkerScope(self)
}
