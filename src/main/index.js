import { app, protocol } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow, getMainWindow } from './windowManager.js'
import { registerIpcHandlers, createDefaultEpubService } from './ipcHandlers.js'
import * as webviewManager from './webviewManager.js'
import * as popoverWindowManager from './popoverWindowManager.js'
import * as preferencesWindow from './preferencesWindow.js'
import * as bossKeyService from './bossKeyService.js'
import * as applicationMenu from './applicationMenu.js'
import { setupDialogBridge } from './dialogBridgeSetup.js'
import { createMainWindowBootstrap } from './mainWindowBootstrap.js'
import store, { ensurePlatformDefaults, flushPending } from './store.js'
import { createPdfService } from './pdfService.js'
import { diagnosticLogger } from './diagnosticLogger.js'
import { getTransparencyPrefs, initTransparencyPrefs } from './transparencyService.js'
import { syncPlainViewForMergedTransparency } from './transparencySceneSync.js'
import { applySystemVisibilityPrefs, getSystemPrefs } from './systemVisibilityPrefs.js'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'goof-off-pdf',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'goof-off-epub',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

const pdfService = createPdfService()
const epubService = createDefaultEpubService()

function logFatalAndExit(event, error) {
  process.exitCode = 1
  Promise.resolve(diagnosticLogger.error(event, { error }, 'main'))
    .catch(() => {})
    .finally(() => {
      process.exit(1)
    })
}

process.on('uncaughtException', (error) => {
  logFatalAndExit('main.uncaught_exception', error)
})

process.on('unhandledRejection', (reason) => {
  diagnosticLogger.error('main.unhandled_rejection', { error: reason }, 'main')
})

app.whenReady().then(async () => {
  diagnosticLogger.cleanup().catch(() => {})
  diagnosticLogger.info('app.ready', { platform: process.platform }, 'main')
  ensurePlatformDefaults()
  electronApp.setAppUserModelId('com.cl.goof-off-app')

  initTransparencyPrefs()
  try {
    await syncPlainViewForMergedTransparency({
      transparencyPrefs: getTransparencyPrefs(),
      source: 'startup',
      getWebPrefs: () => store.get('webPrefs'),
      setWebPrefs: (next) => store.set('webPrefs', next),
      applyCurrentWebPrefs: (options) => webviewManager.applyCurrentWebPrefs(options),
      diagnosticLogger
    })
  } catch (error) {
    await diagnosticLogger.error(
      'transparency.unified_plain_view_sync',
      { value: getTransparencyPrefs().windowEnabled === true, ok: false, source: 'startup', error },
      'main'
    )
  }
  applicationMenu.install()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  protocol.handle('goof-off-pdf', (request) => {
    const fileId = new URL(request.url).hostname
    const session = pdfService.resolveSession(fileId)
    if (!session) return new Response(null, { status: 404 })
    const range = request.headers.get('Range')
    return pdfService.serve(session, range)
  })

  protocol.handle('goof-off-epub', (request) => {
    const url = new URL(request.url)
    const fileId = url.hostname
    const rawSessionToken = url.searchParams.get('sessionToken')
    if (!/^[1-9]\d*$/.test(rawSessionToken || '')) {
      return new Response(null, { status: 404 })
    }
    const sessionToken = Number(rawSessionToken)
    if (!Number.isSafeInteger(sessionToken)) return new Response(null, { status: 404 })
    const session = epubService.resolveSession(fileId, sessionToken)
    if (!session) return new Response(null, { status: 404 })
    return epubService.serve(session)
  })

  const mainWindowBootstrap = createMainWindowBootstrap({
    createWindow,
    getMainWindow,
    setupDialogBridge,
    webviewManager,
    pdfService,
    epubService,
    applySystemVisibilityPrefs,
    getSystemPrefs
  })

  await applySystemVisibilityPrefs(getSystemPrefs(), { win: null })
  registerIpcHandlers({ pdfService, epubService })
  bossKeyService.init({ openMainWindow: mainWindowBootstrap.openMainWindow })
  mainWindowBootstrap.createAndBootstrapMainWindow({ showWhenReady: true })

  app.on('activate', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      void mainWindowBootstrap.openMainWindow()
    }
  })
})

app.on('before-quit', () => {
  diagnosticLogger.info('app.before_quit', {}, 'main')
  pdfService.flushPending()
  pdfService.clearSessions()
  epubService.flushPending()
  epubService.clearSessions()
  popoverWindowManager.destroyPopover()
  preferencesWindow.destroy()
  flushPending()
})

app.on('window-all-closed', () => {
  diagnosticLogger.info('app.window_all_closed', { platform: process.platform }, 'main')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
