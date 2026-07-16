export const DEFAULT_FILE_VISUAL_PREFS = Object.freeze({
  gradientEnabled: false,
  gradientAngle: 135,
  gradientStops: ['#f6f6f6', '#eceff1'],
  textColor: null
})

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function isHexColor(value) {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

function normalizeHex(value) {
  return value.toLowerCase()
}

function isValidAngle(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 360
}

function normalizeStops(value) {
  if (!Array.isArray(value)) return [...DEFAULT_FILE_VISUAL_PREFS.gradientStops]
  if (value.length < 2 || value.length > 3) return [...DEFAULT_FILE_VISUAL_PREFS.gradientStops]
  if (!value.every(isHexColor)) return [...DEFAULT_FILE_VISUAL_PREFS.gradientStops]
  return value.map(normalizeHex)
}

function sanitizeStops(value) {
  if (!Array.isArray(value)) return undefined
  if (value.length < 2 || value.length > 3) return undefined
  if (!value.every(isHexColor)) return undefined
  return value.map(normalizeHex)
}

export function normalizeFileVisualPrefs(value) {
  if (!isPlainObject(value)) return { ...DEFAULT_FILE_VISUAL_PREFS }
  return {
    gradientEnabled:
      typeof value.gradientEnabled === 'boolean'
        ? value.gradientEnabled
        : DEFAULT_FILE_VISUAL_PREFS.gradientEnabled,
    gradientAngle: isValidAngle(value.gradientAngle)
      ? value.gradientAngle
      : DEFAULT_FILE_VISUAL_PREFS.gradientAngle,
    gradientStops: normalizeStops(value.gradientStops),
    textColor: isHexColor(value.textColor) ? normalizeHex(value.textColor) : null
  }
}

export function sanitizeFileVisualPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('gradientEnabled' in patch && typeof patch.gradientEnabled === 'boolean') {
    out.gradientEnabled = patch.gradientEnabled
  }
  if ('gradientAngle' in patch && isValidAngle(patch.gradientAngle)) {
    out.gradientAngle = patch.gradientAngle
  }
  if ('gradientStops' in patch) {
    const stops = sanitizeStops(patch.gradientStops)
    if (stops) out.gradientStops = stops
  }
  if ('textColor' in patch) {
    if (patch.textColor === null) out.textColor = null
    else if (isHexColor(patch.textColor)) out.textColor = normalizeHex(patch.textColor)
  }
  return out
}

function srgbToLinear(channel) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex) {
  const raw = hex.slice(1)
  const r = srgbToLinear(parseInt(raw.slice(0, 2), 16))
  const g = srgbToLinear(parseInt(raw.slice(2, 4), 16))
  const b = srgbToLinear(parseInt(raw.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function averageLuminance(stops) {
  return stops.reduce((sum, stop) => sum + relativeLuminance(stop), 0) / stops.length
}

function resolveEffectiveTextColor(prefs) {
  if (prefs.textColor) return prefs.textColor
  if (!prefs.gradientEnabled) return null
  return averageLuminance(prefs.gradientStops) >= 0.55 ? '#2a2a2a' : '#f2f2f2'
}

function buildSelectionCssVars({ hasCustomGradient, effectiveTextColor }) {
  if (!hasCustomGradient) {
    return {
      '--selection-bg': 'rgba(128, 128, 128, 0.18)',
      '--selection-bg-fallback': 'rgba(128, 128, 128, 0.18)',
      '--selection-bg-enhanced': 'color-mix(in srgb, currentColor 18%, transparent)',
      '--selection-text-shadow': 'none'
    }
  }
  const usesLightText = effectiveTextColor ? relativeLuminance(effectiveTextColor) >= 0.55 : false
  const mask = usesLightText ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.16)'
  return {
    '--selection-bg': mask,
    '--selection-bg-fallback': mask,
    '--selection-bg-enhanced': mask,
    '--selection-text-shadow': '0 0 0 currentColor'
  }
}

export function buildFileVisualState(rawPrefs) {
  const prefs = normalizeFileVisualPrefs(rawPrefs)
  const hasCustomGradient = prefs.gradientEnabled
  const effectiveTextColor = resolveEffectiveTextColor(prefs)
  return {
    hasCustomGradient,
    gradientCss: `linear-gradient(${prefs.gradientAngle}deg, ${prefs.gradientStops.join(', ')})`,
    effectiveTextColor,
    selectionCssVars: buildSelectionCssVars({ hasCustomGradient, effectiveTextColor })
  }
}
