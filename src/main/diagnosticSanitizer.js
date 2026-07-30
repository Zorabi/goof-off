import crypto from 'node:crypto'
import path from 'node:path'

const MAX_STRING = 1000
const MAX_ARRAY = 30
const MAX_DEPTH = 5
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi
const FILE_URL_PATTERN = /\bfile:\/\/[^\s"'<>]+/gi
const MAC_PATH_PATTERN = /\/Users\/[^\s"'<>]+/g
const POSIX_PATH_PATTERN = /\/(?:private|tmp|var|Volumes)\/[^\s"'<>]+/g
const WIN_PATH_PATTERN = /[A-Za-z]:\\[^\s"'<>]+/g
const RENDERER_ALLOWED_EVENTS = new Set([
  'address.commit',
  'address.suggestions_request',
  'address.suggestions_result',
  'bookmark.refresh_result',
  'bookmark.toggle_result',
  'drag.drop_decision',
  'epub.hide_images_change',
  'epub.search_error',
  'epub.search_jump',
  'epub.search_panel',
  'epub.search_query',
  'epub.search_result',
  'file.menu_open_request',
  'file.open.request',
  'file.open.result',
  'file.open.stale_cleanup',
  'file.reader_load_failed',
  'reader.auto_turn_toggle',
  'reader.font_family_change',
  'renderer.error',
  'renderer.unhandled_rejection',
  'state.dispatch',
  'startup_restore.start',
  'startup_restore.intent',
  'startup_restore.result',
  'startup_restore.exception',
  'sites.url_validation_result',
  'stealth_auto_hide.spike_result',
  'stealth_auto_hide.toggle',
  'stealth_auto_hide.restore',
  'stealth_auto_hide.restore_failed',
  'stealth_auto_hide.degraded',
  'trackpad.gesture',
  'transparency.prefs_change',
  'transparency.toggle',
  'transparency.unified_plain_view_sync',
  'txt.search_error',
  'txt.search_jump',
  'txt.search_panel',
  'txt.search_query',
  'txt.search_result',
  'web.intent_write_failed',
  'web.media_visibility_change',
  'web.open.request',
  'web.open.result',
  'web.wheel_speed_change'
])

export function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

export function sanitizeUrl(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { invalidUrl: true }
    return { url: `${url.origin}${url.pathname || '/'}` }
  } catch {
    return { invalidUrl: true }
  }
}

export function sanitizeFilePath(input) {
  const raw = String(input || '')
  let pathname = raw
  try {
    if (raw.startsWith('file://')) pathname = decodeURIComponent(new URL(raw).pathname)
  } catch {
    pathname = raw
  }
  const basename = path.win32.basename(pathname)
  return {
    basename,
    ext: path.win32.extname(basename),
    pathHash: hashText(pathname)
  }
}

function replaceSensitiveString(input, options = {}) {
  let value = String(input)
  value = value.replace(FILE_URL_PATTERN, (match) => {
    const file = sanitizeFilePath(match)
    return `[file:${file.basename}:${file.pathHash}]`
  })
  value = value.replace(URL_PATTERN, (match) => sanitizeUrl(match).url || '[invalid-url]')
  value = value.replace(MAC_PATH_PATTERN, (match) => {
    const file = sanitizeFilePath(match)
    return `[path:${file.basename}:${file.pathHash}]`
  })
  value = value.replace(POSIX_PATH_PATTERN, (match) => {
    const file = sanitizeFilePath(match)
    return `[path:${file.basename}:${file.pathHash}]`
  })
  value = value.replace(WIN_PATH_PATTERN, (match) => {
    const file = sanitizeFilePath(match)
    return `[path:${file.basename}:${file.pathHash}]`
  })
  if (value.length > (options.maxString || MAX_STRING)) {
    return {
      value: `${value.slice(0, options.maxString || MAX_STRING)}...[truncated]`,
      truncated: true
    }
  }
  return { value, truncated: false }
}

function sanitizeReason(value, maxString = 160) {
  if (!value) return undefined
  return replaceSensitiveString(value, { maxString }).value
}

function sanitizeStageList(value = []) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ARRAY).map((entry) => ({
    stage: replaceSensitiveString(entry?.stage || 'unknown', { maxString: 80 }).value,
    reason: sanitizeReason(entry?.reason || entry?.message || 'failed')
  }))
}

function sanitizeStringList(value = []) {
  return Array.isArray(value)
    ? value
        .slice(0, MAX_ARRAY)
        .map((entry) => replaceSensitiveString(entry, { maxString: 80 }).value)
    : []
}

export function sanitizeStack(stack, options = {}) {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd()
  const raw = String(stack || '')
  const lines = raw.split('\n').slice(0, 30)
  return lines
    .map((line) => {
      let next = line.replace(/\((\/[^)]+):(\d+):(\d+)\)/g, (_match, file, row, col) => {
        const resolved = path.resolve(file)
        if (resolved.startsWith(projectRoot + path.sep)) {
          return `(${path.relative(projectRoot, resolved)}:${row}:${col})`
        }
        const basename = path.basename(file)
        return `(${basename}:absolutePathHash=${hashText(file)}:${row}:${col})`
      })
      next = next.replace(/at (\/[^\s]+):(\d+):(\d+)/g, (_match, file, row, col) => {
        const resolved = path.resolve(file)
        if (resolved.startsWith(projectRoot + path.sep)) {
          return `at ${path.relative(projectRoot, resolved)}:${row}:${col}`
        }
        return `at ${path.basename(file)}:absolutePathHash=${hashText(file)}:${row}:${col}`
      })
      return replaceSensitiveString(next).value
    })
    .join('\n')
}

