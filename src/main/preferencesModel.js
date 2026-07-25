import {
  DEFAULT_FILE_VISUAL_PREFS,
  normalizeFileVisualPrefs,
  sanitizeFileVisualPrefsPatch
} from '../shared/fileVisualPrefs.js'
import {
  DEFAULT_TRANSPARENCY_PREFS,
  normalizeTransparencyPrefs,
  sanitizeTransparencyPrefsPatch
} from '../shared/transparencyPrefs.js'
import {
  getDefaultBossKeys,
  getDefaultWebPrefs,
  getRuntimePlatformPolicy,
  normalizePageKeyDescriptor,
  resolvePlatformPolicy
} from '../shared/platformPolicy.js'
import { normalizeSiteWebPrefs, sanitizeWebPrefsPatch } from './webPrefs.js'

export const MANAGED_PREF_KEYS = new Set([
  'webPrefs',
  'siteWebPrefs',
  'txtPrefs',
  'epubPrefs',
  'pdfPrefs',
  'fileVisualPrefs',
  'transparencyPrefs',
  'bossKeys',
  'startupPrefs',
  'historyPrefs',
  'themePrefs',
  'systemPrefs'
])

export const DEFAULT_WEB_PREFS = Object.freeze({
  ua: 'iphone',
  compat: false,
  zoom: 1,
  hideScrollbar: true,
  plainView: false,
  hideMedia: false,
  wheelSpeed: 1
})

export const DEFAULT_TXT_PREFS = Object.freeze({
  fontSize: 16,
  lineHeight: 1.7,
  bgColor: null,
  autoTurnSec: 30,
  defaultEncoding: null,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
})

export const DEFAULT_EPUB_PREFS = Object.freeze({
  defaultMode: 'scroll',
  fontSize: 16,
  lineHeight: 1.7,
  autoTurnSec: 30,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
})

export const DEFAULT_PDF_PREFS = Object.freeze({
  defaultZoom: 'fit-width',
  pageDisplay: 'page',
  invertColors: false
})

export const DEFAULT_STARTUP_PREFS = Object.freeze({
  restoreShellState: true
})

export const DEFAULT_HISTORY_PREFS = Object.freeze({
  recordWeb: true,
  recordFiles: true
})

export const DEFAULT_THEME_PREFS = Object.freeze({
  mode: 'auto'
})

export const DEFAULT_SYSTEM_PREFS = Object.freeze({
  showInTaskbarOrDock: true
})

export const DEFAULT_DIAGNOSTIC_PREFS = Object.freeze({
  enabled: true
})

export const DEFAULT_BOSS_KEYS = Object.freeze({
  hide: 'Command+\\',
  kill: 'Shift+Command+\\'
})

const ENCODINGS = new Set([null, 'UTF-8', 'GBK', 'GB2312', 'Big5'])
const EPUB_MODES = new Set(['scroll', 'paginate'])
const READER_FONT_FAMILIES = new Set(['default', 'serif', 'sans', 'kaiti', 'mono'])
const PAGE_DISPLAY = new Set(['page', 'percent', 'both'])
const THEME_MODES = new Set(['auto', 'light', 'dark'])

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNumberInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function resolvePolicy(policy) {
  return policy ? resolvePlatformPolicy(policy.platform) : getRuntimePlatformPolicy()
}

export function buildDefaultManagedPrefs(policy) {
  const resolved = resolvePolicy(policy)
  return {
    webPrefs: { ...DEFAULT_WEB_PREFS, ...getDefaultWebPrefs(resolved) },
    siteWebPrefs: {},
    txtPrefs: { ...DEFAULT_TXT_PREFS, pageKeys: { ...DEFAULT_TXT_PREFS.pageKeys } },
    epubPrefs: { ...DEFAULT_EPUB_PREFS, pageKeys: { ...DEFAULT_EPUB_PREFS.pageKeys } },
    pdfPrefs: { ...DEFAULT_PDF_PREFS },
    fileVisualPrefs: { ...DEFAULT_FILE_VISUAL_PREFS },
    transparencyPrefs: { ...DEFAULT_TRANSPARENCY_PREFS },
    bossKeys: getDefaultBossKeys(resolved),
    startupPrefs: { ...DEFAULT_STARTUP_PREFS },
    historyPrefs: { ...DEFAULT_HISTORY_PREFS },
    themePrefs: { ...DEFAULT_THEME_PREFS },
    systemPrefs: { ...DEFAULT_SYSTEM_PREFS }
  }
}

