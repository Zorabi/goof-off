import { computed } from 'vue'

const MAX_CHARS_PER_SEGMENT = 3000

export function useTxtParagraphs(txt) {
  const paragraphs = computed(() => {
    if (!txt.text.value) return []
    const parts = txt.text.value.split('\n')
    let off = 0
    const out = []
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i]
      if (line.length > MAX_CHARS_PER_SEGMENT) {
        splitLongLine(line, off, out)
      } else {
        out.push({ text: line, charOffset: off })
      }
      off += line.length + (i < parts.length - 1 ? 1 : 0)
    }
    return out
  })

  return { paragraphs }
}

function splitLongLine(line, baseOffset, out) {
  let pos = 0
  while (pos < line.length) {
    let end = Math.min(pos + MAX_CHARS_PER_SEGMENT, line.length)
    if (end < line.length) {
      const slice = line.slice(pos, end)
      const breakIdx = findBreakPoint(slice)
      if (breakIdx > 0) end = pos + breakIdx + 1
    }
    out.push({ text: line.slice(pos, end), charOffset: baseOffset + pos })
    pos = end
  }
}

function findBreakPoint(slice) {
  for (let i = slice.length - 1; i >= slice.length * 0.6; i--) {
    const ch = slice[i]
    if (ch === '。' || ch === '.' || ch === '！' || ch === '?' || ch === '？' || ch === '；') {
      return i
    }
  }
  for (let i = slice.length - 1; i >= slice.length * 0.6; i--) {
    const ch = slice[i]
    if (ch === '，' || ch === ',' || ch === '、') return i
  }
  return -1
}
