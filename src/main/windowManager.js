import { BrowserWindow, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import store, { flushPending } from './store.js'
import { attachMainWindow } from './popoverWindowManager.js'
import { diagnosticLogger } from './diagnosticLogger.js'
import { getEffectiveOpacity, getTransparencyPrefs } from './transparencyService.js'
import { shouldSkipTaskbar } from './systemVisibilityPrefs.js'
import { restoreMousePassthrough } from './windowMousePassthrough.js'
import { resolveFramePolicy } from '../shared/framePolicy.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

const MINI_SIZE = { width: 280, height: 500 }
const NORMAL_MIN_SIZE = { width: 360, height: 480 }
const NORMAL_DEFAULT_SIZE = { width: 420, height: 820 }
const platformPolicy = getRuntimePlatformPolicy()

let mainWindow = null
let currentForm = 'normal'
let normalBounds = null
let closeBoundsOverride = null
let suppressCloseBoundsOverrideInvalidation = 0

function getUsableMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  return mainWindow
}

function clampBoundsToWorkArea(bounds) {
  const display = screen.getDisplayMatching(bounds)
  const area = display?.workArea
  if (!area) return bounds

  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const maxX = area.x + area.width - width
  const maxY = area.y + area.height - height

  return {
    x: Math.min(Math.max(bounds.x, area.x), maxX),
    y: Math.min(Math.max(bounds.y, area.y), maxY),
    width,
    height
  }
}

function clampNormalSize(bounds) {
  if (!bounds) return undefined
  return {
    ...bounds,
    width: Math.max(NORMAL_MIN_SIZE.width, Number(bounds.width) || NORMAL_MIN_SIZE.width),
    height: Math.max(NORMAL_MIN_SIZE.height, Number(bounds.height) || NORMAL_MIN_SIZE.height)
  }
}

function hasFiniteCoordinates(bounds) {
  return Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y)
}

function clampNormalBounds(bounds) {
  if (!bounds) {
    return { ...NORMAL_DEFAULT_SIZE, x: undefined, y: undefined }
  }
  const sized = clampNormalSize(bounds)
  if (!hasFiniteCoordinates(sized)) {
    return {
      ...sized,
      x: undefined,
      y: undefined
    }
  }
  return clampBoundsToWorkArea(sized)
}

function runWithoutCloseBoundsOverrideInvalidation(fn) {
  suppressCloseBoundsOverrideInvalidation += 1
  try {
    return fn()
  } finally {
    suppressCloseBoundsOverrideInvalidation -= 1
  }
}

function invalidateCloseBoundsOverride(eventName) {
  if (!closeBoundsOverride || suppressCloseBoundsOverrideInvalidation > 0) return

  if (eventName === 'resize' || eventName === 'resized') {
    const bounds = getUsableMainWindow()?.getBounds()
    if (
      bounds &&
      bounds.width === closeBoundsOverride.width &&
      bounds.height === closeBoundsOverride.height
    ) {
      return
    }
  }

  closeBoundsOverride = null
}

function getMainWindowPlatformOptions({ shellBackgroundHidden }) {
  const options = {}
  if (!shellBackgroundHidden && platformPolicy.window.supportsVibrancy) {
    options.vibrancy = 'under-window'
    options.visualEffectState = 'active'
  }
  return options
}

