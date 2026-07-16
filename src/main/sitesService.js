import { randomUUID } from 'node:crypto'
import { PRESET_SITES } from '../shared/presetSites.js'
import { normalizeSiteOrder } from '../shared/siteOrdering.js'
import { SITE_NAME_MAX_LENGTH } from '../shared/siteLimits.js'
import store from './store.js'

const DEFAULT_PRESET_PREFS = Object.freeze({ hiddenIds: [], overrides: [] })
const PRESET_SITE_IDS = new Set(PRESET_SITES.map((site) => site.id))

function createSiteValidationError(reason, message) {
  const error = new Error(reason)
  error.reason = reason
  error.message = message || reason
  return error
}

function validateURL(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw createSiteValidationError('invalid-url', `Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw createSiteValidationError('invalid-url-scheme', '站点地址仅支持 http/https')
  }
}

function validateDraft(draft) {
  if (!draft || typeof draft !== 'object') throw new Error('draft required')
  if (!draft.name || typeof draft.name !== 'string') throw new Error('name required')
  if (!draft.url || typeof draft.url !== 'string') throw new Error('url required')
  validateURL(draft.url)
}

function normalizeSiteName(name) {
  return name.trim().slice(0, SITE_NAME_MAX_LENGTH)
}

function uniquePresetIds(ids) {
  const result = []
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!PRESET_SITE_IDS.has(id) || result.includes(id)) continue
    result.push(id)
  }
  return result
}

function presetDefinition(id) {
  const preset = PRESET_SITES.find((site) => site.id === id)
  if (!preset) throw new Error(`preset site not found: ${id}`)
  return preset
}

function normalizePresetOverride(value) {
  if (!value || typeof value !== 'object') return null
  if (!PRESET_SITE_IDS.has(value.id)) return null
  if (!value.name || typeof value.name !== 'string') return null
  if (!value.url || typeof value.url !== 'string') return null
  try {
    validateURL(value.url)
  } catch {
    return null
  }
  return {
    id: value.id,
    name: normalizeSiteName(value.name),
    url: value.url.trim(),
    icon: (value.icon || value.name.trim()).slice(0, 1)
  }
}

function normalizePresetPrefs(value) {
  const clean = {
    hiddenIds: uniquePresetIds(value?.hiddenIds),
    overrides: []
  }
  for (const override of Array.isArray(value?.overrides) ? value.overrides : []) {
    const normalized = normalizePresetOverride(override)
    if (!normalized) continue
    const index = clean.overrides.findIndex((item) => item.id === normalized.id)
    if (index >= 0) clean.overrides[index] = normalized
    else clean.overrides.push(normalized)
  }
  return clean
}

function setPresetPrefs(next) {
  const normalized = normalizePresetPrefs(next)
  store.set('sitePresetPrefs', normalized)
  return normalized
}

function mergePresetPatch(base, patch = {}) {
  const next = { ...base, ...patch, id: base.id }
  if (!next.name || typeof next.name !== 'string') throw new Error('name required')
  if (!next.url || typeof next.url !== 'string') throw new Error('url required')
  validateURL(next.url)
  const name = normalizeSiteName(next.name)
  return {
    id: base.id,
    name,
    url: next.url.trim(),
    icon: (next.icon || name).slice(0, 1)
  }
}

export function list() {
  return store.get('customSites')
}

export function listPresetPrefs() {
  return normalizePresetPrefs(store.get('sitePresetPrefs') || DEFAULT_PRESET_PREFS)
}

export function add(draft) {
  validateDraft(draft)
  const site = {
    id: randomUUID(),
    name: normalizeSiteName(draft.name),
    url: draft.url.trim(),
    icon: (draft.icon || draft.name.trim()).slice(0, 1)
  }
  const next = [...list(), site]
  store.set('customSites', next)
  return site
}

export function update(id, patch) {
  const all = list()
  const idx = all.findIndex((s) => s.id === id)
  if (idx < 0) throw new Error(`site not found: ${id}`)
  const merged = { ...all[idx], ...patch }
  if (patch.url) validateURL(patch.url)
  if (patch.name) merged.name = normalizeSiteName(patch.name)
  if (patch.icon !== undefined) merged.icon = (patch.icon || merged.name).slice(0, 1)
  const next = [...all]
  next[idx] = merged
  store.set('customSites', next)
  return merged
}

export function remove(id) {
  const next = list().filter((s) => s.id !== id)
  store.set('customSites', next)
  removeFromOrder(id)
}

export function updatePreset(id, patch) {
  const preset = presetDefinition(id)
  const prefs = listPresetPrefs()
  const existing = prefs.overrides.find((item) => item.id === id)
  const updated = mergePresetPatch({ ...preset, ...existing }, patch)
  const overrides = prefs.overrides.filter((item) => item.id !== id)
  overrides.push(updated)
  setPresetPrefs({
    hiddenIds: prefs.hiddenIds.filter((hiddenId) => hiddenId !== id),
    overrides
  })
  return updated
}

export function removePreset(id) {
  presetDefinition(id)
  const prefs = listPresetPrefs()
  const hiddenIds = prefs.hiddenIds.includes(id) ? prefs.hiddenIds : [...prefs.hiddenIds, id]
  removeFromOrder(id)
  return setPresetPrefs({
    hiddenIds,
    overrides: prefs.overrides.filter((item) => item.id !== id)
  })
}

function knownSiteIds() {
  const hidden = new Set(listPresetPrefs().hiddenIds)
  return [
    ...PRESET_SITES.filter((site) => !hidden.has(site.id)).map((site) => site.id),
    ...list().map((site) => site.id)
  ]
}

function removeFromOrder(id) {
  const current = store.get('siteOrder')
  if (!Array.isArray(current) || !current.includes(id)) return
  store.set(
    'siteOrder',
    current.filter((item) => item !== id)
  )
}

export function listOrder() {
  return normalizeSiteOrder(store.get('siteOrder'), knownSiteIds())
}

export function setOrder(ids) {
  const next = normalizeSiteOrder(ids, knownSiteIds())
  store.set('siteOrder', next)
  return next
}

export function clearOrder() {
  store.set('siteOrder', [])
  return []
}

export function clearAll() {
  store.set('customSites', [])
  const currentOrder = store.get('siteOrder')
  if (Array.isArray(currentOrder)) {
    store.set(
      'siteOrder',
      currentOrder.filter((id) => PRESET_SITE_IDS.has(id))
    )
  }
  return []
}

export function clearPresetPrefs() {
  return setPresetPrefs(DEFAULT_PRESET_PREFS)
}
