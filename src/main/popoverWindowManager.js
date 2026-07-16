import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import {
  validateClosePopoverPayload,
  validateMeasureReadyPayload,
  validateOpenPopoverPayload,
  validatePopoverAction,
  validateUpdatePopoverPayload
} from '../shared/popoverProtocol.js'

let mainWindow = null
let childWindow = null
let active = null
let blurTimer = null
let measureTimer = null
let openRequestSeq = 0
const MEASURE_FALLBACK_DELAY_MS = 600
export const POPOVER_FOCUS_SETTLE_DELAY_MS = 80

export function attachMainWindow(win) {
  mainWindow = win
  if (!win) return
  win.on('move', handleMainMove)
  win.on('resize', requestRecompute)
  win.on('hide', closeActivePopoverFromOwnerWindow)
  win.on('minimize', closeActivePopoverFromOwnerWindow)
  win.on('close', closeActivePopoverFromOwnerWindow)
  win.on('blur', scheduleMainBlurFocusCheck)
}

export async function openPopover(payload) {
  const validation = validateOpenPopoverPayload(payload)
  if (!validation.ok || !mainWindow || mainWindow.isDestroyed()) return false

  const requestId = ++openRequestSeq
  const replacing = active?.id && active.id !== payload.id
  if (replacing) {
    notifyOwnerClose('replaced')
    closeActivePopover()
  }
  const needsLoad = !childWindow || childWindow.isDestroyed()
  active = { ...payload, measuredSizeDip: payload.desiredSizeDip, requestId }

  if (needsLoad) createChildWindow()
  if (needsLoad) {
    try {
      await loadChildWindow()
    } catch {
      if (active?.requestId === requestId) {
        notifyOwnerClose('open-failed')
        closeActivePopover()
      }
      return false
    }
  }
  if (active?.requestId === requestId && childWindow && !childWindow.isDestroyed()) {
    childWindow.setBounds(computePopoverBounds(active, active.measuredSizeDip))
    childWindow.webContents.send('popover:snapshot', snapshotForChild(active))
    scheduleMeasureFallback(requestId)
  }
  return active?.requestId === requestId
}

export function closePopover(payload) {
  const validation = validateClosePopoverPayload(payload)
  if (!validation.ok) return false
  if (!ownsActivePopover(payload)) return false
  closeActivePopover()
  return true
}

export function updateSnapshot(payload) {
  const validation = validateUpdatePopoverPayload(payload)
  if (!validation.ok || !ownsActivePopover(payload) || !childWindow || childWindow.isDestroyed())
    return false
  if (payload.snapshot) {
    active = {
      ...active,
      placement: payload.placement,
      triggerRectDip: payload.triggerRectDip,
      desiredSizeDip: payload.desiredSizeDip,
      mainWindowSizeDip: payload.mainWindowSizeDip,
      snapshot: payload.snapshot,
      measuredSizeDip: payload.desiredSizeDip
    }
    childWindow.setBounds(computePopoverBounds(active, active.measuredSizeDip))
    scheduleMeasureFallback(active.requestId)
  } else {
    active.snapshot = payload
  }
  childWindow.webContents.send('popover:snapshot', snapshotForChild(active))
  return true
}

export function measureReady({ sender, payload }) {
  if (!isActiveChildSender(sender)) return false
  const validation = validateMeasureReadyPayload(payload)
  if (!validation.ok || !ownsActivePopover(payload)) return false
  active.measuredSizeDip = normalizeMeasuredSize(payload.sizeDip, active.desiredSizeDip)
  clearTimeout(measureTimer)
  measureTimer = null
  childWindow.setBounds(computePopoverBounds(active, active.measuredSizeDip))
  childWindow.showInactive()
  return true
}

