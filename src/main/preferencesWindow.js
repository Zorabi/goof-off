import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getMainWindow } from './windowManager.js'
import { restoreMousePassthrough } from './windowMousePassthrough.js'
import { restoreStealthBodyVisibility } from './stealthBodyVisibility.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

let prefsWindow = null
const platformPolicy = getRuntimePlatformPolicy()
const PREFS_WINDOW_SIZE = { width: 420, height: 520 }

function getPreferencesPlatformOptions() {
  if (!platformPolicy.window.supportsVibrancy) return {}
  return {
    vibrancy: 'sidebar',
    visualEffectState: 'active'
  }
}

function clampBoundsToWorkArea(bounds, workArea) {
  if (!workArea) return bounds
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
    width,
    height
  }
}

function centerInRect(rect, size = PREFS_WINDOW_SIZE) {
  return {
    x: Math.round(rect.x + (rect.width - size.width) / 2),
    y: Math.round(rect.y + (rect.height - size.height) / 2),
    width: size.width,
    height: size.height
  }
}

function getDisplayWorkAreaForBounds(bounds) {
  return screen.getDisplayMatching(bounds)?.workArea
}

function getFallbackWorkArea() {
  const cursorPoint = screen.getCursorScreenPoint?.()
  const currentDisplay = cursorPoint ? screen.getDisplayNearestPoint?.(cursorPoint) : null
  return (
    currentDisplay?.workArea ||
    screen.getPrimaryDisplay?.()?.workArea || { x: 0, y: 0, width: 1440, height: 900 }
  )
}

function getInitialBounds(parent) {
  if (parent && !parent.isDestroyed?.() && typeof parent.getBounds === 'function') {
    const parentBounds = parent.getBounds()
    const centered = centerInRect(parentBounds)
    return clampBoundsToWorkArea(centered, getDisplayWorkAreaForBounds(parentBounds))
  }
  const fallbackArea = getFallbackWorkArea()
  return clampBoundsToWorkArea(centerInRect(fallbackArea), fallbackArea)
}

function reveal(win = prefsWindow) {
  if (!win || win.isDestroyed()) return
  if (!win.isVisible?.()) win.show()
  win.focus()
}

export function open() {
  void restoreMousePassthrough('preferences-open')
  restoreStealthBodyVisibility('preferences-open')

  if (prefsWindow && !prefsWindow.isDestroyed()) {
    reveal(prefsWindow)
    return prefsWindow
  }

  const parent = getMainWindow()
  const usableParent = parent && !parent.isDestroyed() ? parent : null
  const initialBounds = getInitialBounds(usableParent)
  prefsWindow = new BrowserWindow({
    ...(usableParent ? { parent: usableParent } : {}),
    ...initialBounds,
    frame: false,
    transparent: true,
    ...getPreferencesPlatformOptions(),
    resizable: false,
    show: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preferences.js'),
      sandbox: false
    }
  })

  prefsWindow.once('ready-to-show', () => reveal(prefsWindow))
  prefsWindow.on('closed', () => {
    prefsWindow = null
  })

  let load
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    load = prefsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/preferences/index.html`)
  } else {
    load = prefsWindow.loadFile(join(__dirname, '../renderer/preferences/index.html'))
  }
  load
    .then(() => reveal(prefsWindow))
    .catch((err) => {
      console.warn('[preferencesWindow] load failed:', err?.message || err)
    })

  return prefsWindow
}

export function toggle() {
  if (prefsWindow && !prefsWindow.isDestroyed()) {
    prefsWindow.close()
    return
  }
  open()
}

export function close() {
  if (!prefsWindow || prefsWindow.isDestroyed()) return false
  prefsWindow.close()
  return true
}

export function getWindow() {
  return prefsWindow
}
