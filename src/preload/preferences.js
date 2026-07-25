import { contextBridge, ipcRenderer } from 'electron'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

const platformPolicy = getRuntimePlatformPolicy()

const api = {
  platformPolicy,
  diagnosticLog: (event, data = {}, level = 'info') =>
    ipcRenderer.invoke('diagnostic:log', {
      event,
      data,
      level,
      process: 'renderer'
    }),
  diagnosticPrefsGet: () => ipcRenderer.invoke('diagnostic-prefs:get'),
  diagnosticPrefsSet: (patch) => ipcRenderer.invoke('diagnostic-prefs:set', patch),
  onDiagnosticPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('diagnostic-prefs:changed', handler)
    return () => ipcRenderer.removeListener('diagnostic-prefs:changed', handler)
  },
  appCacheClear: () => ipcRenderer.invoke('app-cache:clear'),
  appInitialize: () => ipcRenderer.invoke('app:initialize'),
  bossKeyGet: () => ipcRenderer.invoke('boss-key:get'),
  bossKeySet: (which, accel) => ipcRenderer.invoke('boss-key:set', which, accel),
  bossKeyReset: () => ipcRenderer.invoke('boss-key:reset'),
  transparencyPrefsGet: () => ipcRenderer.invoke('transparency-prefs:get'),
  transparencyPrefsSet: (payload) => ipcRenderer.invoke('transparency-prefs:set', payload),
  onTransparencyPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('transparency-prefs:changed', handler)
    return () => ipcRenderer.removeListener('transparency-prefs:changed', handler)
  },
  themePrefsGet: () => ipcRenderer.invoke('theme-prefs:get'),
  themePrefsSet: (patch) => ipcRenderer.invoke('theme-prefs:set', patch),
  onThemePrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('theme-prefs:changed', handler)
    return () => ipcRenderer.removeListener('theme-prefs:changed', handler)
  },
  systemPrefsGet: () => ipcRenderer.invoke('system-prefs:get'),
  systemPrefsSet: (patch) => ipcRenderer.invoke('system-prefs:set', patch),
  onSystemPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('system-prefs:changed', handler)
    return () => ipcRenderer.removeListener('system-prefs:changed', handler)
  },
  getWebPrefs: () => ipcRenderer.invoke('web-prefs:get'),
  setWebPrefs: (patch) => ipcRenderer.invoke('web-prefs:set', patch),
  onWebPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('web-prefs:changed', handler)
    return () => ipcRenderer.removeListener('web-prefs:changed', handler)
  },
  getCurrentSiteWebPrefs: () => ipcRenderer.invoke('site-web-prefs:get-current'),
  setCurrentSiteWebPrefs: (patch) => ipcRenderer.invoke('site-web-prefs:set-current', patch),
  clearCurrentSiteWebPrefs: () => ipcRenderer.invoke('site-web-prefs:clear-current'),
  onCurrentSiteWebPrefsChange: (callback) => {
    const handler = (_e, snapshot) => callback(snapshot)
    ipcRenderer.on('site-web-prefs:changed', handler)
    return () => ipcRenderer.removeListener('site-web-prefs:changed', handler)
  },
  txtGetPrefs: () => ipcRenderer.invoke('txt:get-prefs'),
  txtSetPrefs: (patch) => ipcRenderer.invoke('txt:set-prefs', patch),
  onTxtPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('txt-prefs:changed', handler)
    return () => ipcRenderer.removeListener('txt-prefs:changed', handler)
  },
  epubGetPrefs: () => ipcRenderer.invoke('epub:get-prefs'),
  epubSetPrefs: (patch) => ipcRenderer.invoke('epub:set-prefs', patch),
  onEpubPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('epub-prefs:changed', handler)
    return () => ipcRenderer.removeListener('epub-prefs:changed', handler)
  },
  pdfGetPrefs: () => ipcRenderer.invoke('pdf:get-prefs'),
  pdfSetPrefs: (patch) => ipcRenderer.invoke('pdf:set-prefs', patch),
  onPdfPrefsChange: (callback) => {
    const handler = (_e, prefs, options) => callback(prefs, options)
    ipcRenderer.on('pdf-prefs:changed', handler)
    return () => ipcRenderer.removeListener('pdf-prefs:changed', handler)
  },
  onBossKeyChange: (callback) => {
    const handler = (_e, keys) => callback(keys)
    ipcRenderer.on('boss-key:changed', handler)
    return () => ipcRenderer.removeListener('boss-key:changed', handler)
  },
  startupPrefsGet: () => ipcRenderer.invoke('startup-prefs:get'),
  startupPrefsSet: (patch) => ipcRenderer.invoke('startup-prefs:set', patch),
  onStartupPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('startup-prefs:changed', handler)
    return () => ipcRenderer.removeListener('startup-prefs:changed', handler)
  },
  historyPrefsGet: () => ipcRenderer.invoke('history-prefs:get'),
  historyPrefsSet: (patch) => ipcRenderer.invoke('history-prefs:set', patch),
  historyClearWeb: () => ipcRenderer.invoke('history:clear-web'),
  historyClearFiles: () => ipcRenderer.invoke('history:clear-files'),
  onHistoryPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('history-prefs:changed', handler)
    return () => ipcRenderer.removeListener('history-prefs:changed', handler)
  },
  preferencesExport: () => ipcRenderer.invoke('preferences:export'),
  preferencesImport: () => ipcRenderer.invoke('preferences:import'),
  preferencesResetDefaults: () => ipcRenderer.invoke('preferences:reset-defaults'),
  onPreferencesDeactivate: (callback) => {
    const handler = (_event, generation) => callback(generation)
    ipcRenderer.on('preferences:deactivate', handler)
    return () => ipcRenderer.removeListener('preferences:deactivate', handler)
  },
  preferencesDeactivated: (generation) => ipcRenderer.send('preferences:deactivated', generation),
  onPreferencesPrepareReveal: (callback) => {
    const handler = (_event, generation) => callback(generation)
    ipcRenderer.on('preferences:prepare-reveal', handler)
    return () => ipcRenderer.removeListener('preferences:prepare-reveal', handler)
  },
  preferencesRevealReady: (generation) => ipcRenderer.send('preferences:reveal-ready', generation),
  closePreferences: () => ipcRenderer.invoke('prefs:close'),
  fileVisualPrefsGet: () => ipcRenderer.invoke('file-visual-prefs:get'),
  fileVisualPrefsSet: (patch) => ipcRenderer.invoke('file-visual-prefs:set', patch),
  onFileVisualPrefsChange: (callback) => {
    const handler = (_e, prefs) => callback(prefs)
    ipcRenderer.on('file-visual-prefs:changed', handler)
    return () => ipcRenderer.removeListener('file-visual-prefs:changed', handler)
  },
  appStateGet: (options) => ipcRenderer.invoke('app-state:get', options),
  onAppStateChange: (callback) => {
    ipcRenderer.on('app-state:changed', (_e, state) => callback(state))
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  window.api = api
}