function normalizeStoredPageKeys(value, defaults, policy) {
  if (!isPlainObject(value)) return { ...defaults }
  const next = normalizePageKeyDescriptor(value.next, policy)
  const prev = normalizePageKeyDescriptor(value.prev, policy)
  if (!next || !prev || next === prev) return { ...defaults }
  return { next, prev }
}

function normalizeReaderFontFamily(value) {
  return READER_FONT_FAMILIES.has(value) ? value : 'default'
}

function sanitizePageKeysPatch(pageKeys, current, defaults, policy) {
  if (!isPlainObject(pageKeys)) return null
  const base = normalizeStoredPageKeys(current, defaults, policy)
  const next = { ...base }
  let touched = false

  for (const direction of ['next', 'prev']) {
    if (!(direction in pageKeys)) continue
    const value = normalizePageKeyDescriptor(pageKeys[direction], policy)
    if (!value) return null
    next[direction] = value
    touched = true
  }

  if (!touched) return null
  if (next.next === next.prev) return null
  return next
}

export function normalizeTxtPrefs(value, policy) {
  const source = isPlainObject(value) ? value : {}
  return {
    fontSize: isNumberInRange(source.fontSize, 12, 24)
      ? source.fontSize
      : DEFAULT_TXT_PREFS.fontSize,
    lineHeight: isNumberInRange(source.lineHeight, 1.4, 2.0)
      ? source.lineHeight
      : DEFAULT_TXT_PREFS.lineHeight,
    bgColor: typeof source.bgColor === 'string' || source.bgColor === null ? source.bgColor : null,
    autoTurnSec: isNumberInRange(source.autoTurnSec, 5, 180)
      ? source.autoTurnSec
      : DEFAULT_TXT_PREFS.autoTurnSec,
    defaultEncoding: ENCODINGS.has(source.defaultEncoding)
      ? source.defaultEncoding
      : DEFAULT_TXT_PREFS.defaultEncoding,
    fontFamily: normalizeReaderFontFamily(source.fontFamily),
    pageKeys: normalizeStoredPageKeys(source.pageKeys, DEFAULT_TXT_PREFS.pageKeys, policy)
  }
}

export function sanitizeTxtPrefsPatch(patch, current = DEFAULT_TXT_PREFS, policy) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('fontSize' in patch && isNumberInRange(patch.fontSize, 12, 24)) out.fontSize = patch.fontSize
  if ('lineHeight' in patch && isNumberInRange(patch.lineHeight, 1.4, 2.0)) {
    out.lineHeight = patch.lineHeight
  }
  if ('bgColor' in patch && (typeof patch.bgColor === 'string' || patch.bgColor === null)) {
    out.bgColor = patch.bgColor
  }
  if ('autoTurnSec' in patch && isNumberInRange(patch.autoTurnSec, 5, 180)) {
    out.autoTurnSec = patch.autoTurnSec
  }
  if ('defaultEncoding' in patch && ENCODINGS.has(patch.defaultEncoding)) {
    out.defaultEncoding = patch.defaultEncoding
  }
  if ('fontFamily' in patch && READER_FONT_FAMILIES.has(patch.fontFamily)) {
    out.fontFamily = patch.fontFamily
  }
  if ('pageKeys' in patch) {
    const pageKeys = sanitizePageKeysPatch(
      patch.pageKeys,
      normalizeTxtPrefs(current, policy).pageKeys,
      DEFAULT_TXT_PREFS.pageKeys,
      policy
    )
    if (pageKeys) out.pageKeys = pageKeys
  }
  return out
}

