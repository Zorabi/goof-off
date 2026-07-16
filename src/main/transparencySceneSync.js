import { normalizeWebPrefs } from './webPrefs.js'

export const MERGED_PLAIN_VIEW_SYNC_SOURCES = new Set([
  'bottom-bar',
  'visual-popover',
  'preferences',
  'import',
  'startup',
  'maintenance-reset'
])

function sanitizeSource(source) {
  return MERGED_PLAIN_VIEW_SYNC_SOURCES.has(source) ? source : 'preferences'
}

export async function syncPlainViewForMergedTransparency({
  transparencyPrefs,
  source,
  getWebPrefs,
  setWebPrefs,
  applyCurrentWebPrefs,
  sendToWindows,
  diagnosticLogger
}) {
  if (!transparencyPrefs?.merged) return { ok: true, skipped: true }
  const safeSource = sanitizeSource(source)
  const target = transparencyPrefs.windowEnabled === true
  const current = normalizeWebPrefs(getWebPrefs?.())
  if (current.plainView === target) return { ok: true, changed: false, webPrefs: current }
  const next = normalizeWebPrefs({ ...current, plainView: target })
  let wroteNext = false

  try {
    setWebPrefs(next)
    wroteNext = true
    await applyCurrentWebPrefs?.({
      skipReload: true,
      ...(target === false ? { reloadForPlainViewDisable: true } : {})
    })
    sendToWindows?.('web-prefs:changed', next)
    return { ok: true, changed: true, webPrefs: next }
  } catch (error) {
    let rollbackError = null
    if (wroteNext) {
      try {
        setWebPrefs(current)
      } catch (err) {
        rollbackError = err
      }
    }
    const diagnosticPayload = { value: target, ok: false, source: safeSource, error }
    if (rollbackError) diagnosticPayload.rollbackError = rollbackError
    await diagnosticLogger?.error?.(
      'transparency.unified_plain_view_sync',
      diagnosticPayload,
      'main'
    )
    return { ok: false, error, webPrefs: current }
  }
}