export function sanitizeError(error, options = {}) {
  if (!error || typeof error !== 'object') {
    return { name: 'Error', message: replaceSensitiveString(String(error)).value }
  }
  return {
    name: replaceSensitiveString(error.name || 'Error').value,
    message: replaceSensitiveString(error.message || '').value,
    stack: sanitizeStack(error.stack || '', options)
  }
}

function sanitizeValue(value, options = {}, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) return { value: '[max-depth]', truncated: true }
  if (value instanceof Error) return { value: sanitizeError(value, options), truncated: false }
  if (value === null || value === undefined) return { value, truncated: false }
  if (typeof value === 'string') return replaceSensitiveString(value, options)
  if (typeof value === 'number' || typeof value === 'boolean') return { value, truncated: false }
  if (typeof value === 'bigint') return { value: String(value), truncated: false }
  if (typeof value === 'function') return { value: '[function]', truncated: false }
  if (Array.isArray(value)) {
    const clipped = value.slice(0, MAX_ARRAY)
    let truncated = value.length > clipped.length
    const items = clipped.map((item) => {
      const result = sanitizeValue(item, options, depth + 1, seen)
      truncated = truncated || result.truncated
      return result.value
    })
    return { value: items, truncated }
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return { value: '[circular]', truncated: true }
    seen.add(value)
    let truncated = false
    const output = {}
    for (const [key, nested] of Object.entries(value).slice(0, 50)) {
      const safeKey = replaceSensitiveString(key, { maxString: 100 }).value
      const result = sanitizeValue(nested, options, depth + 1, seen)
      truncated = truncated || result.truncated
      output[safeKey] = result.value
    }
    if (Object.keys(value).length > 50) truncated = true
    return { value: output, truncated }
  }
  return { value: String(value), truncated: false }
}

function sanitizeBounds(bounds = {}) {
  return {
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Number(bounds.width) || 0,
    height: Number(bounds.height) || 0
  }
}

function sanitizeStateSummary(summary = {}) {
  return {
    content: summary.content,
    fileKind: summary.fileKind,
    form: summary.form,
    hidden: Boolean(summary.hidden)
  }
}

function sanitizeStateAction(action = {}) {
  const output = { type: action.type }
  if (action.type === 'LOAD_URL') output.url = sanitizeUrl(action.payload?.url).url
  if (action.type === 'OPEN_FILE') output.kind = action.payload?.kind
  if (action.type === 'HYDRATE') output.payload = sanitizeStateSummary(action.payload)
  return output
}

function sanitizeFilename(input) {
  const raw = String(input || '')
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return sanitizeUrl(raw)
    if (url.protocol === 'file:') return sanitizeFilePath(raw)
  } catch {
    // Fall through to file-path summary for non-URL filenames.
  }
  return sanitizeFilePath(raw)
}