export function normalizeEpubPrefs(value, policy) {
  const source = isPlainObject(value) ? value : {}
  return {
    defaultMode: EPUB_MODES.has(source.defaultMode)
      ? source.defaultMode
      : DEFAULT_EPUB_PREFS.defaultMode,
    fontSize: isNumberInRange(source.fontSize, 12, 24)
      ? source.fontSize
      : DEFAULT_EPUB_PREFS.fontSize,
    lineHeight: isNumberInRange(source.lineHeight, 1.4, 2.0)
      ? source.lineHeight
      : DEFAULT_EPUB_PREFS.lineHeight,
    autoTurnSec: isNumberInRange(source.autoTurnSec, 5, 180)
      ? source.autoTurnSec
      : DEFAULT_EPUB_PREFS.autoTurnSec,
    fontFamily: normalizeReaderFontFamily(source.fontFamily),
    pageKeys: normalizeStoredPageKeys(source.pageKeys, DEFAULT_EPUB_PREFS.pageKeys, policy)
  }
}

export function sanitizeEpubPrefsPatch(patch, current = DEFAULT_EPUB_PREFS, policy) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('defaultMode' in patch && EPUB_MODES.has(patch.defaultMode))
    out.defaultMode = patch.defaultMode
  if ('fontSize' in patch && isNumberInRange(patch.fontSize, 12, 24)) out.fontSize = patch.fontSize
  if ('lineHeight' in patch && isNumberInRange(patch.lineHeight, 1.4, 2.0)) {
    out.lineHeight = patch.lineHeight
  }
  if ('autoTurnSec' in patch && isNumberInRange(patch.autoTurnSec, 5, 180)) {
    out.autoTurnSec = patch.autoTurnSec
  }
  if ('fontFamily' in patch && READER_FONT_FAMILIES.has(patch.fontFamily)) {
    out.fontFamily = patch.fontFamily
  }
  if ('pageKeys' in patch) {
    const pageKeys = sanitizePageKeysPatch(
      patch.pageKeys,
      normalizeEpubPrefs(current, policy).pageKeys,
      DEFAULT_EPUB_PREFS.pageKeys,
      policy
    )
    if (pageKeys) out.pageKeys = pageKeys
  }
  return out
}

export function normalizePdfPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    defaultZoom:
      source.defaultZoom === 'fit-width' || isNumberInRange(source.defaultZoom, 50, 300)
        ? source.defaultZoom
        : DEFAULT_PDF_PREFS.defaultZoom,
    pageDisplay: PAGE_DISPLAY.has(source.pageDisplay)
      ? source.pageDisplay
      : DEFAULT_PDF_PREFS.pageDisplay,
    invertColors:
      typeof source.invertColors === 'boolean'
        ? source.invertColors
        : DEFAULT_PDF_PREFS.invertColors
  }
}

export function sanitizePdfPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if (
    'defaultZoom' in patch &&
    (patch.defaultZoom === 'fit-width' || isNumberInRange(patch.defaultZoom, 50, 300))
  ) {
    out.defaultZoom = patch.defaultZoom
  }
  if ('pageDisplay' in patch && PAGE_DISPLAY.has(patch.pageDisplay)) {
    out.pageDisplay = patch.pageDisplay
  }
  if ('invertColors' in patch && typeof patch.invertColors === 'boolean') {
    out.invertColors = patch.invertColors
  }
  return out
}

export function normalizeStartupPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    restoreShellState:
      typeof source.restoreShellState === 'boolean'
        ? source.restoreShellState
        : DEFAULT_STARTUP_PREFS.restoreShellState
  }
}

export function sanitizeStartupPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('restoreShellState' in patch && typeof patch.restoreShellState === 'boolean') {
    out.restoreShellState = patch.restoreShellState
  }
  return out
}

