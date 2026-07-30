export const DEFAULT_PDF_COLOR_PREFS = Object.freeze({
  backgroundColor: '#000000',
  textColor: '#ffffff'
})

const OPAQUE_HEX_COLOR = /^#[0-9a-f]{6}$/i
const LUMINANCE = Object.freeze([0.2126, 0.7152, 0.0722])

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizePdfColor(value, fallback = null) {
  if (typeof value === 'string' && OPAQUE_HEX_COLOR.test(value)) return value.toLowerCase()
  if (typeof fallback === 'string' && OPAQUE_HEX_COLOR.test(fallback)) {
    return fallback.toLowerCase()
  }
  return null
}

export function normalizePdfColorPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    backgroundColor: normalizePdfColor(
      source.backgroundColor,
      DEFAULT_PDF_COLOR_PREFS.backgroundColor
    ),
    textColor: normalizePdfColor(source.textColor, DEFAULT_PDF_COLOR_PREFS.textColor)
  }
}

export function sanitizePdfColorPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  for (const key of ['backgroundColor', 'textColor']) {
    if (!(key in patch)) continue
    const color = normalizePdfColor(patch[key])
    if (color) out[key] = color
  }
  return out
}

function parseColor(value) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
}

function formatMatrixValue(value) {
  const rounded = Number(value.toFixed(6))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export function createPdfDuotoneMatrix(value) {
  const colors = normalizePdfColorPrefs(value)
  const background = parseColor(colors.backgroundColor)
  const text = parseColor(colors.textColor)
  const rows = []

  for (let channel = 0; channel < 3; channel += 1) {
    const delta = background[channel] - text[channel]
    rows.push(delta * LUMINANCE[0], delta * LUMINANCE[1], delta * LUMINANCE[2], 0, text[channel])
  }
  rows.push(0, 0, 0, 1, 0)

  return rows.map(formatMatrixValue).join(' ')
}
