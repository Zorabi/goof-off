import { createHash } from 'crypto'

const HAN_NUMERAL = '[一二三四五六七八九十百千万零〇两\\d]+'
const CJK_MAJOR_PATTERN = new RegExp(`^第${HAN_NUMERAL}[卷部篇集].*$`)
const CJK_MAJOR_PREFIX_PATTERN = new RegExp(`^[卷部篇集]${HAN_NUMERAL}.*$`)
const CJK_CHAPTER_PATTERN = new RegExp(`^第${HAN_NUMERAL}[章回幕].*$`)
const CJK_SECTION_PATTERN = new RegExp(`^第${HAN_NUMERAL}节.*$`)
const EN_MAJOR_PATTERN = /^(?:Book|Part)\s+[IVXLCDM\d]+(?:\b|[\s:.-]).*$/i
const EN_CHAPTER_PATTERN = /^Chapter\s+\d+(?:\b|[\s:.-]).*$/i
const EN_SECTION_PATTERN = /^Section\s+\d+(?:\b|[\s:.-]).*$/i
const NUMBERED_PATTERN = /^(?:(\d+(?:\.\d+)+)(?:[.、]?\s+|[.、]\s*)|(\d+)[.、]\s*).+$/
const CJK_LIST_PATTERN = /^[一二三四五六七八九十百千万零〇两]+、\s*.+$/

const PUNCTUATION_START = /^[，。！？、；：""''（）《》【】…—·,.!?;:'"()[\]{}]/
const SENTENCE_END = /[，。！？；：、.!?;:][」』"'）)]?$/

function makeId(title, charOffset) {
  return createHash('sha1')
    .update(title + charOffset)
    .digest('hex')
    .slice(0, 8)
}

function normalizeLevel(level) {
  if (!Number.isFinite(level)) return 1
  return Math.max(1, Math.min(4, Math.trunc(level)))
}

function classifyTitle(trimmed) {
  if (CJK_MAJOR_PATTERN.test(trimmed) || CJK_MAJOR_PREFIX_PATTERN.test(trimmed)) {
    return { kind: 'major', level: 1 }
  }
  if (CJK_CHAPTER_PATTERN.test(trimmed)) return { kind: 'chapter', level: 2 }
  if (CJK_SECTION_PATTERN.test(trimmed)) return { kind: 'section' }
  if (EN_MAJOR_PATTERN.test(trimmed)) return { kind: 'major', level: 1 }
  if (EN_CHAPTER_PATTERN.test(trimmed)) return { kind: 'chapter', level: 2 }
  if (EN_SECTION_PATTERN.test(trimmed)) return { kind: 'section' }

  const numbered = trimmed.match(NUMBERED_PATTERN)
  if (numbered) {
    const numericPrefix = numbered[1] || numbered[2]
    const depth = numericPrefix.split('.').length
    return { kind: 'numbered', level: normalizeLevel(depth + 1) }
  }

  if (CJK_LIST_PATTERN.test(trimmed)) return { kind: 'numbered', level: 3 }
  return null
}

export function detect(text) {
  if (!text) return []

  const lines = text.split('\n')
  const totalChars = text.length
  const densityThreshold = Math.max(totalChars / 500, 50)

  const regexHits = []
  const heuristicHits = []
  let charOffset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const lineStart = charOffset

    let matchedRegex = false
    if (trimmed.length > 0) {
      const classification = classifyTitle(trimmed)
      if (classification) {
        regexHits.push({ title: trimmed, charOffset: lineStart, ...classification })
        matchedRegex = true
      }

      if (
        !matchedRegex &&
        trimmed.length <= 30 &&
        !PUNCTUATION_START.test(trimmed) &&
        !SENTENCE_END.test(trimmed)
      ) {
        const hasPrev = i > 0
        const hasNext = i < lines.length - 1
        const prevBlank = hasPrev && lines[i - 1].trim() === ''
        const nextBlank = hasNext && lines[i + 1].trim() === ''
        if (prevBlank && nextBlank) {
          heuristicHits.push({ title: trimmed, charOffset: lineStart })
        }
      }
    }

    charOffset += line.length + (i < lines.length - 1 ? 1 : 0)
  }

  let candidates
  if (regexHits.length > 0) {
    candidates = regexHits
  } else if (heuristicHits.length > densityThreshold) {
    candidates = []
  } else {
    candidates = heuristicHits
  }

  candidates.sort((a, b) => a.charOffset - b.charOffset)

  const context = { hasChapterInCurrentMajor: false }

  return candidates.map((c) => {
    let level = c.level
    if (c.kind === 'major') {
      context.hasChapterInCurrentMajor = false
      level = 1
    } else if (c.kind === 'chapter') {
      context.hasChapterInCurrentMajor = true
      level = 2
    } else if (c.kind === 'section') {
      level = context.hasChapterInCurrentMajor ? 3 : 2
    }

    return {
      id: makeId(c.title, c.charOffset),
      title: c.title,
      charOffset: c.charOffset,
      level: normalizeLevel(level)
    }
  })
}
