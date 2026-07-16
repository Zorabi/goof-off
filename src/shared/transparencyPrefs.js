export const DEFAULT_TRANSPARENCY_PREFS = Object.freeze({
  merged: false,
  windowEnabled: false,
  contentEnabled: false,
  windowLevel: 0.7,
  contentLevel: 0.6
})

const BOOLEAN_KEYS = ['merged', 'windowEnabled', 'contentEnabled']

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function sanitizeTransparencyPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  for (const key of BOOLEAN_KEYS) {
    if (key in patch && typeof patch[key] === 'boolean') out[key] = patch[key]
  }
  if ('windowLevel' in patch && isFiniteNumber(patch.windowLevel)) {
    out.windowLevel = clamp(patch.windowLevel, 0.1, 0.95)
  }
  if ('contentLevel' in patch && isFiniteNumber(patch.contentLevel)) {
    out.contentLevel = clamp(patch.contentLevel, 0, 0.95)
  }
  return out
}

export function normalizeTransparencyPrefs(value) {
  const clean = sanitizeTransparencyPrefsPatch(value)
  const next = { ...DEFAULT_TRANSPARENCY_PREFS, ...clean }
  if (next.merged) next.contentEnabled = next.windowEnabled
  return next
}

export function resolveEffectiveOpacity(prefs) {
  const safe = normalizeTransparencyPrefs(prefs)
  const shellBackgroundHidden = safe.windowEnabled
  const interfaceOpacity = safe.windowEnabled && safe.contentEnabled ? safe.contentLevel : 1
  return {
    windowOpacity: 1,
    shellBackgroundHidden,
    interfaceOpacity,
    contentOpacity: interfaceOpacity
  }
}

export function applyTransparencyToggle(prefs, toggle) {
  const current = normalizeTransparencyPrefs(prefs)
  if (!toggle || typeof toggle.value !== 'boolean') return current
  if (current.merged) {
    if (toggle.kind !== 'unified') return current
    return normalizeTransparencyPrefs({
      ...current,
      windowEnabled: toggle.value,
      contentEnabled: toggle.value
    })
  }
  if (toggle.kind === 'unified') return current
  if (toggle.kind === 'window') {
    return normalizeTransparencyPrefs({ ...current, windowEnabled: toggle.value })
  }
  if (toggle.kind === 'content') {
    if (!current.windowEnabled) return current
    return normalizeTransparencyPrefs({ ...current, contentEnabled: toggle.value })
  }
  return current
}

export function applyMergeChange(prefs, merged) {
  const current = normalizeTransparencyPrefs(prefs)
  if (typeof merged !== 'boolean') return current
  const next = { ...current, merged }
  if (merged) next.contentEnabled = next.windowEnabled
  return normalizeTransparencyPrefs(next)
}