export function forwardChildAction({ sender, payload }) {
  if (!isActiveChildSender(sender)) return false
  const validation = validatePopoverAction(payload)
  if (!validation.ok || !ownsActivePopover(payload) || !mainWindow || mainWindow.isDestroyed())
    return false
  mainWindow.webContents.send('popover:child-action', payload)
  return true
}

export function requestCloseFromChild({ sender, payload }) {
  if (!isActiveChildSender(sender)) return false
  const validation = validateClosePopoverPayload(payload)
  if (!validation.ok || !ownsActivePopover(payload) || !mainWindow || mainWindow.isDestroyed())
    return false
  mainWindow.webContents.send('popover:child-close', payload)
  return true
}

export function isMainSender(sender) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents)
}

export function isActiveChildSender(sender) {
  return Boolean(childWindow && !childWindow.isDestroyed() && sender === childWindow.webContents)
}

export async function isChildPopoverFocused() {
  if (!active || !childWindow || childWindow.isDestroyed()) return false
  await waitForFocusSettle()
  return isFocusedWindowChildPopover()
}

export function closeActivePopover() {
  clearTimeout(blurTimer)
  clearTimeout(measureTimer)
  blurTimer = null
  measureTimer = null
  active = null
  if (childWindow && !childWindow.isDestroyed()) childWindow.close()
  childWindow = null
}

export function computePopoverBounds(payload, sizeDip = payload.desiredSizeDip) {
  const mainBounds = mainWindow.getContentBounds()
  const trigger = {
    x: mainBounds.x + payload.triggerRectDip.x,
    y: mainBounds.y + payload.triggerRectDip.y,
    width: payload.triggerRectDip.width,
    height: payload.triggerRectDip.height
  }
  const display = screen.getDisplayMatching(trigger)
  const workArea = display.workArea
  const size = {
    width: Math.min(Math.ceil(sizeDip.width), workArea.width),
    height: Math.min(Math.ceil(sizeDip.height), workArea.height)
  }
  const candidates = placementCandidates(trigger, size, payload.placement)
  const visible = candidates.find((item) => isFullyVisible(item.bounds, workArea))
  const chosen = visible?.bounds ?? clampBounds(candidates[0].bounds, workArea, size)
  return roundBounds(chosen)
}

function normalizeMeasuredSize(sizeDip, desiredSizeDip) {
  return {
    width: Math.max(Math.ceil(sizeDip.width), Math.ceil(desiredSizeDip.width)),
    height: Math.ceil(sizeDip.height)
  }
}

function snapshotForChild(payload) {
  if (!payload.requestToken) return payload.snapshot
  return { ...payload.snapshot, requestToken: payload.requestToken }
}

function ownsActivePopover(payload) {
  if (active?.id !== payload.id) return false
  if (active.requestToken) return payload.requestToken === active.requestToken
  return payload.requestToken === undefined
}

function notifyOwnerClose(reason, payload = active) {
  if (!payload?.id || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('popover:child-close', {
    id: payload.id,
    reason,
    ...(payload.requestToken ? { requestToken: payload.requestToken } : {})
  })
}

function closeActivePopoverFromOwnerWindow() {
  if (active) notifyOwnerClose('closed')
  closeActivePopover()
}

function createChildWindow() {
  childWindow = new BrowserWindow({
    ...computeInitialChildBounds(active),
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: true,
    resizable: false,
    skipTaskbar: true,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      preload: join(__dirname, '../preload/popover.js'),
      sandbox: false
    }
  })
  const createdWindow = childWindow
  createdWindow.on('blur', scheduleChildBlurFocusCheck)
  createdWindow.webContents.on('did-finish-load', () => {
    if (!active || childWindow !== createdWindow || createdWindow.isDestroyed()) return
    createdWindow.webContents.send('popover:snapshot', snapshotForChild(active))
  })
  createdWindow.webContents.on('render-process-gone', handleChildRendererGone)
  createdWindow.on('closed', () => {
    if (childWindow !== createdWindow) return
    childWindow = null
    active = null
  })
}

