import { computed, ref } from 'vue'
import { applySiteOrder } from '../../../shared/siteOrdering.js'
import { PRESET_SITES } from '../constants/presetSites.js'

const customSites = ref([])
const sitePresetPrefs = ref({ hiddenIds: [], overrides: [] })
const siteOrder = ref([])
let sitesUnlisten = null
let sitePresetPrefsUnlisten = null
let siteOrderUnlisten = null

const PRESET_SITE_IDS = new Set(PRESET_SITES.map((site) => site.id))
const presets = computed(() => buildPresetSites(sitePresetPrefs.value))
const orderedSites = computed(() =>
  applySiteOrder(
    [
      ...presets.value.map((site) => ({ ...site, source: 'preset' })),
      ...customSites.value.map((site) => ({ ...site, source: 'custom' }))
    ],
    siteOrder.value
  )
)

function ensureSitesSubscription() {
  if (!sitesUnlisten && window.api.onSitesChanged) {
    sitesUnlisten = window.api.onSitesChanged((sites) => {
      customSites.value = Array.isArray(sites) ? sites : []
    })
  }
  if (!sitePresetPrefsUnlisten && window.api.onSitePresetPrefsChanged) {
    sitePresetPrefsUnlisten = window.api.onSitePresetPrefsChanged((prefs) => {
      sitePresetPrefs.value = normalizePresetPrefs(prefs)
    })
  }
  if (!siteOrderUnlisten && window.api.onSiteOrderChanged) {
    siteOrderUnlisten = window.api.onSiteOrderChanged((order) => {
      siteOrder.value = Array.isArray(order) ? order : []
    })
  }
}

function normalizePresetPrefs(value) {
  return {
    hiddenIds: Array.isArray(value?.hiddenIds)
      ? value.hiddenIds.filter(
          (id, index, ids) => PRESET_SITE_IDS.has(id) && ids.indexOf(id) === index
        )
      : [],
    overrides: Array.isArray(value?.overrides)
      ? value.overrides.filter((site) => PRESET_SITE_IDS.has(site?.id))
      : []
  }
}

function buildPresetSites(prefs) {
  const normalized = normalizePresetPrefs(prefs)
  const overrides = new Map(normalized.overrides.map((site) => [site.id, site]))
  return PRESET_SITES.filter((site) => !normalized.hiddenIds.includes(site.id)).map((site) => ({
    ...site,
    ...(overrides.get(site.id) || {})
  }))
}

function upsertSite(sites, site) {
  const index = sites.findIndex((existing) => existing.id === site.id)
  if (index < 0) return [...sites, site]
  const next = [...sites]
  next[index] = site
  return next
}

function upsertPresetOverride(prefs, site) {
  const normalized = normalizePresetPrefs(prefs)
  return {
    hiddenIds: normalized.hiddenIds.filter((id) => id !== site.id),
    overrides: upsertSite(normalized.overrides, site)
  }
}

function hidePreset(prefs, id) {
  const normalized = normalizePresetPrefs(prefs)
  return {
    hiddenIds: normalized.hiddenIds.includes(id)
      ? normalized.hiddenIds
      : [...normalized.hiddenIds, id],
    overrides: normalized.overrides.filter((site) => site.id !== id)
  }
}

function setCustomSites(sites) {
  customSites.value = Array.isArray(sites) ? sites : []
}

function isPresetSiteId(id) {
  return PRESET_SITE_IDS.has(id)
}

function requirePresetApi(name) {
  const fn = window.api[name]
  if (typeof fn !== 'function') throw new Error(`missing api: ${name}`)
  return fn
}

function setPresetPrefs(prefs) {
  sitePresetPrefs.value = normalizePresetPrefs(prefs)
}

function applyPresetPrefsResult(result, fallbackId) {
  if (result && typeof result === 'object' && Array.isArray(result.hiddenIds)) {
    setPresetPrefs(result)
    return result
  }
  if (result?.id) {
    sitePresetPrefs.value = upsertPresetOverride(sitePresetPrefs.value, result)
    return result
  }
  if (fallbackId) sitePresetPrefs.value = hidePreset(sitePresetPrefs.value, fallbackId)
  return result
}

function throwIfSiteResultFailed(result) {
  if (!result || result.ok !== false) return result
  const error = new Error(result.message || result.reason || 'site operation failed')
  error.reason = result.reason
  throw error
}

export function useSites() {
  ensureSitesSubscription()
  async function refresh() {
    const [sites, presetPrefs, order] = await Promise.all([
      window.api.sitesList(),
      window.api.sitesPresetPrefsGet
        ? window.api.sitesPresetPrefsGet()
        : Promise.resolve({ hiddenIds: [], overrides: [] }),
      window.api.sitesOrderGet ? window.api.sitesOrderGet() : Promise.resolve([])
    ])
    setCustomSites(sites)
    setPresetPrefs(presetPrefs)
    siteOrder.value = Array.isArray(order) ? order : []
  }
  async function add(draft) {
    const created = throwIfSiteResultFailed(await window.api.sitesAdd(draft))
    customSites.value = upsertSite(customSites.value, created)
    return created
  }
  async function update(id, patch) {
    if (isPresetSiteId(id)) {
      const updated = throwIfSiteResultFailed(
        await requirePresetApi('sitesPresetUpdate')(id, patch)
      )
      applyPresetPrefsResult(updated)
      return updated
    }
    const updated = throwIfSiteResultFailed(await window.api.sitesUpdate(id, patch))
    customSites.value = upsertSite(customSites.value, updated)
    return updated
  }
  async function remove(id) {
    if (isPresetSiteId(id)) {
      const result = await requirePresetApi('sitesPresetRemove')(id)
      applyPresetPrefsResult(result, id)
      return result
    }
    await window.api.sitesRemove(id)
    customSites.value = customSites.value.filter((s) => s.id !== id)
  }
  async function reorder(orderedIds) {
    const previous = [...siteOrder.value]
    const nextOrder = Array.isArray(orderedIds) ? [...orderedIds] : []
    siteOrder.value = nextOrder
    try {
      if (typeof window.api.sitesOrderSet !== 'function') {
        throw new Error('missing api: sitesOrderSet')
      }
      const next = await window.api.sitesOrderSet([...nextOrder])
      if (Array.isArray(next)) siteOrder.value = next
      return next
    } catch (e) {
      siteOrder.value = previous
      throw e
    }
  }
  return { presets, customSites, siteOrder, orderedSites, refresh, add, update, remove, reorder }
}
