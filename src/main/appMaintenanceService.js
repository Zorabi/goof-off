import { randomUUID } from 'node:crypto'
import { session as electronSession } from 'electron'
import {
  buildDefaultManagedPrefs as buildRuntimeDefaultManagedPrefs,
  DEFAULT_SYSTEM_PREFS
} from './preferencesModel.js'
import { sanitizeDiagnosticEvent } from './diagnosticSanitizer.js'

export const MAINTENANCE_HOME_STATE = Object.freeze({
  content: 'home',
  fileKind: null,
  form: 'normal'
})

export const MAINTENANCE_DEFAULT_WINDOW_BOUNDS = Object.freeze({
  width: 420,
  height: 820
})

const CACHE_PENDING_KEYS = [
  'appState',
  'txtProgress',
  'epubProgress',
  'pdfProgress',
  'startupRestoreIntent',
  'siteWebPrefs'
]

const INIT_PENDING_KEYS = [
  ...CACHE_PENDING_KEYS,
  'webPrefs',
  'txtPrefs',
  'epubPrefs',
  'pdfPrefs',
  'fileVisualPrefs',
  'transparencyPrefs',
  'bossKeys',
  'startupPrefs',
  'historyPrefs',
  'themePrefs',
  'systemPrefs',
  'webHistory',
  'fileHistory',
  'customSites',
  'sitePresetPrefs',
  'windowBounds'
]

