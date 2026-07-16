export function asciiLowerSlice(text, from = 0, to = text.length) {
  let out = ''
  const start = Math.max(0, from)
  const end = Math.min(text.length, to)
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i)
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i]
  }
  return out
}

export function findMatchesInChunk(
  lowerChunk,
  lowerQuery,
  chunkBaseOffset,
  minHitOffset,
  hits,
  limit
) {
  if (!lowerQuery || limit <= 0) return false
  let idx = lowerChunk.indexOf(lowerQuery)
  while (idx !== -1) {
    const hitOffset = chunkBaseOffset + idx
    if (hitOffset >= minHitOffset) {
      hits.push(hitOffset)
      if (hits.length >= limit) return true
    }
    idx = lowerChunk.indexOf(lowerQuery, idx + 1)
  }
  return false
}

function flattenSnippetPart(value) {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ')
}

export function buildSnippet(text, hitOffset, queryLength, contextChars = 30) {
  const start = Math.max(0, hitOffset - contextChars)
  const end = Math.min(text.length, hitOffset + queryLength + contextChars)
  return {
    before: flattenSnippetPart(text.slice(start, hitOffset)),
    match: text.slice(hitOffset, hitOffset + queryLength),
    after: flattenSnippetPart(text.slice(hitOffset + queryLength, end))
  }
}

export function findChapterForOffset(chapters, hitOffset) {
  let current = null
  for (const chapter of chapters || []) {
    if (chapter.charOffset <= hitOffset) current = chapter
    else break
  }
  return current
}

function findFirstOverlappingHit(sortedHits, paraStart, queryLength) {
  let lo = 0
  let hi = sortedHits.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedHits[mid] + queryLength <= paraStart) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function splitParagraphByHits(paragraph, sortedHits, queryLength, currentHitOffset) {
  const text = paragraph?.text || ''
  if (!text || !sortedHits?.length || queryLength <= 0) {
    return [{ text: text || ' ', highlighted: false, current: false }]
  }

  const paraStart = paragraph.charOffset || 0
  const paraEnd = paraStart + text.length
  const segments = []
  let cursor = 0
  let hitIndex = findFirstOverlappingHit(sortedHits, paraStart, queryLength)

  while (hitIndex < sortedHits.length) {
    const hitStart = sortedHits[hitIndex]
    const hitEnd = hitStart + queryLength
    if (hitStart >= paraEnd) break
    if (hitEnd <= paraStart) {
      hitIndex++
      continue
    }

    const localStart = Math.max(0, hitStart - paraStart)
    const localEnd = Math.min(text.length, hitEnd - paraStart)
    if (localStart > cursor) {
      segments.push({
        text: text.slice(cursor, localStart),
        highlighted: false,
        current: false
      })
    }
    if (localEnd > cursor) {
      const highlightStart = Math.max(cursor, localStart)
      segments.push({
        text: text.slice(highlightStart, localEnd),
        highlighted: true,
        current: hitStart === currentHitOffset
      })
      cursor = localEnd
    }
    hitIndex++
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false, current: false })
  }
  return segments.length ? segments : [{ text: text || ' ', highlighted: false, current: false }]
}
