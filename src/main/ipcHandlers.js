import fsp from 'node:fs/promises'
import { extname } from 'node:path'
import { app, dialog, ipcMain, nativeTheme, session } from 'electron'
import {
  getMainWindow,
  resetMainWindowBoundsForMaintenance,
  setWindowForm
} from './windowManager.js'
import { applyShadowPolicy, applyTransparency } from './windowEffects.js'
import store, {
  persistDebounced,
  flushPending as flushStorePending,
  cancelPendingKeys
} from './store.js'
import { normalizeWebPrefs, sanitizeWebPrefsPatch } from './webPrefs.js'
import {
  MANAGED_PREF_KEYS,
  buildDefaultManagedPrefs,
  buildPreferenceBundlePrefs,
  mergeImportedPrefs,
  normalizeDiagnosticPrefs,
  normalizeHistoryPrefs,
  normalizeStartupPrefs,
  normalizeSystemPrefs,
  normalizeThemePrefs,
  sanitizeDiagnosticPrefsPatch,
  sanitizeHistoryPrefsPatch,
  sanitizeStartupPrefsPatch,
  sanitizeSystemPrefsPatch,
  sanitizeThemePrefsPatch
} from './preferencesModel.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import {
  normalizeFileVisualPrefs,
  sanitizeFileVisualPrefsPatch
} from '../shared/fileVisualPrefs.js'
import {
  getEffectiveOpacity,
  getTransparencyPrefs,
  replaceTransparencyPrefs,
  updateTransparencyPrefs
} from './transparencyService.js'
import * as webviewManager from './webviewManager.js'
import * as sitesService from './sitesService.js'
import * as bossKeyService from './bossKeyService.js'
import * as windowMousePassthrough from './windowMousePassthrough.js'
import * as windowLeaveWatcher from './windowLeaveWatcher.js'
import * as stealthBodyVisibility from './stealthBodyVisibility.js'
import * as preferencesWindow from './preferencesWindow.js'
import * as txtService from './txtService.js'
import * as popoverWindowManager from './popoverWindowManager.js'
import { createEpubService } from './epubService.js'
import { createHistoryService } from './historyService.js'
import { normalizeStartupRestoreIntent } from './startupRestoreIntent.js'
import { diagnosticLogger as defaultDiagnosticLogger } from './diagnosticLogger.js'
import { summarizeIpcPayload } from './diagnosticSanitizer.js'
import { createAppMaintenanceService } from './appMaintenanceService.js'
import { syncPlainViewForMergedTransparency } from './transparencySceneSync.js'
import { getAddressSuggestions } from './addressSuggestionsService.js'
import { applySystemVisibilityPrefs, getSystemPrefs } from './systemVisibilityPrefs.js'

const PROTECTED_CONFIG_KEYS = new Set(['startupRestoreIntent', 'diagnosticPrefs'])
const MAIN_ALLOWED_WEB_PREFS = ['plainView', 'hideMedia', 'wheelSpeed']
const MAIN_ALLOWED_TXT_PREFS = ['fontSize', 'lineHeight', 'fontFamily', 'autoTurnSec']
const MAIN_ALLOWED_EPUB_PREFS = [
  'fontSize',
  'lineHeight',
  'fontFamily',
  'defaultMode',
  'autoTurnSec'
]

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isConfigPathAtOrUnder(key, rootKey) {
  return (
    typeof key === 'string' &&
    (key === rootKey || key.startsWith(`${rootKey}.`) || key.startsWith(`${rootKey}[`))
  )
}

function keyTouchesAnyConfigRoot(key, roots) {
  for (const root of roots) {
    if (isConfigPathAtOrUnder(key, root)) return true
  }
  return false
}

function touchesAnyConfigRoot(keyOrObject, roots) {
  if (typeof keyOrObject === 'string') return keyTouchesAnyConfigRoot(keyOrObject, roots)
  if (!isPlainObject(keyOrObject)) return false
  return Object.keys(keyOrObject).some((key) => keyTouchesAnyConfigRoot(key, roots))
}