const DIAGNOSTIC_SOURCES = new Set(['main-window', 'popover-child', 'preferences', 'shortcut'])
const ADDRESS_COMMIT_SOURCES = new Set(['typed', 'history', 'site', 'search', 'empty-home'])
const SITE_URL_VALIDATION_SOURCES = new Set(['add', 'update', 'bookmark'])
const BOOKMARK_ACTIONS = new Set(['add', 'remove'])
const FONT_KINDS = new Set(['txt', 'epub'])
const FONT_FAMILIES = new Set(['default', 'serif', 'sans', 'kaiti', 'mono'])
const TRANSPARENCY_KINDS = new Set(['window', 'content', 'unified'])
const TRANSPARENCY_PREF_KEYS = new Set(['merged', 'windowLevel', 'contentLevel'])
const STEALTH_AUTO_HIDE_CAPABILITIES = new Set([
  'toolbar-hot-zone',
  'body-fade',
  'click-through',
  'drag',
  'webcontents-input',
  'popover-panel',
  'preferences-window',
  'boss-key',
  'maintenance-reset',
  'media-pause'
])
const STEALTH_AUTO_HIDE_SOURCES = new Set(['main-window', 'spike-harness'])
const STEALTH_AUTO_HIDE_TOGGLE_KINDS = new Set(['toolbar', 'body'])
const STEALTH_AUTO_HIDE_MODES = new Set(['off', 'toolbar-only', 'body-fade', 'click-through'])
const PLATFORM_FAMILIES = new Set(['mac', 'windows', 'linux', 'unknown'])
const MERGED_TRANSPARENCY_SYNC_SOURCES = new Set([
  'bottom-bar',
  'visual-popover',
  'preferences',
  'import',
  'startup',
  'maintenance-reset'
])
const MEDIA_ACTIONS = new Set(['insert-css', 'remove-css', 'noop'])
const SEARCH_ERROR_STAGES = new Set([
  'worker-create',
  'worker-error',
  'worker-message',
  'chapter-load',
  'chapter-build',
  'display-cfi'
])
const NUMERIC_RANGES = Object.freeze({
  wheelSpeed: { min: 0.1, max: 2.0, fallback: 1 },
  windowLevel: { min: 0.1, max: 0.95, fallback: 0.7 },
  contentLevel: { min: 0, max: 0.95, fallback: 0.6 }
})

function sanitizeSource(value) {
  return DIAGNOSTIC_SOURCES.has(value) ? value : 'main-window'
}

function sanitizeAddressCommitSource(value) {
  return ADDRESS_COMMIT_SOURCES.has(value) ? value : 'typed'
}

function sanitizeSiteValidationSource(value) {
  return SITE_URL_VALIDATION_SOURCES.has(value) ? value : 'add'
}

function sanitizeClampedNumber(value, range) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return range.fallback
  return Math.min(range.max, Math.max(range.min, value))
}

function sanitizeWheelSpeed(value) {
  return sanitizeClampedNumber(value, NUMERIC_RANGES.wheelSpeed)
}

function sanitizeTransparencyLevel(key, value) {
  return sanitizeClampedNumber(value, NUMERIC_RANGES[key])
}

function sanitizeNonNegativeInteger(value) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? Math.floor(next) : 0
}

function sanitizeSiteId(value) {
  if (typeof value !== 'string') return undefined
  return replaceSensitiveString(value.slice(0, 64), { maxString: 64 }).value
}

function sanitizeBookmarkAction(value) {
  return BOOKMARK_ACTIONS.has(value) ? value : undefined
}

function sanitizeFontKind(value) {
  return FONT_KINDS.has(value) ? value : undefined
}

function sanitizeFontFamily(value) {
  return FONT_FAMILIES.has(value) ? value : undefined
}

function sanitizeTransparencyKind(value) {
  return TRANSPARENCY_KINDS.has(value) ? value : undefined
}

function sanitizeStealthAutoHideCapability(value) {
  return STEALTH_AUTO_HIDE_CAPABILITIES.has(value) ? value : 'click-through'
}

function sanitizeStealthAutoHideSource(value) {
  return STEALTH_AUTO_HIDE_SOURCES.has(value) ? value : 'main-window'
}

function sanitizeStealthAutoHideToggleKind(value) {
  return STEALTH_AUTO_HIDE_TOGGLE_KINDS.has(value) ? value : 'toolbar'
}

