import { app } from 'electron'
import store from './store.js'
import { normalizeSystemPrefs } from './preferencesModel.js'

export function getSystemPrefs() {
  return normalizeSystemPrefs(store.get('systemPrefs'))
}

export function shouldSkipTaskbar(prefs = getSystemPrefs()) {
  return normalizeSystemPrefs(prefs).showInTaskbarOrDock === false
}

export async function applySystemVisibilityPrefs(prefs, options = {}) {
  const normalized = normalizeSystemPrefs(prefs)
  const platform = options.platform || process.platform
  const rawWin = options.win || null
  const win = rawWin && !rawWin.isDestroyed?.() ? rawWin : null
  const appRef = options.appRef || app

  try {
    if (platform === 'win32') {
      win?.setSkipTaskbar?.(normalized.showInTaskbarOrDock === false)
      return { ok: true, prefs: normalized }
    }
    if (platform === 'darwin') {
      if (!appRef?.dock) return { ok: false, prefs: normalized, reason: 'dock-unavailable' }
      if (normalized.showInTaskbarOrDock) await appRef.dock.show()
      else await appRef.dock.hide()
      return { ok: true, prefs: normalized }
    }
    return { ok: true, prefs: normalized }
  } catch (error) {
    return {
      ok: false,
      prefs: normalized,
      reason: error?.message || 'system-visibility-apply-failed'
    }
  }
}