export function createAppMaintenanceService(deps = {}) {
  const store = deps.store
  const getMainWindow = deps.getMainWindow
  const session = deps.session || electronSession
  const id = deps.id || (() => randomUUID())
  const resetTimeoutMs = deps.resetTimeoutMs || 1500
  const pendingResets = new Map()

  function sanitizeFailure(stage, error) {
    const reason = error?.reason || error?.message || String(error || 'failed')
    const safe = sanitizeDiagnosticEvent({
      event: 'maintenance.initialize',
      level: 'warn',
      process: 'main',
      data: {
        failedStages: [{ stage, reason }]
      }
    })?.data?.failedStages?.[0]
    return {
      stage: safe?.stage || 'unknown',
      reason: safe?.reason || 'failed'
    }
  }

  function recordFailure(failedStages, stage, error) {
    failedStages.push(sanitizeFailure(stage, error))
  }

  async function runStage(failedStages, stage, fn) {
    try {
      const result = await fn()
      if (result && result.ok === false) recordFailure(failedStages, stage, result)
      return result
    } catch (error) {
      recordFailure(failedStages, stage, error)
      return { ok: false, reason: error?.message || stage }
    }
  }

  function completeRendererReset(requestId, result = {}) {
    const pending = pendingResets.get(requestId)
    if (!pending) return { ok: false, reason: 'unknown-request' }
    pendingResets.delete(requestId)
    pending.resolve(result?.ok === false ? result : { ok: true })
    return { ok: true }
  }

  async function requestRendererReset(operation, failedStages) {
    const mainWindow = getMainWindow?.()
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      recordFailure(failedStages, 'renderer-reset', { reason: 'main-window-missing' })
      return
    }

    const requestId = id()
    const payload = {
      requestId,
      operation,
      targetState: MAINTENANCE_HOME_STATE,
      discardProgress: true
    }
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingResets.delete(requestId)
        resolve({ ok: false, reason: 'timeout' })
      }, resetTimeoutMs)
      timer.unref?.()
      pendingResets.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        }
      })
      mainWindow.webContents.send('maintenance:reset-requested', payload)
    })

    if (!result?.ok) recordFailure(failedStages, 'renderer-reset', result)
  }

  function clearCacheStoreKeys() {
    store.set('txtProgress', {})
    store.set('epubProgress', {})
    store.set('pdfProgress', {})
    store.set('startupRestoreIntent', null)
    store.set('siteWebPrefs', {})
    store.set('appState', { ...MAINTENANCE_HOME_STATE })
  }

  async function cancelPendingStage(failedStages, stage, keys) {
    await runStage(failedStages, stage, () => ({
      ok: true,
      cancelled: deps.cancelPendingKeys?.(keys) || []
    }))
  }

  async function clearCache(options = {}) {
    const logEvent = options.logEvent !== false
    const operation = options.operation || 'cache-clear'
    const failedStages = []
    await runStage(
      failedStages,
      'mouse-passthrough',
      () => deps.restoreMousePassthrough?.('maintenance-reset') || { ok: true }
    )
    await runStage(
      failedStages,
      'body-visibility',
      () => deps.restoreStealthBodyVisibility?.('maintenance-reset') || { ok: true }
    )
    await runStage(
      failedStages,
      'window-leave-watcher',
      () => deps.disableWindowLeaveWatcher?.() || { ok: true }
    )
    await requestRendererReset(operation, failedStages)
    await runStage(failedStages, 'in-flight', () => deps.webviewManager.resetForMaintenance())
    await runStage(failedStages, 'history-pending', () => deps.historyService.clearPending())
    await runStage(failedStages, 'txt-runtime', () => deps.txtService.resetForMaintenance())
    await runStage(failedStages, 'epub-runtime', () => deps.epubService.resetForMaintenance())
    await runStage(failedStages, 'pdf-runtime', () => deps.pdfService.resetForMaintenance())
    await cancelPendingStage(failedStages, 'pending-cancel', CACHE_PENDING_KEYS)
    await runStage(failedStages, 'store-cache', () => clearCacheStoreKeys())
    await runStage(failedStages, 'electron-cache', () => session.defaultSession.clearCache())

    const result = {
      ok: failedStages.length === 0,
      cleared: [
        'electron-cache',
        'progress',
        'startup-restore',
        'site-web-prefs',
        'runtime-sessions',
        'app-state'
      ],
      failedStages
    }
    if (logEvent) {
      await deps.diagnosticLogger?.[result.ok ? 'info' : 'warn']?.(
        'maintenance.cache_clear',
        result,
        'main'
      )
    }
    return result
  }

  async function initializeApp() {
    const base = await clearCache({ logEvent: false, operation: 'initialize' })
    const failedStages = [...base.failedStages]
    const initPrefs = deps.buildDefaultManagedPrefs?.() || buildRuntimeDefaultManagedPrefs()
    await cancelPendingStage(failedStages, 'init-pending-cancel', INIT_PENDING_KEYS)
    await runStage(failedStages, 'history-reset', () => {
      store.set('webHistory', [])
      store.set('fileHistory', [])
    })
    await runStage(failedStages, 'sites-reset', () => {
      const nextSites = deps.sitesService.clearAll()
      const nextPresetPrefs = deps.sitesService.clearPresetPrefs()
      const nextOrder = deps.sitesService.clearOrder()
      store.set('customSites', nextSites)
      store.set('sitePresetPrefs', nextPresetPrefs)
      store.set('siteOrder', nextOrder)
      return { customSites: nextSites, sitePresetPrefs: nextPresetPrefs, siteOrder: nextOrder }
    })
    await runStage(failedStages, 'window-bounds-reset', () => {
      const nextBounds = { ...MAINTENANCE_DEFAULT_WINDOW_BOUNDS }
      store.set('windowBounds', nextBounds)
      return deps.resetMainWindowBounds?.({ ...nextBounds }) || { ok: true }
    })
    await runStage(failedStages, 'prefs-reset', async () => {
      const {
        transparencyPrefs,
        bossKeys,
        systemPrefs = DEFAULT_SYSTEM_PREFS,
        ...plainPrefs
      } = initPrefs
      for (const [key, value] of Object.entries(plainPrefs)) store.set(key, value)
      deps.replaceTransparencyPrefs(transparencyPrefs, { persist: 'sync' })
      await deps.syncPlainViewForMergedTransparency?.(transparencyPrefs, 'maintenance-reset')
      const bossResult = deps.applyBossKeys(bossKeys)
      store.set('bossKeys', bossResult.keys)
      const mainWindow = getMainWindow?.()
      const systemResult = (await deps.applySystemVisibilityPrefs?.(systemPrefs, {
        win: mainWindow && !mainWindow.isDestroyed?.() ? mainWindow : null
      })) || { ok: true, prefs: systemPrefs }
      if (systemResult.ok === false) {
        return { ok: false, reason: systemResult.reason || 'system-visibility-failed' }
      }
      store.set('systemPrefs', systemResult.prefs || systemPrefs)
      if (bossResult.failures?.length) {
        return {
          ok: false,
          reason: `boss-key-register-failed:${bossResult.failures.join(',')}`
        }
      }
      return { ok: true }
    })
    await runStage(failedStages, 'electron-storage', () =>
      session.defaultSession.clearStorageData()
    )

    const result = {
      ok: failedStages.length === 0,
      cleared: base.cleared,
      reset: [
        'history',
        'custom-sites',
        'site-preset-prefs',
        'window-bounds',
        'business-prefs',
        'web-storage'
      ],
      preserved: ['diagnosticPrefs', 'diagnosticLogs'],
      failedStages
    }
    await deps.diagnosticLogger?.[result.ok ? 'info' : 'warn']?.(
      'maintenance.initialize',
      result,
      'main'
    )
    return result
  }

  return { clearCache, initializeApp, completeRendererReset }
}
