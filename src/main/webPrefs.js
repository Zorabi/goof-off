import {
  getDefaultWebPrefs,
  getRuntimePlatformPolicy,
  resolvePlatformPolicy
} from '../shared/platformPolicy.js'

export const UA_MAP = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
}

export function resolveEffectiveUA({ ua, compat }) {
  return compat ? UA_MAP.iphone : UA_MAP[ua]
}

export function shouldReloadForUA({ currentUA, nextUA, contentMode }) {
  return contentMode === 'web' && currentUA !== nextUA
}

export function shouldInjectPlainView({
  windowOpacity = 1,
  shellBackgroundHidden = false,
  interfaceOpacity,
  contentOpacity = 1,
  plainView
}) {
  const effectiveInterfaceOpacity = interfaceOpacity ?? contentOpacity
  const entryVisible =
    shellBackgroundHidden === true || effectiveInterfaceOpacity < 1 || windowOpacity < 1
  return entryVisible && plainView === true
}

const UA_KEYS = ['mac', 'win', 'iphone', 'ipad']
const DEFAULT_WEB_PREFS = Object.freeze({
  ua: 'iphone',
  compat: false,
  zoom: 1,
  hideScrollbar: true,
  plainView: false,
  hideMedia: false,
  wheelSpeed: 1
})
const SITE_PREF_KEYS = ['ua', 'compat', 'zoom', 'hideScrollbar']
const SITE_PREF_LIMIT = 100

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

export function sanitizeWebPrefsPatch(patch, opts = {}) {
  if (!patch || typeof patch !== 'object') return {}
  const clampZoom = opts.clampZoom !== false
  const out = {}
  if ('ua' in patch && UA_KEYS.includes(patch.ua)) out.ua = patch.ua
  if ('compat' in patch && typeof patch.compat === 'boolean') out.compat = patch.compat
  if ('hideScrollbar' in patch && typeof patch.hideScrollbar === 'boolean') {
    out.hideScrollbar = patch.hideScrollbar
  }
  if ('plainView' in patch && typeof patch.plainView === 'boolean') out.plainView = patch.plainView
  if ('hideMedia' in patch && typeof patch.hideMedia === 'boolean') out.hideMedia = patch.hideMedia
  if ('zoom' in patch && typeof patch.zoom === 'number' && Number.isFinite(patch.zoom)) {
    if (clampZoom) out.zoom = clamp(patch.zoom, 0.5, 2.0)
    else if (patch.zoom >= 0.5 && patch.zoom <= 2.0) out.zoom = patch.zoom
  }
  if (
    'wheelSpeed' in patch &&
    typeof patch.wheelSpeed === 'number' &&
    Number.isFinite(patch.wheelSpeed)
  ) {
    out.wheelSpeed = clamp(patch.wheelSpeed, 0.1, 2.0)
  }
  return out
}

function resolvePolicy(policy) {
  return policy ? resolvePlatformPolicy(policy.platform) : getRuntimePlatformPolicy()
}

export function normalizeWebPrefs(value, policy) {
  return {
    ...DEFAULT_WEB_PREFS,
    ...getDefaultWebPrefs(resolvePolicy(policy)),
    ...sanitizeWebPrefsPatch(value)
  }
}

export function extractWebOrigin(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = ''
    }
    return url.origin
  } catch {
    return null
  }
}

export function sanitizeSiteWebPrefsPatch(patch) {
  const clean = sanitizeWebPrefsPatch(patch, { clampZoom: false })
  delete clean.plainView
  delete clean.hideMedia
  delete clean.wheelSpeed
  return clean
}

function normalizeSiteEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const clean = sanitizeSiteWebPrefsPatch(value)
  const hasAllRequired = SITE_PREF_KEYS.every((key) => key in clean)
  if (!hasAllRequired) return null
  return {
    ua: clean.ua,
    compat: clean.compat,
    zoom: clean.zoom,
    hideScrollbar: clean.hideScrollbar,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0
  }
}

export function normalizeSiteWebPrefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = []
  for (const [rawOrigin, rawPrefs] of Object.entries(value)) {
    const origin = extractWebOrigin(rawOrigin)
    const entry = normalizeSiteEntry(rawPrefs)
    if (origin && entry) entries.push([origin, entry])
  }
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return Object.fromEntries(entries.slice(0, SITE_PREF_LIMIT))
}

export function resolveEffectiveWebPrefs({ webPrefs, siteWebPrefs, origin }) {
  const base = normalizeWebPrefs(webPrefs)
  const sites = normalizeSiteWebPrefs(siteWebPrefs)
  const override = origin ? sites[origin] : null
  if (!override) return base
  return {
    ...base,
    ua: override.ua,
    compat: override.compat,
    zoom: override.zoom,
    hideScrollbar: override.hideScrollbar,
    plainView: base.plainView,
    hideMedia: base.hideMedia,
    wheelSpeed: base.wheelSpeed
  }
}

export function upsertSiteWebPrefs({ current, origin, patch, baseEffectivePrefs, now = Date.now }) {
  const normalizedOrigin = extractWebOrigin(origin)
  if (!normalizedOrigin) return normalizeSiteWebPrefs(current)
  const cleanPatch = sanitizeSiteWebPrefsPatch(patch)
  const seed = sanitizeSiteWebPrefsPatch(baseEffectivePrefs)
  const merged = {
    ua: seed.ua ?? DEFAULT_WEB_PREFS.ua,
    compat: seed.compat ?? DEFAULT_WEB_PREFS.compat,
    zoom: seed.zoom ?? DEFAULT_WEB_PREFS.zoom,
    hideScrollbar: seed.hideScrollbar ?? DEFAULT_WEB_PREFS.hideScrollbar,
    ...cleanPatch,
    updatedAt: now()
  }
  return normalizeSiteWebPrefs({ ...normalizeSiteWebPrefs(current), [normalizedOrigin]: merged })
}

export function clearSiteWebPrefs(current, origin) {
  const normalizedOrigin = extractWebOrigin(origin)
  const next = { ...normalizeSiteWebPrefs(current) }
  if (normalizedOrigin) delete next[normalizedOrigin]
  return next
}
