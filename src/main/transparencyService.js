import store, { cancelPendingKey, persistDebounced } from './store.js'
import {
  DEFAULT_TRANSPARENCY_PREFS,
  applyMergeChange,
  applyTransparencyToggle,
  normalizeTransparencyPrefs,
  resolveEffectiveOpacity,
  sanitizeTransparencyPrefsPatch
} from '../shared/transparencyPrefs.js'

let transparencyPrefs = { ...DEFAULT_TRANSPARENCY_PREFS }

function clonePrefs(value) {
  return { ...value }
}

function prefsEqual(a, b) {
  return (
    a.merged === b.merged &&
    a.windowEnabled === b.windowEnabled &&
    a.contentEnabled === b.contentEnabled &&
    a.windowLevel === b.windowLevel &&
    a.contentLevel === b.contentLevel
  )
}

function persistPrefs(next, persist) {
  if (persist === false || persist === 'none') return
  if (persist === 'sync') {
    cancelPendingKey('transparencyPrefs')
    store.set('transparencyPrefs', next)
    return
  }
  persistDebounced('transparencyPrefs', next)
}

export function initTransparencyPrefs() {
  const storedPrefs = store.get('transparencyPrefs')
  transparencyPrefs = normalizeTransparencyPrefs(storedPrefs)
  // Persist normalization so legacy zero-opacity configurations are migrated
  // once instead of recreating an invisible input-blocking window every boot.
  if (!prefsEqual(storedPrefs || {}, transparencyPrefs)) {
    persistPrefs(transparencyPrefs, 'sync')
  }
  try {
    store.delete?.('windowOpacity')
    store.delete?.('contentOpacity')
  } catch (error) {
    console.warn('[transparencyService] failed to clear legacy opacity keys:', error?.message)
  }
  return getTransparencyPrefs()
}

export function getTransparencyPrefs() {
  return clonePrefs(transparencyPrefs)
}

export function getEffectiveOpacity(options = {}) {
  return resolveEffectiveOpacity(transparencyPrefs, options)
}

export function updateTransparencyPrefs(payload = {}, { persist = 'debounce' } = {}) {
  const current = transparencyPrefs
  let next = current

  if (payload.patch && typeof payload.patch === 'object') {
    const clean = sanitizeTransparencyPrefsPatch(payload.patch)
    if (Object.keys(clean).length === 0) return getTransparencyPrefs()
    const { merged, ...rest } = clean
    next = normalizeTransparencyPrefs({ ...current, ...rest })
    if (typeof merged === 'boolean') next = applyMergeChange(next, merged)
  } else if (payload.toggle) {
    next = applyTransparencyToggle(current, payload.toggle)
  } else {
    return getTransparencyPrefs()
  }

  if (prefsEqual(current, next)) return getTransparencyPrefs()
  transparencyPrefs = next
  persistPrefs(next, persist)
  return getTransparencyPrefs()
}

export function replaceTransparencyPrefs(nextPrefs, { persist = 'sync' } = {}) {
  const next = normalizeTransparencyPrefs(nextPrefs)
  transparencyPrefs = next
  persistPrefs(next, persist)
  return getTransparencyPrefs()
}