export function normalizeHistoryPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    recordWeb:
      typeof source.recordWeb === 'boolean' ? source.recordWeb : DEFAULT_HISTORY_PREFS.recordWeb,
    recordFiles:
      typeof source.recordFiles === 'boolean'
        ? source.recordFiles
        : DEFAULT_HISTORY_PREFS.recordFiles
  }
}

export function sanitizeHistoryPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('recordWeb' in patch && typeof patch.recordWeb === 'boolean') out.recordWeb = patch.recordWeb
  if ('recordFiles' in patch && typeof patch.recordFiles === 'boolean') {
    out.recordFiles = patch.recordFiles
  }
  return out
}

export function normalizeThemePrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    mode: THEME_MODES.has(source.mode) ? source.mode : DEFAULT_THEME_PREFS.mode
  }
}

export function sanitizeThemePrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('mode' in patch && THEME_MODES.has(patch.mode)) out.mode = patch.mode
  return out
}

export function normalizeSystemPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    showInTaskbarOrDock:
      typeof source.showInTaskbarOrDock === 'boolean'
        ? source.showInTaskbarOrDock
        : DEFAULT_SYSTEM_PREFS.showInTaskbarOrDock
  }
}

export function sanitizeSystemPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('showInTaskbarOrDock' in patch && typeof patch.showInTaskbarOrDock === 'boolean') {
    out.showInTaskbarOrDock = patch.showInTaskbarOrDock
  }
  return out
}

export function normalizeDiagnosticPrefs(value) {
  const source = isPlainObject(value) ? value : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_DIAGNOSTIC_PREFS.enabled
  }
}

export function sanitizeDiagnosticPrefsPatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if ('enabled' in patch && typeof patch.enabled === 'boolean') out.enabled = patch.enabled
  return out
}

export function normalizeBossKeys(value, policy) {
  const defaults = getDefaultBossKeys(resolvePolicy(policy))
  const source = isPlainObject(value) ? value : {}
  return {
    hide: typeof source.hide === 'string' && source.hide ? source.hide : defaults.hide,
    kill: typeof source.kill === 'string' && source.kill ? source.kill : defaults.kill
  }
}

export function buildPreferenceBundlePrefs(raw = {}, policy) {
  const defaults = buildDefaultManagedPrefs(policy)
  return {
    webPrefs: { ...defaults.webPrefs, ...sanitizeWebPrefsPatch(raw.webPrefs) },
    siteWebPrefs: normalizeSiteWebPrefs(raw.siteWebPrefs),
    txtPrefs: normalizeTxtPrefs(raw.txtPrefs, policy),
    epubPrefs: normalizeEpubPrefs(raw.epubPrefs, policy),
    pdfPrefs: normalizePdfPrefs(raw.pdfPrefs),
    fileVisualPrefs: normalizeFileVisualPrefs(raw.fileVisualPrefs || DEFAULT_FILE_VISUAL_PREFS),
    transparencyPrefs: normalizeTransparencyPrefs(
      raw.transparencyPrefs || DEFAULT_TRANSPARENCY_PREFS
    ),
    bossKeys: normalizeBossKeys(raw.bossKeys, policy),
    startupPrefs: normalizeStartupPrefs(raw.startupPrefs),
    historyPrefs: normalizeHistoryPrefs(raw.historyPrefs),
    themePrefs: normalizeThemePrefs(raw.themePrefs),
    systemPrefs: normalizeSystemPrefs(raw.systemPrefs)
  }
}

function recordInvalidPatchFields({ key, incoming, clean, invalidFields }) {
  if (!isPlainObject(incoming)) {
    invalidFields.push(key)
    return
  }
  const accepted = new Set(Object.keys(clean))
  for (const field of Object.keys(incoming)) {
    if (!accepted.has(field)) invalidFields.push(`${key}.${field}`)
  }
}

function mergeField({ key, current, incoming, normalizer, sanitizer, invalidFields }) {
  if (!(key in incoming)) return current[key]
  const clean = sanitizer(incoming[key], current[key])
  recordInvalidPatchFields({ key, incoming: incoming[key], clean, invalidFields })
  return normalizer({ ...current[key], ...clean })
}

