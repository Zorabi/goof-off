import { asciiLowerSlice, findMatchesInChunk } from './txtSearchCore.js'

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'BLOCKQUOTE',
  'TD',
  'TH',
  'DT',
  'DD',
  'PRE',
  'FIGCAPTION',
  'SECTION',
  'ARTICLE',
  'ASIDE',
  'HEADER',
  'FOOTER'
])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE'])
const CHAPTER_CHUNK_SIZE = 512 * 1024

function defaultYieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function normalizedTagName(el) {
  return typeof el?.tagName === 'string' ? el.tagName.toUpperCase() : ''
}

function nearestBlockElement(node) {
  let el = node?.parentElement
  while (el && normalizedTagName(el) !== 'BODY') {
    if (BLOCK_TAGS.has(normalizedTagName(el))) return el
    el = el.parentElement
  }
  return node?.ownerDocument?.body || null
}

function hasSkippedAncestor(node) {
  let el = node?.parentElement
  while (el) {
    if (SKIP_TAGS.has(normalizedTagName(el))) return true
    el = el.parentElement
  }
  return false
}

function hasVisibleTextInSubtree(node) {
  if (!node) return false
  if (node.nodeType === 3) return /\S/.test(node.nodeValue || '')
  if (node.nodeType !== 1 || SKIP_TAGS.has(normalizedTagName(node))) return false
  return /\S/.test(node.textContent || '')
}

function hasInlineTextSibling(node, direction, block) {
  let cursor = direction < 0 ? node.previousSibling : node.nextSibling
  while (cursor) {
    if (cursor.nodeType === 1 && BLOCK_TAGS.has(normalizedTagName(cursor))) return false
    if (hasVisibleTextInSubtree(cursor)) return true
    cursor = direction < 0 ? cursor.previousSibling : cursor.nextSibling
  }
  const parent = node.parentElement
  if (!parent || parent === block) return false
  return hasInlineTextSibling(parent, direction, block)
}

function isFormattingWhitespace(node) {
  const value = node?.nodeValue || ''
  if (!value || /\S/.test(value)) return false
  const block = nearestBlockElement(node)
  if (!block || block === node.ownerDocument?.body) return true
  return !(hasInlineTextSibling(node, -1, block) && hasInlineTextSibling(node, 1, block))
}

function appendTextSegment(state, node, localStart, value) {
  if (!value) return
  state.nodes.push({
    node,
    start: state.text.length,
    localStart,
    length: value.length
  })
  state.text += value
}

export async function collectTextNodes(
  document,
  {
    shouldContinue = () => true,
    yieldToEventLoop = defaultYieldToEventLoop,
    batchNodeCount = 400,
    batchCharCount = 256 * 1024
  } = {}
) {
  const root = document?.body
  if (!root) return { text: '', nodes: [] }

  const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4
  const walker = document.createTreeWalker(root, showText, {
    acceptNode(node) {
      const value = node.nodeValue || ''
      if (!value || hasSkippedAncestor(node) || isFormattingWhitespace(node)) return 2
      return 1
    }
  })

  const state = { text: '', nodes: [] }
  let lastBlock = null
  let processedNodes = 0
  let processedChars = 0
  let node

  while ((node = walker.nextNode())) {
    if (!shouldContinue()) return null
    const block = nearestBlockElement(node)
    if (lastBlock && block !== lastBlock && state.text && !state.text.endsWith('\n')) {
      state.text += '\n'
    }
    lastBlock = block

    const raw = node.nodeValue || ''
    for (let localStart = 0; localStart < raw.length; localStart += batchCharCount) {
      if (!shouldContinue()) return null
      const part = raw.slice(localStart, localStart + batchCharCount)
      appendTextSegment(state, node, localStart, part)
      processedChars += part.length
      if (processedChars >= batchCharCount) {
        processedChars = 0
        await yieldToEventLoop()
      }
    }

    processedNodes++
    if (processedNodes >= batchNodeCount) {
      processedNodes = 0
      await yieldToEventLoop()
    }
  }

  return state
}

export function locateNodeAtOffset(nodes, offset) {
  if (!nodes?.length) return null
  let lo = 0
  let hi = nodes.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const item = nodes[mid]
    if (offset < item.start) hi = mid - 1
    else if (offset >= item.start + item.length) lo = mid + 1
    else return { node: item.node, localOffset: item.localStart + offset - item.start }
  }
  return null
}

export function rangeFromOffsets(document, nodes, hitOffset, queryLength) {
  const start = locateNodeAtOffset(nodes, hitOffset)
  const end = locateNodeAtOffset(nodes, hitOffset + queryLength - 1)
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.localOffset)
  range.setEnd(end.node, end.localOffset + 1)
  if (range.toString() === '') {
    range.toString = () => {
      const rangeEnd = hitOffset + queryLength
      return nodes
        .filter((item) => item.start < rangeEnd && item.start + item.length > hitOffset)
        .map((item) => {
          const startOffset = Math.max(hitOffset, item.start) - item.start + item.localStart
          const endOffset =
            Math.min(rangeEnd, item.start + item.length) - item.start + item.localStart
          return (item.node.nodeValue || '').slice(startOffset, endOffset)
        })
        .join('')
    }
  }
  return range
}

export function offsetFromDomPosition(nodes, targetNode, localOffset = 0) {
  if (!nodes?.length || !targetNode) return null
  for (const item of nodes) {
    if (item.node !== targetNode) continue
    const localStart = item.localStart ?? 0
    const localEnd = localStart + item.length
    if (localOffset < localStart || localOffset > localEnd) continue
    const clamped = Math.max(localStart, Math.min(localEnd, localOffset))
    return item.start + clamped - localStart
  }
  return null
}

export function compareEpubHitOrder(a, b) {
  return (
    (a.bookOffset ?? 0) - (b.bookOffset ?? 0) ||
    (a.spineIndex ?? 0) - (b.spineIndex ?? 0) ||
    (a.chapterOffset ?? 0) - (b.chapterOffset ?? 0) ||
    String(a.resultKey || '').localeCompare(String(b.resultKey || ''))
  )
}

export function makeEpubResultKey({ bookOffset, spineIndex, chapterOffset, href }) {
  return `${bookOffset}:${spineIndex}:${chapterOffset}:${href || ''}`
}

export async function scanChapterText(
  chapterText,
  lowerQuery,
  remaining,
  { shouldContinue = () => true, yieldToEventLoop = defaultYieldToEventLoop } = {}
) {
  if (!chapterText || !lowerQuery || remaining <= 0) return []
  const hits = []
  for (let from = 0; from < chapterText.length; from += CHAPTER_CHUNK_SIZE) {
    if (!shouldContinue()) return null
    const to = Math.min(from + CHAPTER_CHUNK_SIZE + lowerQuery.length - 1, chapterText.length)
    const lowerChunk = asciiLowerSlice(chapterText, from, to)
    findMatchesInChunk(lowerChunk, lowerQuery, from, from, hits, remaining)
    if (hits.length >= remaining) break
    await yieldToEventLoop()
  }
  return hits
}
