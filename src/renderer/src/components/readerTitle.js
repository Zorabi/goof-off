function cleanText(value) {
  return String(value ?? '').trim()
}

function finiteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function firstText(values) {
  return values.find((value) => cleanText(value)) || ''
}

export function formatPageSummary(currentPage, pageCount) {
  const total = finiteNumber(pageCount)
  if (total == null || total <= 0) return ''

  const page = finiteNumber(currentPage) ?? 1
  const safeTotal = Math.max(1, Math.floor(total))
  const safePage = Math.max(1, Math.min(safeTotal, Math.floor(page)))
  return `${safePage} / ${safeTotal}`
}

export function formatPercentSummary(percentage) {
  const value = finiteNumber(percentage)
  if (value == null) return ''
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return `${pct}%`
}

export function resolveTxtChapterTitle(chapters = [], offset = 0) {
  const safeOffset = finiteNumber(offset)
  if (safeOffset == null || safeOffset < 0 || !Array.isArray(chapters)) return ''

  let current = null
  for (const chapter of chapters) {
    const title = cleanText(chapter?.title)
    const chapterOffset = finiteNumber(chapter?.charOffset)
    if (!title || chapterOffset == null || chapterOffset > safeOffset) continue
    if (!current || chapterOffset >= current.charOffset) {
      current = { title, charOffset: chapterOffset }
    }
  }

  return current?.title || ''
}

export function resolveReaderTitle({ fileKind, txt = {}, epub = {}, pdf = {} } = {}) {
  if (fileKind === 'txt') {
    return firstText([
      resolveTxtChapterTitle(txt.chapters, txt.offset),
      txt.displayName,
      formatPageSummary(txt.currentPage, txt.pageCount)
    ])
  }

  if (fileKind === 'epub') {
    return firstText([
      epub.currentChapterLabel,
      epub.displayName,
      formatPercentSummary(epub.percentage)
    ])
  }

  if (fileKind === 'pdf') {
    return firstText([pdf.displayName, formatPageSummary(pdf.currentPage, pdf.pageCount)])
  }

  return ''
}