function sanitizeStealthAutoHideMode(value) {
  return STEALTH_AUTO_HIDE_MODES.has(value) ? value : 'off'
}

function sanitizePlatformFamily(value) {
  return PLATFORM_FAMILIES.has(value) ? value : 'unknown'
}

function sanitizeStealthAutoHideReason(value, maxString = 160) {
  if (!value) return undefined
  const bareOriginPattern = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>]*)?/gi
  let reason = String(value)
  reason = reason.replace(FILE_URL_PATTERN, '[file]')
  reason = reason.replace(URL_PATTERN, '[url]')
  reason = reason.replace(bareOriginPattern, '[origin]')
  reason = reason.replace(MAC_PATH_PATTERN, '[path]')
  reason = reason.replace(POSIX_PATH_PATTERN, '[path]')
  reason = reason.replace(WIN_PATH_PATTERN, '[path]')
  return reason.length > maxString ? `${reason.slice(0, maxString)}...[truncated]` : reason
}

function sanitizeMergedTransparencySyncSource(value) {
  return MERGED_TRANSPARENCY_SYNC_SOURCES.has(value) ? value : 'bottom-bar'
}

function sanitizeTransparencyKeys(keys = []) {
  return Array.isArray(keys) ? keys.filter((key) => TRANSPARENCY_PREF_KEYS.has(key)) : []
}

function sanitizeTransparencyValues(values = {}, keys = []) {
  const out = {}
  for (const key of keys) {
    if (key === 'merged') out.merged = Boolean(values.merged)
    if (key === 'windowLevel') out.windowLevel = sanitizeTransparencyLevel(key, values.windowLevel)
    if (key === 'contentLevel')
      out.contentLevel = sanitizeTransparencyLevel(key, values.contentLevel)
  }
  return out
}

function sanitizeSearchPanel(data = {}) {
  return { open: Boolean(data.open), source: sanitizeSource(data.source) }
}

function sanitizeSearchQuery(data = {}) {
  return {
    queryLength: sanitizeNonNegativeInteger(data.queryLength),
    searchSeq: sanitizeNonNegativeInteger(data.searchSeq)
  }
}

function sanitizeSearchResult(data = {}) {
  return {
    queryLength: sanitizeNonNegativeInteger(data.queryLength),
    hitCount: sanitizeNonNegativeInteger(data.hitCount),
    truncated: Boolean(data.truncated),
    searchSeq: sanitizeNonNegativeInteger(data.searchSeq),
    chapterErrorCount:
      data.chapterErrorCount === undefined
        ? undefined
        : sanitizeNonNegativeInteger(data.chapterErrorCount)
  }
}

function sanitizeSearchJump(data = {}) {
  return {
    index: sanitizeNonNegativeInteger(data.index),
    hitCount: sanitizeNonNegativeInteger(data.hitCount),
    ok: Boolean(data.ok),
    reason: sanitizeReason(data.reason)
  }
}

function sanitizeSearchError(data = {}, options = {}) {
  return {
    stage: SEARCH_ERROR_STAGES.has(data.stage) ? data.stage : 'worker-error',
    spineIndex:
      data.spineIndex === undefined ? undefined : sanitizeNonNegativeInteger(data.spineIndex),
    error: sanitizeError(data.error, options)
  }
}