export function mergeImportedPrefs(currentRaw, incomingRaw) {
  const current = buildPreferenceBundlePrefs(currentRaw || {})
  const incoming = isPlainObject(incomingRaw) ? incomingRaw : {}
  const ignoredFields = []
  const invalidFields = []
  const next = { ...current }

  for (const key of Object.keys(incoming)) {
    if (!MANAGED_PREF_KEYS.has(key)) ignoredFields.push(key)
  }

  if ('webPrefs' in incoming) {
    const clean = sanitizeWebPrefsPatch(incoming.webPrefs, { clampZoom: false })
    recordInvalidPatchFields({ key: 'webPrefs', incoming: incoming.webPrefs, clean, invalidFields })
    next.webPrefs = { ...current.webPrefs, ...clean }
  }

  if ('siteWebPrefs' in incoming) {
    const normalizedSites = normalizeSiteWebPrefs(incoming.siteWebPrefs)
    if (
      Object.keys(normalizedSites).length === 0 &&
      Object.keys(incoming.siteWebPrefs || {}).length > 0
    ) {
      invalidFields.push('siteWebPrefs')
    }
    next.siteWebPrefs = normalizeSiteWebPrefs({ ...current.siteWebPrefs, ...normalizedSites })
  }

  if ('fileVisualPrefs' in incoming) {
    const clean = sanitizeFileVisualPrefsPatch(incoming.fileVisualPrefs)
    recordInvalidPatchFields({
      key: 'fileVisualPrefs',
      incoming: incoming.fileVisualPrefs,
      clean,
      invalidFields
    })
    next.fileVisualPrefs = normalizeFileVisualPrefs({ ...current.fileVisualPrefs, ...clean })
  }

  if ('transparencyPrefs' in incoming) {
    const clean = sanitizeTransparencyPrefsPatch(incoming.transparencyPrefs)
    recordInvalidPatchFields({
      key: 'transparencyPrefs',
      incoming: incoming.transparencyPrefs,
      clean,
      invalidFields
    })
    next.transparencyPrefs = normalizeTransparencyPrefs({
      ...current.transparencyPrefs,
      ...clean
    })
  }

  if ('bossKeys' in incoming) {
    next.bossKeys = normalizeBossKeys({ ...current.bossKeys, ...incoming.bossKeys })
  }

  next.txtPrefs = mergeField({
    key: 'txtPrefs',
    current,
    incoming,
    normalizer: normalizeTxtPrefs,
    sanitizer: sanitizeTxtPrefsPatch,
    invalidFields
  })
  next.epubPrefs = mergeField({
    key: 'epubPrefs',
    current,
    incoming,
    normalizer: normalizeEpubPrefs,
    sanitizer: sanitizeEpubPrefsPatch,
    invalidFields
  })
  next.pdfPrefs = mergeField({
    key: 'pdfPrefs',
    current,
    incoming,
    normalizer: normalizePdfPrefs,
    sanitizer: sanitizePdfPrefsPatch,
    invalidFields
  })
  next.startupPrefs = mergeField({
    key: 'startupPrefs',
    current,
    incoming,
    normalizer: normalizeStartupPrefs,
    sanitizer: sanitizeStartupPrefsPatch,
    invalidFields
  })
  next.historyPrefs = mergeField({
    key: 'historyPrefs',
    current,
    incoming,
    normalizer: normalizeHistoryPrefs,
    sanitizer: sanitizeHistoryPrefsPatch,
    invalidFields
  })
  next.themePrefs = mergeField({
    key: 'themePrefs',
    current,
    incoming,
    normalizer: normalizeThemePrefs,
    sanitizer: sanitizeThemePrefsPatch,
    invalidFields
  })
  next.systemPrefs = mergeField({
    key: 'systemPrefs',
    current,
    incoming,
    normalizer: normalizeSystemPrefs,
    sanitizer: sanitizeSystemPrefsPatch,
    invalidFields
  })

  return { next, ignoredFields, invalidFields }
}