function computeInitialChildBounds(payload) {
  if (!mainWindow || mainWindow.isDestroyed() || !payload?.triggerRectDip) {
    return { width: 1, height: 1 }
  }
  const mainBounds = mainWindow.getContentBounds()
  return {
    x: Math.round(mainBounds.x + payload.triggerRectDip.x),
    y: Math.round(mainBounds.y + payload.triggerRectDip.y),
    width: 1,
    height: 1
  }
}

function loadChildWindow() {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return childWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/popover/index.html`)
  }
  return childWindow.loadFile(join(__dirname, '../renderer/popover/index.html'))
}

function scheduleMeasureFallback(requestId) {
  clearTimeout(measureTimer)
  measureTimer = setTimeout(() => {
    if (!active || active.requestId !== requestId || !childWindow || childWindow.isDestroyed())
      return
    childWindow.setBounds(computePopoverBounds(active, active.desiredSizeDip))
    childWindow.showInactive()
  }, MEASURE_FALLBACK_DELAY_MS)
}

function placementCandidates(trigger, size, placement) {
  return [placementCandidate(trigger, size, placement)]
}

function placementCandidate(trigger, size, placement) {
  if (placement === 'bottom') {
    return {
      placement,
      bounds: {
        x: trigger.x + trigger.width / 2 - size.width / 2,
        y: trigger.y + trigger.height,
        ...size
      }
    }
  }
  if (placement === 'left') {
    return {
      placement,
      bounds: {
        x: trigger.x - size.width,
        y: trigger.y + trigger.height / 2 - size.height / 2,
        ...size
      }
    }
  }
  if (placement === 'right') {
    return {
      placement,
      bounds: {
        x: trigger.x + trigger.width,
        y: trigger.y + trigger.height / 2 - size.height / 2,
        ...size
      }
    }
  }
  return {
    placement: 'top',
    bounds: {
      x: trigger.x + trigger.width / 2 - size.width / 2,
      y: trigger.y - size.height,
      ...size
    }
  }
}

function isFullyVisible(bounds, workArea) {
  return (
    bounds.x >= workArea.x &&
    bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y + bounds.height <= workArea.y + workArea.height
  )
}

function clampBounds(bounds, workArea, size) {
  return {
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - size.height),
    width: size.width,
    height: size.height
  }
}

function roundBounds(bounds) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
}

function handleMainMove() {
  if (!active || !childWindow || childWindow.isDestroyed()) return
  childWindow.setBounds(computePopoverBounds(active, active.measuredSizeDip))
  requestRecompute()
}

function handleChildRendererGone() {
  notifyOwnerClose('crashed')
  closeActivePopover()
}

function requestRecompute() {
  if (!active || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('popover:recompute-request', { id: active.id })
}

function waitForFocusSettle() {
  return new Promise((resolve) => setTimeout(resolve, POPOVER_FOCUS_SETTLE_DELAY_MS))
}

function isFocusedWindowChildPopover() {
  if (!active || !childWindow || childWindow.isDestroyed()) return false
  return BrowserWindow.getFocusedWindow?.() === childWindow
}

function isFocusedWindowMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false
  return BrowserWindow.getFocusedWindow?.() === mainWindow
}

function scheduleMainBlurFocusCheck() {
  scheduleFocusCheck({ closeWhenMainFocused: false })
}

function scheduleChildBlurFocusCheck() {
  scheduleFocusCheck({ closeWhenMainFocused: true })
}

function scheduleFocusCheck({ closeWhenMainFocused }) {
  clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    if (isFocusedWindowChildPopover()) return
    if (!closeWhenMainFocused && isFocusedWindowMainWindow()) return
    if (!active || !childWindow || childWindow.isDestroyed()) return
    notifyOwnerClose('focus-lost')
    closeActivePopover()
  }, POPOVER_FOCUS_SETTLE_DELAY_MS)
}