const EVENT_DATA_SANITIZERS = {
  'app.ready': (data) => ({ platform: data?.platform }),
  'app.before_quit': () => ({}),
  'app.window_all_closed': (data) => ({ platform: data?.platform }),
  'address.suggestions_request': (data) => ({
    queryLength: sanitizeNonNegativeInteger(data?.queryLength),
    limit: sanitizeNonNegativeInteger(data?.limit)
  }),
  'address.suggestions_result': (data) => ({
    ok: Boolean(data?.ok),
    hitCount: sanitizeNonNegativeInteger(data?.hitCount),
    historyCount: sanitizeNonNegativeInteger(data?.historyCount),
    siteCount: sanitizeNonNegativeInteger(data?.siteCount),
    reason: sanitizeReason(data?.reason),
    durationMs: data?.durationMs
  }),
  'address.commit': (data) => ({
    source: sanitizeAddressCommitSource(data?.source),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    url: data?.url ? sanitizeUrl(data.url).url : undefined
  }),
  'browser:open': (data) => ({ url: sanitizeUrl(data?.url).url }),
  'bookmark.refresh_result': (data, options) => ({
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'bookmark.toggle_result': (data, options) => ({
    action: sanitizeBookmarkAction(data?.action),
    ok: Boolean(data?.ok),
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    siteId: sanitizeSiteId(data?.siteId),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'diagnostic.enabled_change': (data, options) => ({
    enabled: Boolean(data?.enabled),
    source: sanitizeSource(data?.source),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'drag.drop_decision': (data) => ({
    ok: Boolean(data?.ok),
    kind: data?.kind,
    message: data?.message
      ? replaceSensitiveString(data.message, { maxString: 120 }).value
      : undefined
  }),
  'epub.hide_images_change': (data, options) => ({
    hideImages: Boolean(data?.hideImages),
    source: data?.source === 'epub-bottom-bar' ? data.source : 'epub-bottom-bar',
    ok: Boolean(data?.ok),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'epub.search_panel': sanitizeSearchPanel,
  'epub.search_query': sanitizeSearchQuery,
  'epub.search_result': sanitizeSearchResult,
  'epub.search_jump': sanitizeSearchJump,
  'epub.search_error': sanitizeSearchError,
  'file.menu_open_request': (data) => ({ kind: data?.kind }),
  'file.open.request': (data) => ({
    source: data?.source,
    kind: data?.kind,
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    hasPath: Boolean(data?.hasPath)
  }),
  'file.open.result': (data) => ({
    source: data?.source,
    kind: data?.kind,
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason)
  }),
  'file.open.stale_cleanup': (data) => ({
    kind: data?.kind,
    ok: Boolean(data?.ok),
    hasHistoryToken: Boolean(data?.hasHistoryToken)
  }),
  'file.reader_load_failed': (data, options) => ({
    source: data?.source,
    kind: data?.kind,
    error: sanitizeError(data?.error, options)
  }),
  'ipc.call': (data) => ({
    channel: data?.channel,
    payload: sanitizeValue(data?.payload || {}).value
  }),
  'ipc.result': (data) => ({
    channel: data?.channel,
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    message: data?.message
      ? replaceSensitiveString(data.message, { maxString: 120 }).value
      : undefined,
    durationMs: data?.durationMs
  }),
  'ipc.error': (data, options) => ({
    channel: data?.channel,
    durationMs: data?.durationMs,
    error: sanitizeError(data?.error, options)
  }),
  'main.uncaught_exception': (data, options) => ({ error: sanitizeError(data?.error, options) }),
  'main.unhandled_rejection': (data, options) => ({ error: sanitizeError(data?.error, options) }),
  'maintenance.cache_clear': (data, options) => ({
    ok: Boolean(data?.ok),
    cleared: sanitizeStringList(data?.cleared),
    failedStages: sanitizeStageList(data?.failedStages),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'maintenance.initialize': (data, options) => ({
    ok: Boolean(data?.ok),
    cleared: sanitizeStringList(data?.cleared),
    reset: sanitizeStringList(data?.reset),
    failedStages: sanitizeStageList(data?.failedStages),
    preserved: sanitizeStringList(data?.preserved),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'reader.auto_turn_toggle': (data) => ({ running: Boolean(data?.running) }),
  'reader.font_family_change': (data, options) => ({
    kind: sanitizeFontKind(data?.kind),
    fontFamily: sanitizeFontFamily(data?.fontFamily),
    source: sanitizeSource(data?.source),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'renderer.error': (data, options) => ({
    filename: data?.filename ? sanitizeFilename(data.filename) : undefined,
    lineno: data?.lineno,
    colno: data?.colno,
    error: sanitizeError(data?.error, options)
  }),
  'renderer.unhandled_rejection': (data, options) => ({
    error: sanitizeError(data?.error, options)
  }),
  'state.dispatch': (data) => ({
    action: sanitizeStateAction(data?.action),
    changed: Boolean(data?.changed),
    before: sanitizeStateSummary(data?.before),
    after: sanitizeStateSummary(data?.after)
  }),
  'startup_restore.start': () => ({}),
  'startup_restore.intent': (data) => ({ type: data?.type || null, fileKind: data?.fileKind }),
  'startup_restore.result': (data) => ({
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason)
  }),
  'startup_restore.exception': (data, options) => ({ error: sanitizeError(data?.error, options) }),
  'sites.url_validation_result': (data) => ({
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    source: sanitizeSiteValidationSource(data?.source),
    url: data?.url ? sanitizeUrl(data.url) : undefined
  }),
  'stealth_auto_hide.mouse_passthrough': (data) => ({
    enabled: Boolean(data?.enabled),
    ok: Boolean(data?.ok),
    reason: sanitizeStealthAutoHideReason(data?.reason),
    source: sanitizeStealthAutoHideSource(data?.source)
  }),
  'stealth_auto_hide.media_pause': (data) => ({
    attempted: sanitizeNonNegativeInteger(data?.attempted),
    paused: sanitizeNonNegativeInteger(data?.paused),
    ok: Boolean(data?.ok),
    reason: sanitizeStealthAutoHideReason(data?.reason)
  }),
  'stealth_auto_hide.spike_result': (data) => ({
    platformFamily: sanitizePlatformFamily(data?.platformFamily),
    capability: sanitizeStealthAutoHideCapability(data?.capability),
    ok: Boolean(data?.ok),
    reason: sanitizeStealthAutoHideReason(data?.reason)
  }),
  'stealth_auto_hide.toggle': (data) => ({
    kind: sanitizeStealthAutoHideToggleKind(data?.kind),
    value: Boolean(data?.value),
    gateActive: Boolean(data?.gateActive),
    mode: sanitizeStealthAutoHideMode(data?.mode)
  }),
  'stealth_auto_hide.restore': (data) => ({
    reason: sanitizeStealthAutoHideReason(data?.reason),
    modeBefore: sanitizeStealthAutoHideMode(data?.modeBefore)
  }),
  'stealth_auto_hide.restore_failed': (data) => ({
    reason: sanitizeStealthAutoHideReason(data?.reason),
    modeBefore: sanitizeStealthAutoHideMode(data?.modeBefore),
    failures: Array.isArray(data?.failures)
      ? data.failures.slice(0, 4).map((failure) => sanitizeStealthAutoHideReason(failure))
      : []
  }),
  'stealth_auto_hide.degraded': (data) => ({
    from: sanitizeStealthAutoHideMode(data?.from),
    to: sanitizeStealthAutoHideMode(data?.to),
    reason: sanitizeStealthAutoHideReason(data?.reason)
  }),
  'trackpad.gesture': (data) => ({
    source: data?.source,
    direction: data?.direction,
    content: data?.content,
    fileKind: data?.fileKind
  }),
  'transparency.toggle': (data, options) => ({
    kind: sanitizeTransparencyKind(data?.kind),
    value: Boolean(data?.value),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'transparency.prefs_change': (data, options) => {
    const keys = sanitizeTransparencyKeys(data?.keys)
    return {
      keys,
      values: sanitizeTransparencyValues(data?.values, keys),
      source: sanitizeSource(data?.source),
      ok: Boolean(data?.ok),
      reason: sanitizeReason(data?.reason),
      error: data?.error ? sanitizeError(data.error, options) : undefined
    }
  },
  'transparency.unified_plain_view_sync': (data, options) => ({
    value: Boolean(data?.value),
    ok: false,
    source: sanitizeMergedTransparencySyncSource(data?.source),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'txt.search_panel': sanitizeSearchPanel,
  'txt.search_query': sanitizeSearchQuery,
  'txt.search_result': sanitizeSearchResult,
  'txt.search_jump': sanitizeSearchJump,
  'txt.search_error': sanitizeSearchError,
  'web.intent_write_failed': (data, options) => ({
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    error: sanitizeError(data?.error, options)
  }),
  'web.media_visibility_change': (data, options) => ({
    requestedHideMedia: Boolean(data?.requestedHideMedia),
    acceptedHideMedia:
      data?.acceptedHideMedia === undefined ? undefined : Boolean(data.acceptedHideMedia),
    source: sanitizeSource(data?.source),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'web.media_apply_result': (data, options) => ({
    requestedHideMedia: Boolean(data?.requestedHideMedia),
    action: MEDIA_ACTIONS.has(data?.action) ? data.action : 'noop',
    activeView: Boolean(data?.activeView),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'web.open.request': (data) => ({
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    silent: Boolean(data?.silent),
    requestSeq: data?.requestSeq
  }),
  'web.open.result': (data) => ({
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    requestSeq: data?.requestSeq
  }),
  'web.nav_state': (data) => ({
    sourceEvent: data?.sourceEvent,
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    loading: Boolean(data?.loading),
    canBack: Boolean(data?.canBack),
    canForward: Boolean(data?.canForward)
  }),
  'web.fail_load': (data) => ({
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    code: data?.code,
    description: data?.description
      ? replaceSensitiveString(data.description, { maxString: 160 }).value
      : undefined,
    suppressed: Boolean(data?.suppressed)
  }),
  'web.window_open': (data) => ({
    url: data?.url ? sanitizeUrl(data.url).url : undefined,
    allowed: Boolean(data?.allowed)
  }),
  'web.wheel_speed_change': (data, options) => ({
    requestedWheelSpeed: sanitizeWheelSpeed(data?.requestedWheelSpeed),
    acceptedWheelSpeed:
      data?.acceptedWheelSpeed === undefined
        ? undefined
        : sanitizeWheelSpeed(data.acceptedWheelSpeed),
    source: sanitizeSource(data?.source),
    ok: Boolean(data?.ok),
    reason: sanitizeReason(data?.reason),
    error: data?.error ? sanitizeError(data.error, options) : undefined
  }),
  'window.create': (data) => ({
    bounds: sanitizeBounds(data?.bounds),
    alwaysOnTop: Boolean(data?.alwaysOnTop),
    windowOpacity: data?.windowOpacity
  }),
  'window.ready_to_show': () => ({}),
  'window.close': (data) => ({ bounds: sanitizeBounds(data?.bounds) }),
  'window.form_changed': (data) => ({ form: data?.form }),
  'boss.hide': () => ({}),
  'boss.restore': () => ({}),
  'boss.kill': () => ({}),
  'boss.shortcut_register': (data) => ({ accelerator: data?.accelerator, ok: Boolean(data?.ok) })
}

function sanitizeEventData(event, data, options) {
  const sanitizer = EVENT_DATA_SANITIZERS[event]
  if (!sanitizer) return { value: {}, truncated: data && Object.keys(data).length > 0 }
  const value = sanitizer(data || {}, options)
  return {
    value: Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)),
    truncated: false
  }
}

function sanitizeEventName(input, processName) {
  const event = replaceSensitiveString(input || 'diagnostic.event', { maxString: 120 }).value
  if (processName === 'renderer' && !RENDERER_ALLOWED_EVENTS.has(event)) return 'diagnostic.event'
  return EVENT_DATA_SANITIZERS[event] ? event : 'diagnostic.event'
}

export function summarizeIpcPayload(channel, args = []) {
  if (channel === 'address:suggestions') {
    return {
      queryLength: String(args[0]?.query || '').length,
      limit: sanitizeNonNegativeInteger(args[0]?.limit)
    }
  }
  if (channel === 'browser:open') {
    return {
      ...sanitizeUrl(args[0]),
      options: { silentPageMessages: Boolean(args[1]?.silentPageMessages) }
    }
  }
  if (/^(txt|epub|pdf):open$/.test(channel)) return { file: sanitizeFilePath(args[0]) }
  if (channel === 'history:open-file' || channel === 'startup-restore:open-file') {
    return {
      kind: args[0]?.kind || args[0]?.fileKind,
      file: sanitizeFilePath(args[0]?.path)
    }
  }
  if (channel.endsWith(':set') || channel === 'set-config') {
    return sanitizeValue(args).value
  }
  return { argc: args.length }
}

export function sanitizeDiagnosticEvent(input = {}, options = {}) {
  const level = ['debug', 'info', 'warn', 'error'].includes(input.level) ? input.level : 'info'
  const processName = ['main', 'preload', 'renderer'].includes(input.process)
    ? input.process
    : 'renderer'
  const event = sanitizeEventName(input.event, processName)
  const dataResult = sanitizeEventData(event, input.data || {}, options)
  return {
    event,
    level,
    process: processName,
    data: dataResult.value,
    truncated: Boolean(input.truncated || dataResult.truncated)
  }
}