export function registerIpcHandlers({
  pdfService,
  diagnosticLogger = defaultDiagnosticLogger
} = {}) {
  const platformPolicy = getRuntimePlatformPolicy()
  const historyService = createHistoryService(store)
  const epubService = createEpubService(store, persistDebounced)
  let managedPreferenceTransactionTail = Promise.resolve()
  webviewManager.setHistoryService(historyService)

  function enqueueManagedPreferenceTransaction(task) {
    const previous = managedPreferenceTransactionTail
    const current = previous.catch(() => {}).then(task)
    managedPreferenceTransactionTail = current
    void current
      .finally(() => {
        if (managedPreferenceTransactionTail === current) {
          managedPreferenceTransactionTail = Promise.resolve()
        }
      })
      .catch(() => {})
    return current
  }

  function summarizeResult(result) {
    if (result && typeof result === 'object') {
      return {
        ok: result.ok !== false,
        reason: result.reason,
        message: result.ok === false ? result.message : undefined
      }
    }
    return { ok: true }
  }

  function siteValidationResult(error) {
    if (error?.reason === 'invalid-url-scheme') {
      return { ok: false, reason: 'invalid-url-scheme', message: '站点地址仅支持 http/https' }
    }
    if (error?.reason === 'invalid-url') {
      return { ok: false, reason: 'invalid-url', message: '站点地址不可用' }
    }
    throw error
  }

  function isStealthSpikeHarnessEnabled() {
    return process.env.GOOF_OFF_STEALTH_SPIKE === '1' && app.isPackaged === false
  }

  function registerLoggedHandle(channel, handler, options = {}) {
    const loggedHandler = async (event, ...args) => {
      const startedAt = Date.now()
      if (options.logCalls !== false) {
        diagnosticLogger.event(
          'info',
          'ipc.call',
          { channel, payload: summarizeIpcPayload(channel, args) },
          'main'
        )
      }
      try {
        const result = await handler(event, ...args)
        const summary = summarizeResult(result)
        const level = summary.ok ? 'info' : 'warn'
        if (options.logSuccess !== false || !summary.ok) {
          diagnosticLogger.event(
            level,
            'ipc.result',
            {
              channel,
              ...summary,
              durationMs: Date.now() - startedAt
            },
            'main'
          )
        }
        return result
      } catch (error) {
        diagnosticLogger.event(
          'error',
          'ipc.error',
          {
            channel,
            durationMs: Date.now() - startedAt,
            error
          },
          'main'
        )
        throw error
      }
    }
    loggedHandler.toString = () => handler.toString()
    ipcMain.handle(channel, loggedHandler)
  }

  function isDiagnosticSender(sender) {
    return isMainSender(sender) || isPreferencesSender(sender)
  }

  ipcMain.handle('diagnostic:log', async (e, payload = {}) => {
    if (!isDiagnosticSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const level = ['debug', 'info', 'warn', 'error'].includes(payload.level)
      ? payload.level
      : 'info'
    const event = typeof payload.event === 'string' ? payload.event : 'renderer.event'
    const data = payload && typeof payload === 'object' ? payload.data || {} : {}
    const result = await diagnosticLogger.event(level, event, data, 'renderer')
    return result?.ok ? { ok: true } : { ok: false, reason: result?.reason || 'write-failed' }
  })

  ipcMain.handle('diagnostic:get-log-path', async (e) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return { ok: true, path: diagnosticLogger.getLogPath() }
  })

  function getDiagnosticPrefs() {
    return normalizeDiagnosticPrefs(store.get('diagnosticPrefs'))
  }

  ipcMain.handle('diagnostic-prefs:get', (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return getDiagnosticPrefs()
  })

  ipcMain.handle('diagnostic-prefs:set', async (e, patch = {}) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const current = getDiagnosticPrefs()
      const clean = sanitizeDiagnosticPrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const next = normalizeDiagnosticPrefs({ ...current, ...clean })
      if (current.enabled === next.enabled) return current
      if (!next.enabled) {
        await diagnosticLogger.info(
          'diagnostic.enabled_change',
          { enabled: false, source: 'preferences', ok: true },
          'main'
        )
        store.set('diagnosticPrefs', next)
      } else {
        store.set('diagnosticPrefs', next)
        await diagnosticLogger.info(
          'diagnostic.enabled_change',
          { enabled: true, source: 'preferences', ok: true },
          'main'
        )
      }
      sendToWindows('diagnostic-prefs:changed', next)
      return next
    })
  })

  ipcMain.handle('history:list', () => historyService.list())
  ipcMain.handle('history:clear-web', () => {
    const result = historyService.clearWeb()
    broadcastHistoryChanged()
    return result
  })
  ipcMain.handle('history:clear-files', () => {
    const result = historyService.clearFiles()
    broadcastHistoryChanged()
    return result
  })
  ipcMain.handle('history:remove-web', async (_e, id) => {
    const result = historyService.removeWeb(id)
    broadcastHistoryChanged()
    return result
  })
  ipcMain.handle('history:remove-file', async (_e, id) => {
    const result = historyService.removeFile(id)
    broadcastHistoryChanged()
    return result
  })
  ipcMain.handle('history:commit-file', (_e, token) => historyService.commitPendingFile(token))
  ipcMain.handle('history:discard-file', (_e, token) => historyService.discardPendingFile(token))

  registerLoggedHandle('address:suggestions', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const query = typeof payload.query === 'string' ? payload.query : ''
    const limit = Math.min(5, Math.max(0, Number(payload.limit) || 5))
    const startedAt = Date.now()
    await diagnosticLogger.event(
      'info',
      'address.suggestions_request',
      { queryLength: query.length, limit },
      'main'
    )
    try {
      const result = getAddressSuggestions({ query, limit, historyService, sitesService })
      await diagnosticLogger.event(
        'info',
        'address.suggestions_result',
        {
          ok: true,
          hitCount: result.items.length,
          historyCount: result.meta.historyCount,
          siteCount: result.meta.siteCount,
          durationMs: Date.now() - startedAt
        },
        'main'
      )
      return { ok: true, items: result.items }
    } catch (error) {
      await diagnosticLogger.event(
        'warn',
        'address.suggestions_result',
        { ok: false, reason: error?.reason || 'failed', durationMs: Date.now() - startedAt },
        'main'
      )
      return { ok: false, reason: error?.reason || 'failed', items: [] }
    }
  })

  ipcMain.handle('get-config', (_e, key) => {
    if (touchesAnyConfigRoot(key, PROTECTED_CONFIG_KEYS)) return null
    return store.get(key)
  })

  ipcMain.handle('set-config', (_e, key, value) => {
    if (touchesAnyConfigRoot(key, PROTECTED_CONFIG_KEYS)) return false
    if (touchesAnyConfigRoot(key, MANAGED_PREF_KEYS)) return false
    store.set(key, value)
    return true
  })

  ipcMain.handle('set-always-on-top', (_e, value) => {
    const win = getMainWindow()
    if (win) {
      win.setAlwaysOnTop(value)
      persistDebounced('alwaysOnTop', value)
    }
  })

  ipcMain.handle('get-theme', () => {
    return nativeTheme.shouldUseDarkColors
  })

  ipcMain.on('minimize-window', () => {
    const win = getMainWindow()
    if (win) win.minimize()
  })

  ipcMain.on('close-window', () => {
    const win = getMainWindow()
    if (win) win.close()
  })

  ipcMain.on('quit-app', () => {
    app.quit()
  })

  registerLoggedHandle('browser:open', (_e, url, options = {}) =>
    webviewManager.openSite(url, options)
  )
  registerLoggedHandle('browser:set-visible', (_e, visible) => {
    if (visible === true) {
      webviewManager.showIfReady()
    } else {
      webviewManager.hide()
    }
  })
  ipcMain.handle('browser:home', () => webviewManager.hide())
  ipcMain.handle('browser:back', () => webviewManager.goBack())
  ipcMain.handle('browser:forward', () => webviewManager.goForward())
  ipcMain.handle('browser:reload', () => webviewManager.reload())
  ipcMain.handle('browser:popover-zone', (e, h) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return h ? webviewManager.requestPopoverZone(h) : webviewManager.releasePopoverZone()
  })
  ipcMain.handle('browser:chrome-reserve', (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId : ''
    if (!ownerId) return { ok: false, reason: 'invalid-owner' }
    if ((Number(payload.size) | 0) <= 0) {
      webviewManager.releaseChromeReserve(ownerId)
    } else {
      webviewManager.requestChromeReserve(payload)
    }
    return { ok: true }
  })
  registerLoggedHandle('browser:stealth-opacity-multiplier', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const raw = Number(payload?.multiplier)
    const multiplier = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
    const result = await webviewManager.applyStealthContentOpacityMultiplier(multiplier)
    if (result?.ok === false) {
      return {
        ok: false,
        reason: result.reason || 'opacity-multiplier-failed',
        ...(result.message ? { message: result.message } : {}),
        multiplier
      }
    }
    return { ok: true, multiplier }
  })
  ipcMain.handle('browser:stealth-body-activity-bridge', (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const enabled = payload?.enabled === true
    webviewManager.setStealthBodyActivityBridgeEnabled(enabled)
    return { ok: true, enabled }
  })
  ipcMain.handle('browser:pause-active-media-for-stealth', (e) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return webviewManager.pauseActiveMediaForStealth()
  })
  ipcMain.handle('browser:set-session-zoom', (e, zoom) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.5 || zoom > 2.0) {
      return { ok: false, reason: 'invalid-zoom' }
    }
    webviewManager.setSessionZoom(zoom)
    return { ok: true, zoom }
  })

  ipcMain.handle('popover:open', (e, payload) => {
    if (!popoverWindowManager.isMainSender(e.sender)) return false
    return popoverWindowManager.openPopover(payload)
  })
  ipcMain.handle('popover:close', (e, payload) => {
    if (!popoverWindowManager.isMainSender(e.sender)) return false
    return popoverWindowManager.closePopover(payload)
  })
  ipcMain.handle('popover:update-snapshot', (e, payload) => {
    if (!popoverWindowManager.isMainSender(e.sender)) return false
    return popoverWindowManager.updateSnapshot(payload)
  })
  ipcMain.handle('popover:is-child-focused', (e) => {
    if (!popoverWindowManager.isMainSender(e.sender)) return false
    return popoverWindowManager.isChildPopoverFocused()
  })
  ipcMain.handle('popover:measure-ready', (e, payload) => {
    return popoverWindowManager.measureReady({ sender: e.sender, payload })
  })
  ipcMain.handle('popover:action', (e, payload) => {
    return popoverWindowManager.forwardChildAction({ sender: e.sender, payload })
  })
  ipcMain.handle('popover:request-close', (e, payload) => {
    return popoverWindowManager.requestCloseFromChild({ sender: e.sender, payload })
  })

  ipcMain.handle('sites:list', () => sitesService.list())
  ipcMain.handle('sites:add', async (_e, draft) => {
    try {
      const site = sitesService.add(draft)
      broadcastSitesChanged()
      return site
    } catch (error) {
      return siteValidationResult(error)
    }
  })
  ipcMain.handle('sites:update', async (_e, id, patch) => {
    try {
      const site = sitesService.update(id, patch)
      broadcastSitesChanged()
      return site
    } catch (error) {
      return siteValidationResult(error)
    }
  })
  ipcMain.handle('sites:remove', (_e, id) => {
    const result = sitesService.remove(id)
    broadcastSitesChanged()
    return result
  })
  ipcMain.handle('sites:preset-prefs:get', () => sitesService.listPresetPrefs())
  ipcMain.handle('sites:preset:update', async (_e, id, patch) => {
    try {
      const site = sitesService.updatePreset(id, patch)
      broadcastSitePresetPrefsChanged()
      return site
    } catch (error) {
      return siteValidationResult(error)
    }
  })
  ipcMain.handle('sites:preset:remove', (_e, id) => {
    const result = sitesService.removePreset(id)
    broadcastSitePresetPrefsChanged()
    return result
  })
  ipcMain.handle('sites:order:get', () => sitesService.listOrder())
  ipcMain.handle('sites:order:set', (_e, ids) => {
    const next = sitesService.setOrder(ids)
    broadcastSiteOrderChanged()
    return next
  })

  ipcMain.handle('app-state:get', async (_e, options = {}) => {
    const startupPrefs = normalizeStartupPrefs(store.get('startupPrefs'))
    const persisted = store.get('appState')
    if (options?.purpose !== 'startup-hydrate') return persisted
    if (!startupPrefs.restoreShellState) return null
    if (
      persisted?.content === 'web' ||
      persisted?.content === 'file' ||
      persisted?.content === 'history'
    ) {
      return { content: 'home', fileKind: null, form: 'normal', hidden: false }
    }
    return { content: 'home', fileKind: null, form: 'normal', hidden: false }
  })

  registerLoggedHandle(
    'app-state:persist',
    (_e, partial) => {
      const merged = webviewManager.updateAppStateForRuntime(partial)
      persistDebounced('appState', merged)
      const prefsWin = preferencesWindow.getWindow()
      if (prefsWin && !prefsWin.isDestroyed()) {
        prefsWin.webContents.send('app-state:changed', merged)
      }
    },
    { logSuccess: false }
  )

  ipcMain.handle('boss-key:get', () => {
    return store.get('bossKeys')
  })

  ipcMain.handle('boss-key:set', (e, which, accelerator) => {
    if (!isPreferencesSender(e.sender)) return false
    return enqueueManagedPreferenceTransaction(async () => {
      const ok = bossKeyService.setKey(which, accelerator)
      if (ok) sendToWindows('boss-key:changed', store.get('bossKeys'))
      return ok
    })
  })

  ipcMain.handle('boss-key:reset', (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const { keys, failures } = bossKeyService.resetKeys()
      sendToWindows('boss-key:changed', keys)
      return { ok: true, keys, failures }
    })
  })

  function getStoredWebPrefs() {
    return normalizeWebPrefs(store.get('webPrefs'), platformPolicy)
  }

  function getThemePrefs() {
    return normalizeThemePrefs(store.get('themePrefs'))
  }

  function themeSourceForMode(mode) {
    return mode === 'auto' ? 'system' : mode
  }

  function applyThemePrefs(prefs = getThemePrefs()) {
    const normalized = normalizeThemePrefs(prefs)
    nativeTheme.themeSource = themeSourceForMode(normalized.mode)
    return normalized
  }

  function broadcastThemePrefs(prefs = getThemePrefs()) {
    sendToWindows('theme-prefs:changed', normalizeThemePrefs(prefs))
  }

  function broadcastEffectiveTheme() {
    sendToWindows('theme-changed', nativeTheme.shouldUseDarkColors)
  }

  async function syncMergedPlainView(transparencyPrefs, source) {
    return syncPlainViewForMergedTransparency({
      transparencyPrefs,
      source,
      getWebPrefs: getStoredWebPrefs,
      setWebPrefs: (next) => store.set('webPrefs', next),
      applyCurrentWebPrefs: (options) => webviewManager.applyCurrentWebPrefs(options),
      sendToWindows,
      diagnosticLogger
    })
  }

  function applyCurrentTransparency() {
    const effective = getEffectiveOpacity()
    applyTransparency(effective)
    return effective
  }

  function areTransparencyPrefsEqual(a, b) {
    return (
      a.merged === b.merged &&
      a.windowEnabled === b.windowEnabled &&
      a.contentEnabled === b.contentEnabled &&
      a.windowLevel === b.windowLevel &&
      a.contentLevel === b.contentLevel
    )
  }

  ipcMain.handle('web-prefs:get', () => {
    return getStoredWebPrefs()
  })

  ipcMain.handle('transparency-prefs:get', (e) => {
    if (!isMainSender(e.sender) && !isPreferencesSender(e.sender)) return null
    return getTransparencyPrefs()
  })

  ipcMain.handle('transparency-prefs:set', async (e, payload = {}) => {
    const fromMain = isMainSender(e.sender)
    const fromPreferences = isPreferencesSender(e.sender)
    if (!fromMain && !fromPreferences) return null
    return enqueueManagedPreferenceTransaction(async () => {
      const current = getTransparencyPrefs()
      if (payload.toggle && !fromMain) return current
      if (!payload.patch && !payload.toggle) return current
      const allowedPayload = payload.patch
        ? (() => {
            const allowedKeys = fromPreferences
              ? ['merged', 'windowLevel', 'contentLevel']
              : ['contentLevel']
            const patch = Object.fromEntries(
              allowedKeys
                .filter((key) => Object.prototype.hasOwnProperty.call(payload.patch, key))
                .map((key) => [key, payload.patch[key]])
            )
            return Object.keys(patch).length > 0 ? { patch } : null
          })()
        : { toggle: payload.toggle }
      if (!allowedPayload) return current
      const next = updateTransparencyPrefs(allowedPayload)
      if (areTransparencyPrefsEqual(current, next)) return current
      if (
        allowedPayload.patch &&
        Object.prototype.hasOwnProperty.call(allowedPayload.patch, 'merged') &&
        next.merged === true
      ) {
        await syncMergedPlainView(next, 'preferences')
      }
      applyCurrentTransparency()
      sendToWindows('transparency-prefs:changed', next)
      return next
    })
  })

  ipcMain.handle('web-prefs:set', async (e, patch) => {
    const fromPreferences = isPreferencesSender(e.sender)
    return enqueueManagedPreferenceTransaction(async () => {
      const current = getStoredWebPrefs()
      const allowedPatch = fromPreferences
        ? patch
        : Object.fromEntries(
            MAIN_ALLOWED_WEB_PREFS.filter((key) =>
              Object.prototype.hasOwnProperty.call(patch || {}, key)
            ).map((key) => [key, patch[key]])
          )
      const clean = sanitizeWebPrefsPatch(allowedPatch)
      if (Object.keys(clean).length === 0) return current
      const merged = normalizeWebPrefs({ ...current, ...clean }, platformPolicy)
      const reloadForPlainViewDisable =
        Object.prototype.hasOwnProperty.call(clean, 'plainView') &&
        current.plainView === true &&
        merged.plainView === false
      const plainViewReloadOptions = reloadForPlainViewDisable
        ? { reloadForPlainViewDisable: true }
        : {}
      store.set('webPrefs', merged)
      if (fromPreferences) {
        if (reloadForPlainViewDisable)
          await webviewManager.applyCurrentWebPrefs(plainViewReloadOptions)
        else await webviewManager.applyCurrentWebPrefs()
      } else {
        await webviewManager.applyCurrentWebPrefs({ skipReload: true, ...plainViewReloadOptions })
      }
      sendToWindows('web-prefs:changed', merged)
      sendToWindows('site-web-prefs:changed', webviewManager.getCurrentSiteWebPrefs())
      return merged
    })
  })

  ipcMain.handle('site-web-prefs:get-current', () => webviewManager.getCurrentSiteWebPrefs())
  ipcMain.handle('site-web-prefs:set-current', async (e, patch) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const result = await webviewManager.setCurrentSiteWebPrefs(patch)
      sendToWindows('site-web-prefs:changed', result)
      return result
    })
  })
  ipcMain.handle('site-web-prefs:clear-current', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const result = await webviewManager.clearCurrentSiteWebPrefs()
      sendToWindows('site-web-prefs:changed', result)
      return result
    })
  })

  ipcMain.handle('file-visual-prefs:get', () => {
    return normalizeFileVisualPrefs(store.get('fileVisualPrefs'))
  })

  function isPreferencesSender(sender) {
    const prefsWin = preferencesWindow.getWindow()
    return Boolean(prefsWin && !prefsWin.isDestroyed() && prefsWin.webContents === sender)
  }

  function isMainSender(sender) {
    const mainWin = getMainWindow()
    return Boolean(mainWin && !mainWin.isDestroyed() && mainWin.webContents === sender)
  }

  function sendToWindows(channel, payload) {
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload)
    const prefsWin = preferencesWindow.getWindow()
    if (prefsWin && !prefsWin.isDestroyed()) prefsWin.webContents.send(channel, payload)
  }

  function sendToMainWindow(channel, payload) {
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload)
  }

  function broadcastHistoryChanged() {
    sendToMainWindow('history:changed', historyService.list())
  }

  function broadcastSitesChanged() {
    sendToMainWindow('sites:changed', sitesService.list())
  }

  function broadcastSitePresetPrefsChanged() {
    sendToMainWindow('sites:preset-prefs-changed', sitesService.listPresetPrefs())
  }

  function broadcastSiteOrderChanged() {
    sendToMainWindow('sites:order-changed', sitesService.listOrder())
  }

  function broadcastAppStateHome() {
    sendToWindows('app-state:changed', { content: 'home', fileKind: null, form: 'normal' })
  }

  const maintenanceService = createAppMaintenanceService({
    store,
    getMainWindow,
    session,
    cancelPendingKeys,
    webviewManager,
    historyService,
    sitesService,
    txtService,
    epubService,
    pdfService,
    applyCurrentWebPrefs: () => webviewManager.applyCurrentWebPrefs(),
    applyCurrentTransparency,
    replaceTransparencyPrefs,
    syncPlainViewForMergedTransparency: syncMergedPlainView,
    applyBossKeys: bossKeyService.applyKeys,
    applySystemVisibilityPrefs,
    restoreMousePassthrough: windowMousePassthrough.restoreMousePassthrough,
    restoreStealthBodyVisibility: stealthBodyVisibility.restoreStealthBodyVisibility,
    disableWindowLeaveWatcher: windowLeaveWatcher.disableWindowLeaveWatcher,
    resetMainWindowBounds: resetMainWindowBoundsForMaintenance,
    buildDefaultManagedPrefs: () => buildDefaultManagedPrefs(platformPolicy),
    sendToWindows,
    diagnosticLogger
  })

  ipcMain.handle('app-cache:clear', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const result = await maintenanceService.clearCache()
      await webviewManager.applyCurrentWebPrefs({ skipReload: true })
      broadcastAppStateHome()
      sendToWindows('site-web-prefs:changed', webviewManager.getCurrentSiteWebPrefs())
      return result
    })
  })

  ipcMain.handle('app:initialize', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const result = await maintenanceService.initializeApp()
      await webviewManager.applyCurrentWebPrefs({ skipReload: true })
      applyCurrentTransparency()
      const currentManagedPrefs = getRawManagedPrefs()
      applyThemePrefs(currentManagedPrefs.themePrefs)
      broadcastManagedPrefs(currentManagedPrefs)
      broadcastEffectiveTheme()
      broadcastAppStateHome()
      broadcastHistoryChanged()
      broadcastSitesChanged()
      broadcastSitePresetPrefsChanged()
      broadcastSiteOrderChanged()
      return result
    })
  })

  ipcMain.handle('maintenance:renderer-reset-complete', (e, requestId, result) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return maintenanceService.completeRendererReset(requestId, result)
  })

  function getRawManagedPrefs() {
    return {
      webPrefs: getStoredWebPrefs(),
      siteWebPrefs: store.get('siteWebPrefs'),
      txtPrefs: store.get('txtPrefs'),
      epubPrefs: store.get('epubPrefs'),
      pdfPrefs: store.get('pdfPrefs'),
      fileVisualPrefs: store.get('fileVisualPrefs'),
      transparencyPrefs: getTransparencyPrefs(),
      bossKeys: store.get('bossKeys'),
      startupPrefs: store.get('startupPrefs'),
      historyPrefs: store.get('historyPrefs'),
      themePrefs: getThemePrefs(),
      systemPrefs: getSystemPrefs()
    }
  }

  function writeManagedPrefs(prefs) {
    for (const [key, value] of Object.entries(prefs)) store.set(key, value)
  }

  function broadcastManagedPrefs(prefs) {
    sendToWindows('web-prefs:changed', prefs.webPrefs)
    sendToWindows('site-web-prefs:changed', webviewManager.getCurrentSiteWebPrefs())
    sendToWindows('txt-prefs:changed', prefs.txtPrefs)
    sendToWindows('epub-prefs:changed', prefs.epubPrefs)
    sendToWindows('pdf-prefs:changed', prefs.pdfPrefs)
    sendToWindows('file-visual-prefs:changed', prefs.fileVisualPrefs)
    sendToWindows('transparency-prefs:changed', prefs.transparencyPrefs)
    sendToWindows('boss-key:changed', prefs.bossKeys)
    sendToWindows('startup-prefs:changed', prefs.startupPrefs)
    sendToWindows('history-prefs:changed', prefs.historyPrefs)
    sendToWindows('theme-prefs:changed', prefs.themePrefs)
    sendToWindows('system-prefs:changed', prefs.systemPrefs)
  }

  applyThemePrefs(getThemePrefs())

  ipcMain.handle('startup-prefs:get', () => normalizeStartupPrefs(store.get('startupPrefs')))

  function getStartupRestoreIntent() {
    const raw = store.get('startupRestoreIntent')
    const intent = normalizeStartupRestoreIntent(raw)
    if (!intent && raw != null) store.set('startupRestoreIntent', null)
    return intent
  }

  function clearStartupRestoreIntent() {
    if (store.get('startupRestoreIntent') != null) store.set('startupRestoreIntent', null)
  }

  function persistedShellBlocksStartupRestore() {
    const persisted = store.get('appState')
    return persisted?.content === 'home' || persisted?.content === 'history'
  }

  registerLoggedHandle('startup-restore:get', async (e) => {
    if (!isMainSender(e.sender)) return null
    const startupPrefs = normalizeStartupPrefs(store.get('startupPrefs'))
    if (!startupPrefs.restoreShellState) return null
    if (persistedShellBlocksStartupRestore()) {
      clearStartupRestoreIntent()
      return null
    }
    return getStartupRestoreIntent()
  })

  ipcMain.handle('startup-restore:set', async (e, payload) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const intent = normalizeStartupRestoreIntent(payload)
    if (!intent) return { ok: false, reason: 'invalid-intent' }
    store.set('startupRestoreIntent', intent)
    return { ok: true, intent }
  })

  ipcMain.handle('startup-restore:clear', async (e) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    clearStartupRestoreIntent()
    return { ok: true }
  })

  ipcMain.handle('startup-prefs:set', (e, patch) => {
    if (!isPreferencesSender(e.sender)) return normalizeStartupPrefs(store.get('startupPrefs'))
    return enqueueManagedPreferenceTransaction(async () => {
      const current = normalizeStartupPrefs(store.get('startupPrefs'))
      const clean = sanitizeStartupPrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const merged = normalizeStartupPrefs({ ...current, ...clean })
      store.set('startupPrefs', merged)
      sendToWindows('startup-prefs:changed', merged)
      return merged
    })
  })

  ipcMain.handle('history-prefs:get', () => normalizeHistoryPrefs(store.get('historyPrefs')))
  ipcMain.handle('history-prefs:set', (e, patch) => {
    if (!isPreferencesSender(e.sender)) return normalizeHistoryPrefs(store.get('historyPrefs'))
    return enqueueManagedPreferenceTransaction(async () => {
      const current = normalizeHistoryPrefs(store.get('historyPrefs'))
      const clean = sanitizeHistoryPrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const merged = normalizeHistoryPrefs({ ...current, ...clean })
      store.set('historyPrefs', merged)
      sendToWindows('history-prefs:changed', merged)
      return merged
    })
  })

  ipcMain.handle('theme-prefs:get', () => getThemePrefs())
  ipcMain.handle('theme-prefs:set', (e, patch) => {
    if (!isPreferencesSender(e.sender)) return getThemePrefs()
    return enqueueManagedPreferenceTransaction(async () => {
      const current = getThemePrefs()
      const clean = sanitizeThemePrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const merged = normalizeThemePrefs({ ...current, ...clean })
      if (merged.mode === current.mode) return current
      store.set('themePrefs', merged)
      applyThemePrefs(merged)
      broadcastThemePrefs(merged)
      broadcastEffectiveTheme()
      return merged
    })
  })

  ipcMain.handle('system-prefs:get', (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return getSystemPrefs()
  })

  ipcMain.handle('system-prefs:set', async (e, patch) => {
    if (!isPreferencesSender(e.sender)) return getSystemPrefs()
    return enqueueManagedPreferenceTransaction(async () => {
      const current = getSystemPrefs()
      const clean = sanitizeSystemPrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const next = normalizeSystemPrefs({ ...current, ...clean })
      if (next.showInTaskbarOrDock === current.showInTaskbarOrDock) return current
      const mainWindow = getMainWindow()
      const usableMainWindow = mainWindow && !mainWindow.isDestroyed?.() ? mainWindow : null
      const applied = await applySystemVisibilityPrefs(next, { win: usableMainWindow })
      if (!applied.ok) return current
      store.set('systemPrefs', applied.prefs)
      sendToWindows('system-prefs:changed', applied.prefs)
      return applied.prefs
    })
  })

  function isCurrentNativeDialogSession(lease) {
    return preferencesWindow.isNativeDialogSessionCurrent?.(lease) === true
  }

  function beginNativeDialogLease(sender) {
    return preferencesWindow.beginNativeDialog?.(sender) || null
  }

  function finishNativeDialogLease(lease) {
    try {
      preferencesWindow.finishNativeDialog?.(lease)
    } catch (error) {
      void error
    }
  }

  function reportPreferenceImportRefreshFailure() {
    try {
      void Promise.resolve(
        diagnosticLogger.warn(
          'preferences.import_webview_refresh_failed',
          { ok: false, reason: 'refresh-failed' },
          'main'
        )
      ).catch(() => {})
    } catch (error) {
      void error
    }
  }

  function preparePreferenceImport(parsed) {
    const merged = mergeImportedPrefs(getRawManagedPrefs(), parsed.prefs, platformPolicy)
    const currentSystemPrefs = getSystemPrefs()
    const currentWebPrefs = getStoredWebPrefs()
    const stagedTransparencyPrefs = merged.next.transparencyPrefs
    const stagedPlainView = stagedTransparencyPrefs.merged
      ? stagedTransparencyPrefs.windowEnabled === true
      : merged.next.webPrefs.plainView
    const stagedWebPrefs = normalizeWebPrefs(
      { ...merged.next.webPrefs, plainView: stagedPlainView },
      platformPolicy
    )
    return {
      merged,
      next: { ...merged.next, webPrefs: stagedWebPrefs },
      currentSystemPrefs,
      hasExplicitSystemPrefs: Object.prototype.hasOwnProperty.call(parsed.prefs, 'systemPrefs'),
      reloadForPlainViewDisable: currentWebPrefs.plainView === true && stagedPlainView === false
    }
  }

  async function applyPreparedPreferenceImport(prepared, lease) {
    const { merged, next, currentSystemPrefs, hasExplicitSystemPrefs, reloadForPlainViewDisable } =
      prepared
    const { bossKeys, transparencyPrefs, systemPrefs } = next
    const plainPrefs = Object.fromEntries(
      Object.entries(next).filter(
        ([key]) => key !== 'bossKeys' && key !== 'transparencyPrefs' && key !== 'systemPrefs'
      )
    )
    const invalidFields = [...merged.invalidFields]
    let finalSystemPrefs = currentSystemPrefs

    if (
      hasExplicitSystemPrefs &&
      systemPrefs.showInTaskbarOrDock !== currentSystemPrefs.showInTaskbarOrDock
    ) {
      const mainWindow = getMainWindow()
      const usableMainWindow = mainWindow && !mainWindow.isDestroyed?.() ? mainWindow : null
      let appliedSystemPrefs
      try {
        appliedSystemPrefs = await applySystemVisibilityPrefs(systemPrefs, {
          win: usableMainWindow
        })
      } catch (error) {
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        appliedSystemPrefs = { ok: false, reason: error?.message || 'system-visibility-failed' }
      }
      if (!isCurrentNativeDialogSession(lease)) {
        if (appliedSystemPrefs?.ok) {
          try {
            await applySystemVisibilityPrefs(currentSystemPrefs, { win: usableMainWindow })
          } catch (error) {
            void error
          }
        }
        return { ok: false, reason: 'inactive' }
      }
      if (appliedSystemPrefs?.ok) finalSystemPrefs = appliedSystemPrefs.prefs || systemPrefs
      else invalidFields.push('systemPrefs.showInTaskbarOrDock')
    }

    if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }

    writeManagedPrefs(plainPrefs)
    const appliedTransparencyPrefs = replaceTransparencyPrefs(transparencyPrefs, {
      persist: 'sync'
    })
    const bossResult = bossKeyService.applyKeys(bossKeys)
    store.set('bossKeys', bossResult.keys)
    if (finalSystemPrefs.showInTaskbarOrDock !== currentSystemPrefs.showInTaskbarOrDock) {
      store.set('systemPrefs', finalSystemPrefs)
    }
    const finalPrefs = {
      ...plainPrefs,
      transparencyPrefs: appliedTransparencyPrefs,
      bossKeys: bossResult.keys,
      systemPrefs: finalSystemPrefs
    }
    applyCurrentTransparency()
    applyThemePrefs(finalPrefs.themePrefs)
    broadcastManagedPrefs(finalPrefs)
    broadcastEffectiveTheme()
    try {
      if (reloadForPlainViewDisable) {
        await webviewManager.applyCurrentWebPrefs({
          skipReload: true,
          reloadForPlainViewDisable: true
        })
      } else {
        await webviewManager.applyCurrentWebPrefs()
      }
    } catch {
      reportPreferenceImportRefreshFailure()
    }
    return {
      ok: true,
      ignoredFields: merged.ignoredFields,
      invalidFields,
      bossKeyFailures: bossResult.failures
    }
  }

  ipcMain.handle('preferences:export', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const lease = beginNativeDialogLease(e.sender)
    if (!lease) return { ok: false, reason: 'inactive' }
    try {
      let result
      try {
        result = await dialog.showSaveDialog(lease.createdWindow, {
          title: '导出配置',
          defaultPath: 'goof-off-preferences.json',
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
      } catch {
        return isCurrentNativeDialogSession(lease)
          ? { ok: false, reason: 'cancelled' }
          : { ok: false, reason: 'inactive' }
      }
      if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
      if (result?.canceled || !result?.filePath) return { ok: false, reason: 'cancelled' }
      const snapshot = await enqueueManagedPreferenceTransaction(() => {
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        return {
          ok: true,
          bundle: {
            version: 1,
            app: 'goof-off-app',
            exportedAt: new Date().toISOString(),
            prefs: buildPreferenceBundlePrefs(getRawManagedPrefs(), platformPolicy)
          }
        }
      })
      if (!snapshot.ok || !isCurrentNativeDialogSession(lease)) {
        return { ok: false, reason: 'inactive' }
      }
      try {
        await fsp.writeFile(result.filePath, JSON.stringify(snapshot.bundle, null, 2), 'utf8')
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        return { ok: true, path: result.filePath }
      } catch (err) {
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        return { ok: false, reason: 'write-error', message: err?.message || '导出失败' }
      }
    } finally {
      finishNativeDialogLease(lease)
    }
  })

  ipcMain.handle('preferences:import', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    const lease = beginNativeDialogLease(e.sender)
    if (!lease) return { ok: false, reason: 'inactive' }
    try {
      let result
      try {
        result = await dialog.showOpenDialog(lease.createdWindow, {
          title: '导入配置',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile']
        })
      } catch {
        return isCurrentNativeDialogSession(lease)
          ? { ok: false, reason: 'cancelled' }
          : { ok: false, reason: 'inactive' }
      }
      if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
      if (result?.canceled || !result?.filePaths?.length) return { ok: false, reason: 'cancelled' }
      let raw
      try {
        raw = await fsp.readFile(result.filePaths[0], 'utf8')
      } catch (err) {
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        return { ok: false, reason: 'read-error', message: err?.message || '导入失败' }
      }
      if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        return { ok: false, reason: 'parse-error', message: err?.message || '导入失败' }
      }
      if (parsed?.app !== 'goof-off-app' || parsed?.version !== 1 || !parsed?.prefs) {
        return { ok: false, reason: 'invalid-bundle', message: '配置文件格式不匹配' }
      }
      return await enqueueManagedPreferenceTransaction(async () => {
        if (!isCurrentNativeDialogSession(lease)) return { ok: false, reason: 'inactive' }
        const prepared = preparePreferenceImport(parsed)
        return await applyPreparedPreferenceImport(prepared, lease)
      })
    } finally {
      finishNativeDialogLease(lease)
    }
  })

  ipcMain.handle('preferences:reset-defaults', async (e) => {
    if (!isPreferencesSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return enqueueManagedPreferenceTransaction(async () => {
      const defaults = buildPreferenceBundlePrefs(
        buildDefaultManagedPrefs(platformPolicy),
        platformPolicy
      )
      const { bossKeys, transparencyPrefs, systemPrefs, ...plainDefaults } = defaults
      writeManagedPrefs(plainDefaults)
      const appliedTransparencyPrefs = replaceTransparencyPrefs(transparencyPrefs, {
        persist: 'sync'
      })
      const resetPlainViewSync = await syncMergedPlainView(appliedTransparencyPrefs, 'preferences')
      const bossResult = bossKeyService.applyKeys(bossKeys)
      store.set('bossKeys', bossResult.keys)
      const mainWindow = getMainWindow()
      const usableMainWindow = mainWindow && !mainWindow.isDestroyed?.() ? mainWindow : null
      const appliedSystemPrefs = await applySystemVisibilityPrefs(systemPrefs, {
        win: usableMainWindow
      })
      const finalSystemPrefs = appliedSystemPrefs.ok ? appliedSystemPrefs.prefs : getSystemPrefs()
      if (appliedSystemPrefs.ok) store.set('systemPrefs', finalSystemPrefs)
      const finalPrefs = {
        ...plainDefaults,
        webPrefs: resetPlainViewSync?.webPrefs ?? getStoredWebPrefs(),
        transparencyPrefs: appliedTransparencyPrefs,
        bossKeys: bossResult.keys,
        systemPrefs: finalSystemPrefs
      }
      await webviewManager.applyCurrentWebPrefs()
      applyCurrentTransparency()
      applyThemePrefs(finalPrefs.themePrefs)
      broadcastManagedPrefs(finalPrefs)
      broadcastEffectiveTheme()
      if (!appliedSystemPrefs.ok) {
        return {
          ok: false,
          reason: appliedSystemPrefs.reason,
          bossKeyFailures: bossResult.failures
        }
      }
      return { ok: true, bossKeyFailures: bossResult.failures }
    })
  })

  ipcMain.handle('file-visual-prefs:set', (e, patch) => {
    if (!isPreferencesSender(e.sender)) {
      return normalizeFileVisualPrefs(store.get('fileVisualPrefs'))
    }
    return enqueueManagedPreferenceTransaction(async () => {
      const current = normalizeFileVisualPrefs(store.get('fileVisualPrefs'))
      const clean = sanitizeFileVisualPrefsPatch(patch)
      if (Object.keys(clean).length === 0) return current
      const merged = normalizeFileVisualPrefs({ ...current, ...clean })
      store.set('fileVisualPrefs', merged)

      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('file-visual-prefs:changed', merged)
      }
      const prefsWin = preferencesWindow.getWindow()
      if (prefsWin && !prefsWin.isDestroyed()) {
        prefsWin.webContents.send('file-visual-prefs:changed', merged)
      }

      return merged
    })
  })

  registerLoggedHandle('window:set-mouse-passthrough', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowMousePassthrough.setMousePassthrough(payload?.enabled === true, {
      allowUnsupported: false,
      source: 'main-window'
    })
  })

  registerLoggedHandle('window:stealth-leave-watcher-enable', async (e) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowLeaveWatcher.enableWindowLeaveWatcher()
  })

  registerLoggedHandle('window:stealth-leave-watcher-disable', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowLeaveWatcher.disableWindowLeaveWatcher(payload)
  })

  registerLoggedHandle('window:stealth-leave-create-candidate', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowLeaveWatcher.createWindowLeaveCandidate(payload)
  })

  registerLoggedHandle('window:stealth-leave-review-candidate', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowLeaveWatcher.reviewWindowLeaveCandidate(payload)
  })

  registerLoggedHandle('window:stealth-leave-review-focus-loss', async (e, payload = {}) => {
    if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
    return windowLeaveWatcher.reviewWindowLeaveFocusLoss(payload)
  })

  if (isStealthSpikeHarnessEnabled()) {
    registerLoggedHandle('window:probe-mouse-passthrough', async (e, payload = {}) => {
      if (!isMainSender(e.sender)) return { ok: false, reason: 'forbidden' }
      return windowMousePassthrough.setMousePassthrough(payload?.enabled === true, {
        allowUnsupported: true,
        source: 'spike-harness'
      })
    })
  }

  ipcMain.handle('window:set-shadow-policy', (_e, shouldHide) => {
    applyShadowPolicy(shouldHide)
  })

  ipcMain.handle('window:set-form', (e, form) => {
    if (!isMainSender(e.sender)) return false
    if (form !== 'normal' && form !== 'mini') return false
    return setWindowForm(form)
  })

  ipcMain.handle('prefs:open', () => {
    preferencesWindow.open()
  })
  ipcMain.handle('prefs:close', (e) => {
    if (!isPreferencesSender(e.sender)) return false
    return preferencesWindow.close()
  })

  // TXT
  async function openTxtWithHistory(filePath) {
    const result = await txtService.openFile(filePath)
    if (result.ok) historyService.commitTxtFile({ path: result.path, kind: 'txt' })
    return result
  }

  function kindFromReadableFilePath(filePath) {
    const ext = extname(String(filePath || '')).toLowerCase()
    if (ext === '.txt') return 'txt'
    if (ext === '.epub') return 'epub'
    if (ext === '.pdf') return 'pdf'
    return null
  }

  function withKind(kind, result) {
    if (!result || typeof result !== 'object') return result
    return { ...result, kind }
  }

  function normalizeHistoryOpenFileFailure(result) {
    if (!result || result.ok !== false) return result
    if (result.reason === 'not-found') {
      return { ...result, reason: 'not-found', message: result.message || '文件不存在' }
    }
    if (result.reason === 'permission') {
      return { ...result, reason: 'permission', message: result.message || '无权限访问文件' }
    }
    return result
  }

  async function openAnyReadableFile(filePath) {
    const kind = kindFromReadableFilePath(filePath)
    if (!kind) {
      return { ok: false, reason: 'unsupported', message: '不支持的文件格式' }
    }
    if (kind === 'txt') return withKind('txt', await openTxtWithHistory(filePath))
    if (kind === 'epub') return withKind('epub', await openEpubWithHistory(filePath))
    if (kind === 'pdf') return withKind('pdf', openPdfWithHistory(filePath))
    return { ok: false, reason: 'unsupported', message: '不支持的文件格式' }
  }

  async function openAnyReadableFileDialog() {
    const win = getMainWindow()
    const result = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Readable Files', extensions: ['txt', 'epub', 'pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, reason: 'cancelled' }
    return openAnyReadableFile(result.filePaths[0])
  }

  registerLoggedHandle('file:open-dialog-any', (e) => {
    if (!isMainSender(e.sender)) {
      return { ok: false, reason: 'forbidden', message: '文件不可用' }
    }
    return openAnyReadableFileDialog()
  })

  registerLoggedHandle('txt:open', (_e, path) => openTxtWithHistory(path))
  ipcMain.handle('txt:re-decode', (_e, fileId, encoding) => txtService.reDecode(fileId, encoding))
  ipcMain.handle('txt:get-progress', (_e, fileId) => txtService.getProgress(fileId))
  ipcMain.handle('txt:save-progress', (_e, fileId, patch) => {
    txtService.saveProgress(fileId, patch)
    return true
  })
  ipcMain.handle('txt:flush-progress', (_e, fileId, patch) => {
    if (fileId && patch) txtService.saveProgress(fileId, patch)
    txtService.flushPending()
    return true
  })
  ipcMain.handle('txt:get-prefs', () => txtService.getPrefs())
  ipcMain.handle('txt:set-prefs', (e, patch) => {
    const fromMain = isMainSender(e.sender)
    const fromPreferences = isPreferencesSender(e.sender)
    if (!fromMain && !fromPreferences) return txtService.getPrefs()
    return enqueueManagedPreferenceTransaction(async () => {
      const current = txtService.getPrefs()
      const allowedPatch = fromPreferences
        ? patch
        : Object.fromEntries(
            MAIN_ALLOWED_TXT_PREFS.filter((key) =>
              Object.prototype.hasOwnProperty.call(patch || {}, key)
            ).map((key) => [key, patch[key]])
          )
      if (!allowedPatch || Object.keys(allowedPatch).length === 0) return current
      const next = txtService.setPrefs(allowedPatch)
      flushStorePending()
      sendToWindows('txt-prefs:changed', next)
      return next
    })
  })
  ipcMain.handle('file:open-dialog', async () => {
    const result = await txtService.openDialog()
    if (result.ok) historyService.commitTxtFile({ path: result.path, kind: 'txt' })
    return result
  })

  // EPUB
  async function openEpubWithHistory(filePath) {
    const result = await epubService.open(filePath)
    if (!result.ok) return result
    const pending = historyService.beginPendingFile({ path: result.path, kind: 'epub' })
    if (!pending.ok) return { ok: false, reason: pending.reason, message: '文件不可用' }
    return { ...result, historyToken: pending.token }
  }

  registerLoggedHandle('epub:open', (_e, filePath) => openEpubWithHistory(filePath))
  ipcMain.handle('epub:open-dialog', async () => {
    const result = await epubService.openDialog()
    if (!result.ok) return result
    const pending = historyService.beginPendingFile({ path: result.path, kind: 'epub' })
    if (!pending.ok) return { ok: false, reason: pending.reason, message: '文件不可用' }
    return { ...result, historyToken: pending.token }
  })
  ipcMain.handle('epub:get-progress', (_e, fileId) => epubService.getProgress(fileId))
  ipcMain.handle('epub:save-progress', (_e, fileId, patch) => {
    epubService.saveProgress(fileId, patch)
    return true
  })
  ipcMain.handle('epub:flush-progress', (_e, fileId, patch) => {
    if (fileId && patch) epubService.saveProgress(fileId, patch)
    epubService.flushPending()
    flushStorePending()
    return true
  })
  ipcMain.handle('epub:get-prefs', () => epubService.getPrefs())
  ipcMain.handle('epub:set-prefs', (e, patch) => {
    const fromMain = isMainSender(e.sender)
    const fromPreferences = isPreferencesSender(e.sender)
    if (!fromMain && !fromPreferences) return epubService.getPrefs()
    return enqueueManagedPreferenceTransaction(async () => {
      const current = epubService.getPrefs()
      const allowedPatch = fromPreferences
        ? patch
        : Object.fromEntries(
            MAIN_ALLOWED_EPUB_PREFS.filter((key) =>
              Object.prototype.hasOwnProperty.call(patch || {}, key)
            ).map((key) => [key, patch[key]])
          )
      if (!allowedPatch || Object.keys(allowedPatch).length === 0) return current
      const next = epubService.setPrefs(allowedPatch)
      sendToWindows('epub-prefs:changed', next)
      return next
    })
  })

  // PDF
  function openPdfWithHistory(filePath) {
    const result = pdfService.open(filePath)
    if (!result.ok) return result
    const pending = historyService.beginPendingFile({ path: result.path, kind: 'pdf' })
    if (!pending.ok) {
      pdfService.releaseSession(result.data.fileId)
      return { ok: false, reason: pending.reason, message: '文件不可用' }
    }
    return { ...result, historyToken: pending.token }
  }

  async function openStartupRestoreFile(payload) {
    const intent = normalizeStartupRestoreIntent({
      type: 'file',
      fileKind: payload?.fileKind,
      path: payload?.path
    })
    if (!intent) return { ok: false, reason: 'invalid-file', message: '文件不可用' }
    if (intent.fileKind === 'txt') return openTxtWithHistory(intent.path)
    if (intent.fileKind === 'epub') return openEpubWithHistory(intent.path)
    if (intent.fileKind === 'pdf') return openPdfWithHistory(intent.path)
    return { ok: false, reason: 'invalid-kind', message: '文件不可用' }
  }

  registerLoggedHandle('startup-restore:open-file', (e, payload) => {
    if (!isMainSender(e.sender)) {
      return { ok: false, reason: 'forbidden', message: '文件不可用' }
    }
    return openStartupRestoreFile(payload)
  })

  registerLoggedHandle('history:open-file', async (_e, payload) => {
    const kind = payload?.kind
    const filePath = payload?.path
    if (!kind || !filePath) return { ok: false, reason: 'invalid-input', message: '文件不可用' }
    const validation = historyService.validateHistoryFile({ path: filePath, kind })
    if (!validation.ok) return validation
    if (kind === 'txt') {
      return normalizeHistoryOpenFileFailure(await openTxtWithHistory(validation.path))
    }
    if (kind === 'epub') {
      return normalizeHistoryOpenFileFailure(await openEpubWithHistory(validation.path))
    }
    if (kind === 'pdf') return normalizeHistoryOpenFileFailure(openPdfWithHistory(validation.path))
    return { ok: false, reason: 'invalid-kind', message: '文件不可用' }
  })

  registerLoggedHandle('pdf:open', (_e, filePath) => openPdfWithHistory(filePath))
  ipcMain.handle('pdf:open-dialog', async () => {
    const result = await pdfService.openDialog()
    if (!result.ok) return result
    const pending = historyService.beginPendingFile({ path: result.path, kind: 'pdf' })
    if (!pending.ok) {
      pdfService.releaseSession(result.data.fileId)
      return { ok: false, reason: pending.reason, message: '文件不可用' }
    }
    return { ...result, historyToken: pending.token }
  })
  ipcMain.handle('pdf:close', (_e, fileId) => {
    pdfService.releaseSession(fileId)
  })
  ipcMain.handle('pdf:get-progress', (_e, fileId) => pdfService.getProgress(fileId))
  ipcMain.handle('pdf:save-progress', (_e, fileId, patch) => {
    pdfService.saveProgress(fileId, patch)
    return true
  })
  ipcMain.handle('pdf:flush-progress', (_e, fileId, patch) => {
    if (fileId && patch) pdfService.saveProgress(fileId, patch)
    pdfService.flushPending()
    flushStorePending()
    return true
  })
  ipcMain.handle('pdf:get-prefs', () => pdfService.getPrefs())
  ipcMain.handle('pdf:set-prefs', (e, patch) => {
    if (!isPreferencesSender(e.sender)) return pdfService.getPrefs()
    return enqueueManagedPreferenceTransaction(async () => {
      const next = pdfService.setPrefs(patch)
      flushStorePending()
      sendToWindows('pdf-prefs:changed', next)
      return next
    })
  })

  nativeTheme.on('updated', () => {
    broadcastEffectiveTheme()
  })
}
