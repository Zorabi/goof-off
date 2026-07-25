import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

const INITIAL_TRANSPARENCY_ARG = '--goof-off-initial-transparency='

function readInitialTransparencyPrefs() {
  const arg = process.argv.find((item) => item.startsWith(INITIAL_TRANSPARENCY_ARG))
  if (!arg) return null
  try {
    return JSON.parse(decodeURIComponent(arg.slice(INITIAL_TRANSPARENCY_ARG.length)))
  } catch {
    return null
  }
}

function isStealthSpikePreloadEnabled() {
  return process.env.GOOF_OFF_STEALTH_SPIKE === '1'
}

const initialTransparencyPrefs = readInitialTransparencyPrefs()
const platformPolicy = getRuntimePlatformPolicy()

const api = {
  platformPolicy,
  initialTransparencyPrefs,
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  getConfig: (key) => ipcRenderer.invoke('get-config', key),
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  diagnosticLog: (event, data = {}, level = 'info') =>
    ipcRenderer.invoke('diagnostic:log', {
      event,
      data,
      level,
      process: 'renderer'
    }),
  diagnosticGetLogPath: () => ipcRenderer.invoke('diagnostic:get-log-path'),
  onThemeChange: (callback) => {
    ipcRenderer.on('theme-changed', (_event, isDark) => callback(isDark))
  },
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  quitApp: () => ipcRenderer.send('quit-app'),

  // browser
  browserOpen: (url, options = {}) => ipcRenderer.invoke('browser:open', url, options),
  browserSetVisible: (visible) => ipcRenderer.invoke('browser:set-visible', visible),
  browserHome: () => ipcRenderer.invoke('browser:home'),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserPopoverZone: (height) => ipcRenderer.invoke('browser:popover-zone', height),
  browserChromeReserve: (payload) => ipcRenderer.invoke('browser:chrome-reserve', payload),
  browserSetStealthContentOpacityMultiplier: (multiplier) =>
    ipcRenderer.invoke('browser:stealth-opacity-multiplier', { multiplier }),
  browserPauseActiveMediaForStealth: () =>
    ipcRenderer.invoke('browser:pause-active-media-for-stealth'),
  browserSetStealthBodyActivityBridgeEnabled: (payload = {}) =>
    ipcRenderer.invoke('browser:stealth-body-activity-bridge', {
      enabled: payload?.enabled === true
    }),
  browserSetSessionZoom: (zoom) => ipcRenderer.invoke('browser:set-session-zoom', zoom),
  popoverOpen: (payload) => ipcRenderer.invoke('popover:open', payload),
  popoverClose: (payload) => ipcRenderer.invoke('popover:close', payload),
  popoverUpdateSnapshot: (payload) => ipcRenderer.invoke('popover:update-snapshot', payload),
  popoverIsChildFocused: () => ipcRenderer.invoke('popover:is-child-focused'),
  onPopoverChildAction: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('popover:child-action', handler)
    return () => ipcRenderer.removeListener('popover:child-action', handler)
  },
  onPopoverChildClose: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('popover:child-close', handler)
    return () => ipcRenderer.removeListener('popover:child-close', handler)
  },
  onPopoverRecomputeRequest: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('popover:recompute-request', handler)
    return () => ipcRenderer.removeListener('popover:recompute-request', handler)
  },
  onBrowserNavState: (callback) => {
    ipcRenderer.on('browser:nav-state', (_e, state) => callback(state))
  },
  onBrowserSessionZoomChanged: (callback) => {
    const handler = (_e, zoom) => callback(zoom)
    ipcRenderer.on('browser:session-zoom-changed', handler)
    return () => ipcRenderer.removeListener('browser:session-zoom-changed', handler)
  },
  onBrowserWebHotZoneState: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('browser:web-hot-zone-state', handler)
    return () => ipcRenderer.removeListener('browser:web-hot-zone-state', handler)
  },
  onBrowserContentPointerDown: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('browser:content-pointer-down', handler)
    return () => ipcRenderer.removeListener('browser:content-pointer-down', handler)
  },
  onPageMessage: (callback) => {
    ipcRenderer.on('page:message', (_e, payload) => callback(payload))
  },
  onDialogRequest: (callback) => {
    ipcRenderer.on('page:dialog-request', (_e, payload) => callback(payload))
  },
  dialogRespond: (payload) => {
    ipcRenderer.send('page:dialog-respond', payload)
  },

  // sites
  sitesList: () => ipcRenderer.invoke('sites:list'),
  sitesAdd: (draft) => ipcRenderer.invoke('sites:add', draft),
  sitesUpdate: (id, patch) => ipcRenderer.invoke('sites:update', id, patch),
  sitesRemove: (id) => ipcRenderer.invoke('sites:remove', id),
  sitesPresetPrefsGet: () => ipcRenderer.invoke('sites:preset-prefs:get'),
  sitesPresetUpdate: (id, patch) => ipcRenderer.invoke('sites:preset:update', id, patch),
  sitesPresetRemove: (id) => ipcRenderer.invoke('sites:preset:remove', id),
  sitesOrderGet: () => ipcRenderer.invoke('sites:order:get'),
  sitesOrderSet: (ids) => ipcRenderer.invoke('sites:order:set', ids),

  // history
  historyList: () => ipcRenderer.invoke('history:list'),
  historyOpenFile: (payload) => ipcRenderer.invoke('history:open-file', payload),
  historyCommitFile: (token) => ipcRenderer.invoke('history:commit-file', token),
  historyDiscardFile: (token) => ipcRenderer.invoke('history:discard-file', token),
  historyRemoveWeb: (id) => ipcRenderer.invoke('history:remove-web', id),
  historyRemoveFile: (id) => ipcRenderer.invoke('history:remove-file', id),
  historyClearWeb: () => ipcRenderer.invoke('history:clear-web'),
  historyClearFiles: () => ipcRenderer.invoke('history:clear-files'),
  onHistoryChanged: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('history:changed', handler)
    return () => ipcRenderer.removeListener('history:changed', handler)
  },
  onSitesChanged: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('sites:changed', handler)
    return () => ipcRenderer.removeListener('sites:changed', handler)
  },
  onSitePresetPrefsChanged: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('sites:preset-prefs-changed', handler)
    return () => ipcRenderer.removeListener('sites:preset-prefs-changed', handler)
  },
  onSiteOrderChanged: (callback) => {
    const handler = (_event, order) => callback(order)
    ipcRenderer.on('sites:order-changed', handler)
    return () => ipcRenderer.removeListener('sites:order-changed', handler)
  },
  addressSuggestions: (payload) => ipcRenderer.invoke('address:suggestions', payload),

  // app state
  appStateGet: (options) => ipcRenderer.invoke('app-state:get', options),
  appStatePersist: (partial) => ipcRenderer.invoke('app-state:persist', partial),
  onMaintenanceResetRequested: (callback) => {
    const handler = (_e, payload) => callback(payload)
    ipcRenderer.on('maintenance:reset-requested', handler)
    return () => ipcRenderer.removeListener('maintenance:reset-requested', handler)
  },
  maintenanceResetComplete: (requestId, result) =>
    ipcRenderer.invoke('maintenance:renderer-reset-complete', requestId, result),

  // startup restore
  startupRestoreGet: () => ipcRenderer.invoke('startup-restore:get'),
  startupRestoreSet: (intent) => ipcRenderer.invoke('startup-restore:set', intent),
  startupRestoreClear: () => ipcRenderer.invoke('startup-restore:clear'),
  startupRestoreOpenFile: (payload) => ipcRenderer.invoke('startup-restore:open-file', payload),

  // window effects
  setShadowPolicy: (shouldHide) => ipcRenderer.invoke('window:set-shadow-policy', shouldHide),
  windowSetMousePassthrough: (payload) =>
    ipcRenderer.invoke('window:set-mouse-passthrough', payload),
  windowEnableStealthLeaveWatcher: () => ipcRenderer.invoke('window:stealth-leave-watcher-enable'),
  windowDisableStealthLeaveWatcher: (payload = {}) => {
    const disablePayload = { watcherEpoch: Number(payload?.watcherEpoch) }
    if (payload?.preserveReviewEpoch === true) disablePayload.preserveReviewEpoch = true
    return ipcRenderer.invoke('window:stealth-leave-watcher-disable', disablePayload)
  },
  windowCreateStealthLeaveCandidate: (payload = {}) =>
    ipcRenderer.invoke('window:stealth-leave-create-candidate', {
      watcherEpoch: Number(payload?.watcherEpoch)
    }),
  windowReviewStealthLeaveCandidate: (payload = {}) =>
    ipcRenderer.invoke('window:stealth-leave-review-candidate', {
      watcherEpoch: Number(payload?.watcherEpoch),
      outsideEpoch: Number(payload?.outsideEpoch)
    }),
  windowReviewStealthFocusLoss: (payload = {}) =>
    ipcRenderer.invoke('window:stealth-leave-review-focus-loss', {
      watcherEpoch: Number(payload?.watcherEpoch)
    }),
  windowProbeMousePassthrough: isStealthSpikePreloadEnabled()
    ? (payload) => ipcRenderer.invoke('window:probe-mouse-passthrough', payload)
    : () => Promise.resolve({ ok: false, reason: 'disabled' }),
  onStealthWindowLeft: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('stealth:auto-hide-window-left', handler)
    return () => ipcRenderer.removeListener('stealth:auto-hide-window-left', handler)
  },
  onStealthBodyVisibilityRestore: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('stealth:auto-hide-restore-body-visibility', handler)
    return () => ipcRenderer.removeListener('stealth:auto-hide-restore-body-visibility', handler)
  },
  onStealthBodyActivity: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('stealth:auto-hide-body-activity', handler)
    return () => ipcRenderer.removeListener('stealth:auto-hide-body-activity', handler)
  },
  windowSetForm: (form) => ipcRenderer.invoke('window:set-form', form),
  transparencyPrefsGet: () => ipcRenderer.invoke('transparency-prefs:get'),
  transparencyPrefsSet: (payload) => ipcRenderer.invoke('transparency-prefs:set', payload),
  onTransparencyPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('transparency-prefs:changed', handler)
    return () => ipcRenderer.removeListener('transparency-prefs:changed', handler)
  },

  // boss key events
  onBossHidden: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('boss:hidden', handler)
    return () => ipcRenderer.removeListener('boss:hidden', handler)
  },
  onBossRestored: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('boss:restored', handler)
    return () => ipcRenderer.removeListener('boss:restored', handler)
  },

  // boss key config
  bossKeyGet: () => ipcRenderer.invoke('boss-key:get'),
  bossKeySet: (which, accel) => ipcRenderer.invoke('boss-key:set', which, accel),

  // web prefs
  getWebPrefs: () => ipcRenderer.invoke('web-prefs:get'),
  setWebPrefs: (patch) => ipcRenderer.invoke('web-prefs:set', patch),
  onWebPrefsChange: (callback) => {
    ipcRenderer.on('web-prefs:changed', (_e, prefs) => callback(prefs))
  },
  getCurrentSiteWebPrefs: () => ipcRenderer.invoke('site-web-prefs:get-current'),
  onCurrentSiteWebPrefsChange: (callback) => {
    const handler = (_e, snapshot) => callback(snapshot)
    ipcRenderer.on('site-web-prefs:changed', handler)
    return () => ipcRenderer.removeListener('site-web-prefs:changed', handler)
  },
  onTxtPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('txt-prefs:changed', handler)
    return () => ipcRenderer.removeListener('txt-prefs:changed', handler)
  },
  onEpubPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('epub-prefs:changed', handler)
    return () => ipcRenderer.removeListener('epub-prefs:changed', handler)
  },
  onPdfPrefsChange: (callback) => {
    const handler = (_e, prefs, options) => callback(prefs, options)
    ipcRenderer.on('pdf-prefs:changed', handler)
    return () => ipcRenderer.removeListener('pdf-prefs:changed', handler)
  },

  // file visual prefs
  fileVisualPrefsGet: () => ipcRenderer.invoke('file-visual-prefs:get'),
  onFileVisualPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('file-visual-prefs:changed', handler)
    return () => ipcRenderer.removeListener('file-visual-prefs:changed', handler)
  },

  // preferences window
  openPreferences: () => ipcRenderer.invoke('prefs:open'),

  // txt
  openDroppedTxt: (file) => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('txt:open', path)
  },
  openTxtDialog: () => ipcRenderer.invoke('file:open-dialog'),
  openAnyFileDialog: () => ipcRenderer.invoke('file:open-dialog-any'),
  txtReDecode: (fileId, encoding) => ipcRenderer.invoke('txt:re-decode', fileId, encoding),
  txtGetProgress: (fileId) => ipcRenderer.invoke('txt:get-progress', fileId),
  txtSaveProgress: (fileId, patch) => ipcRenderer.invoke('txt:save-progress', fileId, patch),
  txtFlushProgress: (fileId, patch) => ipcRenderer.invoke('txt:flush-progress', fileId, patch),
  txtGetPrefs: () => ipcRenderer.invoke('txt:get-prefs'),
  txtSetPrefs: (patch) => ipcRenderer.invoke('txt:set-prefs', patch),
  onFileOpenRequest: (callback) => {
    ipcRenderer.on('file:open-request', () => callback())
  },

  // epub
  openDroppedEpub: (file) => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('epub:open', path)
  },
  openEpubDialog: () => ipcRenderer.invoke('epub:open-dialog'),
  epubGetProgress: (fileId) => ipcRenderer.invoke('epub:get-progress', fileId),
  epubSaveProgress: (fileId, patch) => ipcRenderer.invoke('epub:save-progress', fileId, patch),
  epubFlushProgress: (fileId, patch) => ipcRenderer.invoke('epub:flush-progress', fileId, patch),
  epubGetPrefs: () => ipcRenderer.invoke('epub:get-prefs'),
  epubSetPrefs: (patch) => ipcRenderer.invoke('epub:set-prefs', patch),
  onEpubOpenRequest: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('epub:open-request', handler)
    return () => ipcRenderer.removeListener('epub:open-request', handler)
  },

  // pdf
  openDroppedPdf: (file) => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('pdf:open', path)
  },
  openPdfDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  pdfClose: (fileId) => ipcRenderer.invoke('pdf:close', fileId),
  pdfGetProgress: (fileId) => ipcRenderer.invoke('pdf:get-progress', fileId),
  pdfSaveProgress: (fileId, patch) => ipcRenderer.invoke('pdf:save-progress', fileId, patch),
  pdfFlushProgress: (fileId, patch) => ipcRenderer.invoke('pdf:flush-progress', fileId, patch),
  pdfGetPrefs: () => ipcRenderer.invoke('pdf:get-prefs'),
  pdfSetPrefs: (patch) => ipcRenderer.invoke('pdf:set-prefs', patch),
  onPdfOpenRequest: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('pdf:open-request', handler)
    return () => ipcRenderer.removeListener('pdf:open-request', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