export function createWindow() {
  const storedBounds = store.get('windowBounds')
  const bounds = clampNormalBounds(storedBounds)
  const alwaysOnTop = store.get('alwaysOnTop')
  const effectiveOpacity = getEffectiveOpacity({ isPdf: false })
  const initialTransparencyPrefs = getTransparencyPrefs()
  const initialTransparencyArg = encodeURIComponent(JSON.stringify(initialTransparencyPrefs))
  const shellBackgroundHidden = effectiveOpacity.shellBackgroundHidden === true
  const interfaceOpacity = effectiveOpacity.interfaceOpacity ?? effectiveOpacity.contentOpacity ?? 1
  const framePolicy = resolveFramePolicy({
    shellBackgroundHidden,
    interfaceOpacity
  })
  const platformWindowOptions = getMainWindowPlatformOptions({ shellBackgroundHidden })

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    ...(platformPolicy.platform === 'win32' ? { maximizable: false } : {}),
    ...platformWindowOptions,
    skipTaskbar: platformPolicy.platform === 'win32' && shouldSkipTaskbar(),
    minWidth: NORMAL_MIN_SIZE.width,
    minHeight: NORMAL_MIN_SIZE.height,
    alwaysOnTop,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: [`--goof-off-initial-transparency=${initialTransparencyArg}`]
    }
  })

  currentForm = 'normal'
  normalBounds = null
  closeBoundsOverride = null
  attachMainWindow(mainWindow)
  diagnosticLogger.info(
    'window.create',
    { bounds, alwaysOnTop, effectiveOpacity, framePolicy },
    'main'
  )

  mainWindow.setHasShadow(!framePolicy.shouldHideShadow)
  mainWindow.setOpacity(1)

  mainWindow.on('ready-to-show', () => {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors)
    diagnosticLogger.info('window.ready_to_show', {}, 'main')
  })

  mainWindow.on('close', () => {
    restoreMousePassthrough('window-close')
    const currentBounds = closeBoundsOverride || getPersistBounds()
    if (currentBounds) store.set('windowBounds', currentBounds)
    closeBoundsOverride = null
    diagnosticLogger.info('window.close', { bounds: currentBounds }, 'main')
    flushPending()
  })

  if (platformPolicy.platform === 'win32') {
    mainWindow.on('maximize', () => {
      const win = getUsableMainWindow()
      if (!win) return
      win.unmaximize()
      diagnosticLogger.info('window.maximize_blocked', {}, 'main')
    })
  }

  for (const eventName of ['move', 'moved', 'resize', 'resized']) {
    mainWindow.on(eventName, () => invalidateCloseBoundsOverride(eventName))
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export function setWindowForm(form) {
  if (form !== 'normal' && form !== 'mini') return false
  const win = getUsableMainWindow()
  if (!win) return false
  if (form === currentForm) return true

  closeBoundsOverride = null

  if (form === 'mini') {
    normalBounds = win.getBounds()
    win.setMinimumSize(MINI_SIZE.width, MINI_SIZE.height)
    win.setBounds({
      x: normalBounds.x,
      y: normalBounds.y,
      width: MINI_SIZE.width,
      height: MINI_SIZE.height
    })
    win.setResizable(false)
    currentForm = 'mini'
    diagnosticLogger.info('window.form_changed', { form: 'mini' }, 'main')
    return true
  }

  win.setResizable(true)
  win.setMinimumSize(NORMAL_MIN_SIZE.width, NORMAL_MIN_SIZE.height)
  if (normalBounds) {
    const currentBounds = win.getBounds()
    const restoredNormalBounds = clampNormalSize(normalBounds)
    win.setBounds(
      clampBoundsToWorkArea({
        x: currentBounds.x,
        y: currentBounds.y,
        width: restoredNormalBounds.width,
        height: restoredNormalBounds.height
      })
    )
  }
  currentForm = 'normal'
  diagnosticLogger.info('window.form_changed', { form: 'normal' }, 'main')
  return true
}

export function getPersistBounds() {
  const win = getUsableMainWindow()
  if (!win) return null

  const bounds = win.getBounds()
  if (currentForm === 'mini' && normalBounds) {
    const restoredNormalBounds = clampNormalSize(normalBounds)
    return clampBoundsToWorkArea({
      x: bounds.x,
      y: bounds.y,
      width: restoredNormalBounds.width,
      height: restoredNormalBounds.height
    })
  }
  return bounds
}

export function resetMainWindowBoundsForMaintenance(bounds = NORMAL_DEFAULT_SIZE) {
  const win = getUsableMainWindow()
  if (!win) return false

  const resetBounds = clampNormalBounds(bounds)
  const persistBounds = {
    width: resetBounds.width,
    height: resetBounds.height
  }

  normalBounds = null
  currentForm = 'normal'
  closeBoundsOverride = { ...persistBounds }
  win.setResizable(true)
  win.setMinimumSize(NORMAL_MIN_SIZE.width, NORMAL_MIN_SIZE.height)
  runWithoutCloseBoundsOverrideInvalidation(() => {
    win.setBounds({ ...persistBounds })
  })
  return true
}

export function getMainWindow() {
  return mainWindow
}
