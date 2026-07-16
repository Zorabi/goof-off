import { app, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import store from './store.js'
import { getMainWindow } from './windowManager.js'
import { hideWindow, showWindow } from './windowEffects.js'
import { diagnosticLogger } from './diagnosticLogger.js'
import { restoreMousePassthrough } from './windowMousePassthrough.js'
import { getDefaultBossKeys } from '../shared/platformPolicy.js'

let currentHideKey = null
let currentKillKey = null
let tray = null
let isHidden = false
let openMainWindow = async () => null

export function configureBossKeyService(deps = {}) {
  if (deps.openMainWindow) openMainWindow = deps.openMainWindow
}

function doHide() {
  restoreMousePassthrough('boss-hide')
  diagnosticLogger.info('boss.hide', {}, 'main')
  hideWindow()
  isHidden = true
  refreshTrayMenu()
  const win = getMainWindow()
  if (win) win.webContents.send('boss:hidden')
}

function doRestore() {
  if (!isHidden) return
  restoreMousePassthrough('boss-restore')
  diagnosticLogger.info('boss.restore', {}, 'main')
  isHidden = false
  showWindow()
  refreshTrayMenu()
  const win = getMainWindow()
  if (win) win.webContents.send('boss:restored')
}

function doKill() {
  restoreMousePassthrough('boss-kill')
  diagnosticLogger.warn('boss.kill', {}, 'main')
  app.quit()
}

function replaceShortcut({ currentKey, nextKey, callback, assign }) {
  if (currentKey) globalShortcut.unregister(currentKey)
  const ok = globalShortcut.register(nextKey, callback)
  if (ok) {
    assign(nextKey)
    diagnosticLogger.info('boss.shortcut_register', { accelerator: nextKey, ok }, 'main')
    return true
  }
  diagnosticLogger.info('boss.shortcut_register', { accelerator: nextKey, ok }, 'main')
  if (currentKey) {
    const restored = globalShortcut.register(currentKey, callback)
    if (restored) assign(currentKey)
  }
  return false
}

export function registerHideKey(accelerator) {
  return replaceShortcut({
    currentKey: currentHideKey,
    nextKey: accelerator,
    callback: async () => {
      const win = getMainWindow()
      if (!win) return
      if (isHidden) {
        doRestore()
        return
      }
      if (getTrayWindowState().isVisible) {
        doHide()
        return
      }
      await openMainWindow()
    },
    assign: (value) => {
      currentHideKey = value
    }
  })
}

export function registerKillKey(accelerator) {
  return replaceShortcut({
    currentKey: currentKillKey,
    nextKey: accelerator,
    callback: doKill,
    assign: (value) => {
      currentKillKey = value
    }
  })
}

function getTrayWindowState() {
  const win = getMainWindow()
  const isUsable = Boolean(win && !win.isDestroyed?.())
  const isVisible = Boolean(
    isUsable && win.isVisible?.() && !win.isMinimized?.() && app.isHidden?.() !== true
  )
  return {
    isVisible,
    isBossHidden: Boolean(isHidden && isUsable && !isVisible)
  }
}

function bindTrayMenuToWindowLifecycle(win) {
  if (!win?.on) return
  for (const eventName of ['show', 'hide', 'minimize', 'restore', 'closed']) {
    win.on(eventName, () => {
      const currentMainWindow = getMainWindow()
      if (currentMainWindow === win || (!currentMainWindow && eventName === 'closed')) {
        if (eventName === 'closed') isHidden = false
        if (
          isHidden &&
          (eventName === 'show' || eventName === 'restore') &&
          getTrayWindowState().isVisible
        ) {
          doRestore()
          return
        }
        refreshTrayMenu()
      }
    })
  }
}

function refreshTrayMenu() {
  if (!tray) return
  const { isVisible, isBossHidden } = getTrayWindowState()
  const menu = Menu.buildFromTemplate([
    {
      label: isVisible ? '状态：显示中' : isBossHidden ? '状态：已隐藏' : '状态：未显示',
      enabled: false
    },
    { type: 'separator' },
    {
      label: isBossHidden ? '恢复显示' : '打开主窗口',
      click: async () => {
        if (getTrayWindowState().isBossHidden) doRestore()
        else {
          await openMainWindow()
          refreshTrayMenu()
        }
      }
    },
    {
      label: '立即隐藏',
      enabled: isVisible,
      click: () => {
        if (getTrayWindowState().isVisible) doHide()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit()
    }
  ])
  tray.setContextMenu(menu)
}

function setupTray() {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  const retinaIconPaths = [
    { scaleFactor: 2, path: join(__dirname, '../../resources/tray-icon@2x.png') },
    { scaleFactor: 3, path: join(__dirname, '../../resources/tray-icon@3x.png') }
  ]
  const img = nativeImage.createFromPath(iconPath)
  if (!img.isEmpty()) {
    for (const { scaleFactor, path } of retinaIconPaths) {
      if (existsSync(path)) {
        img.addRepresentation({ scaleFactor, buffer: readFileSync(path) })
      }
    }
    img.setTemplateImage(true)
  }
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img)
  tray.setToolTip('Goof-off')
  refreshTrayMenu()
}

export function init(deps = {}) {
  configureBossKeyService(deps)
  const { hide, kill } = store.get('bossKeys')
  registerHideKey(hide)
  registerKillKey(kill)
  app.on('browser-window-created', (_, win) => bindTrayMenuToWindowLifecycle(win))
  for (const eventName of ['did-become-active', 'did-resign-active']) {
    app.on(eventName, () => setImmediate(refreshTrayMenu))
  }
  bindTrayMenuToWindowLifecycle(getMainWindow())
  setupTray()

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
}

export function setKey(which, accelerator) {
  const registrar = { hide: registerHideKey, kill: registerKillKey }[which]
  if (!registrar) return false
  const ok = registrar(accelerator)
  if (ok) {
    const current = store.get('bossKeys')
    store.set('bossKeys', { ...current, [which]: accelerator })
  }
  return ok
}

export function applyKeys(nextKeys) {
  const current = store.get('bossKeys')
  const failures = []

  for (const which of ['hide', 'kill']) {
    const accelerator = nextKeys?.[which]
    if (typeof accelerator !== 'string' || !accelerator || accelerator === current[which]) continue
    if (!setKey(which, accelerator)) failures.push(which)
  }

  return { keys: store.get('bossKeys'), failures }
}

export function resetKeys() {
  const defaults = getDefaultBossKeys()
  // 先注销两键并清空槽位，避免默认键位与现有另一槽位重叠时注册失败或误注销
  const prior = { hide: currentHideKey, kill: currentKillKey }
  if (currentHideKey) globalShortcut.unregister(currentHideKey)
  if (currentKillKey) globalShortcut.unregister(currentKillKey)
  currentHideKey = null
  currentKillKey = null

  const failures = []
  for (const which of ['hide', 'kill']) {
    if (!setKey(which, defaults[which])) {
      failures.push(which)
      if (prior[which]) setKey(which, prior[which])
    }
  }

  return { keys: store.get('bossKeys'), failures }
}
