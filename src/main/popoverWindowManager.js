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
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import { beginWindowOpenSample, finishWindowOpenSample } from './windowOpenLatencyProbe.js'
import { classifyPanelReveal, createPanelWindowRevealGate } from './panelWindowRevealGate.js'

const platformPolicy = getRuntimePlatformPolicy()
const revealGate = createPanelWindowRevealGate({
  enabled: platformPolicy.window.maskTransparentPanelReveal === true
})

let mainWindow = null
let ownerBinding = null
let childWindow = null
let childLoadPromise = null
let active = null
let blurTimer = null
let measureTimer = null
let pendingProgrammaticBlur = null
let openRequestSeq = 0
let lastPresentedRequestId = 0
const authorizedCloseWindows = new WeakSet()
const MEASURE_FALLBACK_DELAY_MS = 600
export const POPOVER_FOCUS_SETTLE_DELAY_MS = 80

function removeOwnerBinding() {
  if (!ownerBinding) return
  const { owner, handlers } = ownerBinding
  for (const [eventName, handler] of Object.entries(handlers)) owner.off(eventName, handler)
  ownerBinding = null
}

export function attachMainWindow(owner) {
  removeOwnerBinding()
  mainWindow = owner && !owner.isDestroyed?.() ? owner : null
  if (!mainWindow) return
  const capturedOwner = mainWindow
  const isCurrentOwner = () => mainWindow === capturedOwner && !capturedOwner.isDestroyed()
  const handlers = {
    move: () => isCurrentOwner() && handleMainMove(),
    resize: () => isCurrentOwner() && requestRecompute(),
    hide: () => isCurrentOwner() && deactivatePopover({ reason: 'closed', notifyOwner: true }),
    minimize: () => isCurrentOwner() && deactivatePopover({ reason: 'closed', notifyOwner: true }),
    blur: () => {
      if (!isCurrentOwner()) return
      scheduleFocusCheck({
        target: childWindow,
        requestId: active?.requestId,
        closeWhenMainFocused: false
      })
    },
    close: () => {
      if (!isCurrentOwner()) return
      if (!platformPolicy.window.keepAlivePanelsAfterMainClose) {
        if (active) deactivatePopover({ reason: 'closed', notifyOwner: true })
        destroyPopover()
        mainWindow = null
        removeOwnerBinding()
        return
      }
      const target = childWindow
      deactivatePopover({ reason: 'closed', notifyOwner: true, target })
      if (target && !target.isDestroyed()) {
        target.setParentWindow(null)
      }
      mainWindow = null
      removeOwnerBinding()
    }
  }
  for (const [eventName, handler] of Object.entries(handlers)) {
    capturedOwner.on(eventName, handler)
  }
  ownerBinding = { owner: capturedOwner, handlers }
  if (childWindow && !childWindow.isDestroyed()) childWindow.setParentWindow(capturedOwner)
}

export async function openPopover(payload) {
  const validation = validateOpenPopoverPayload(payload)
  if (!validation.ok || !mainWindow || mainWindow.isDestroyed()) return false

  const alreadyVisible = Boolean(
    active?.id === payload.id &&
    active.requestToken === payload.requestToken &&
    childWindow &&
    !childWindow.isDestroyed() &&
    childWindow.isVisible?.()
  )
  const reused = hasReadyChildWindow()
  const sample = beginWindowOpenSample('popover', { reused })
  const requestId = ++openRequestSeq
  if (alreadyVisible) {
    if (sample) {
      finishWindowOpenSample(sample, { outcome: 'already-visible', revealPath: null })
    }
    return true
  }

  if (active) {
    const sameLogicalSession = ownsActivePopover(payload)
    deactivatePopover({
      reason: sameLogicalSession ? 'closed' : 'replaced',
      notifyOwner: !sameLogicalSession
    })
  }
  active = {
    ...payload,
    measuredSizeDip: payload.desiredSizeDip,
    requestId,
    sample,
    ownerCloseNotified: false
  }

  const target = await ensureChildWindowReady()
  if (!target || active?.requestId !== requestId || childWindow !== target) return false
  if (target.getParentWindow?.() !== mainWindow) target.setParentWindow(mainWindow)
  target.setBounds(computePopoverBounds(active, active.measuredSizeDip))
  target.webContents.send('popover:snapshot', snapshotForChild(active))
  scheduleMeasureFallback(target, requestId)
  return true
}

export function closePopover(payload) {
  const validation = validateClosePopoverPayload(payload)
  if (!validation.ok) return false
  if (!ownsActivePopover(payload)) return false
  deactivatePopover({ reason: 'closed', notifyOwner: false })
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
  } else {
    active.snapshot = payload
  }

  if (!hasReadyChildWindow()) return true

  const target = childWindow
  const requestId = active.requestId
  target.setBounds(computePopoverBounds(active, active.measuredSizeDip))
  target.webContents.send('popover:snapshot', snapshotForChild(active))
  scheduleMeasureFallback(target, requestId)
  return true
}

export function measureReady({ sender, payload }) {
  if (!isActiveChildSender(sender)) return false
  const validation = validateMeasureReadyPayload(payload)
  if (!validation.ok || !ownsActivePopover(payload)) return false
  const capturedActive = active
  capturedActive.measuredSizeDip = normalizeMeasuredSize(
    payload.sizeDip,
    capturedActive.desiredSizeDip
  )
  clearTimeout(measureTimer)
  measureTimer = null
  childWindow.setBounds(computePopoverBounds(capturedActive, capturedActive.measuredSizeDip))
  presentPopoverWindow(capturedActive, 'measure-ready')
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
  if (!validation.ok || !ownsActivePopover(payload)) return false
  return sendOwnerCloseNotification(active, payload)
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

function clearSessionTimers() {
  clearTimeout(blurTimer)
  clearTimeout(measureTimer)
  blurTimer = null
  measureTimer = null
  revealGate.cancel()
}

function finishActiveSample(payload, outcome, revealPath = null) {
  if (!payload?.sample) return
  finishWindowOpenSample(payload.sample, { outcome, revealPath })
  payload.sample = null
}

function revealPayloadFor(activePayload) {
  return {
    id: activePayload.id,
    requestId: activePayload.requestId,
    ...(activePayload.requestToken ? { requestToken: activePayload.requestToken } : {})
  }
}

function finishPopoverPresentation(payload, revealPath, presentationReason = 'immediate') {
  if (childWindow?.isDestroyed?.() || active !== payload) return
  const classification = classifyPanelReveal(presentationReason)
  if (classification === 'failed') {
    destroyPopoverWindow(childWindow, { notifyReason: 'open-failed', outcome: 'destroyed' })
    return
  }
  lastPresentedRequestId = payload.requestId
  finishActiveSample(
    payload,
    classification === 'guaranteed' ? 'shown' : 'reveal-degraded',
    classification === 'guaranteed' ? revealPath : null
  )
}

function presentPopoverWindow(payload, revealPath) {
  const target = childWindow
  if (!target || target.isDestroyed()) return
  const needsMask =
    revealGate.isConcealed(target) ||
    (lastPresentedRequestId > 0 && lastPresentedRequestId !== payload.requestId)
  if (!needsMask) {
    try {
      target.showInactive()
    } catch {
      destroyPopoverWindow(target, { notifyReason: 'open-failed', outcome: 'destroyed' })
      return
    }
    finishPopoverPresentation(payload, revealPath)
    return
  }
  if (revealGate.isPending(target, payload.requestId)) return

  const revealPayload = revealPayloadFor(payload)
  const pending = revealGate.begin({
    target,
    key: payload.requestId,
    show: () => target.showInactive(),
    onComplete: (reason) => finishPopoverPresentation(payload, revealPath, reason)
  })
  if (!pending) return
  try {
    target.webContents.send('popover:prepare-reveal', revealPayload)
  } catch {
    revealGate.complete(target, payload.requestId, 'send-failed')
  }
}

function deactivatePopover({ reason, notifyOwner = true, target = childWindow } = {}) {
  if (!target || target.isDestroyed()) return false
  if (target !== childWindow) {
    authorizedCloseWindows.add(target)
    target.destroy()
    return false
  }
  const capturedActive = active
  if (notifyOwner && capturedActive) notifyOwnerClose(reason, capturedActive)
  clearSessionTimers()
  if (capturedActive) finishActiveSample(capturedActive, 'cancelled')
  if (capturedActive && target.isFocused?.()) {
    pendingProgrammaticBlur = { target, requestId: capturedActive.requestId }
  }
  active = null
  revealGate.conceal(target)
  target.hide()
  return Boolean(capturedActive)
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

function sendOwnerCloseNotification(payload, outgoingPayload) {
  if (!payload?.id) return false
  if (payload.ownerCloseNotified) return true
  if (!mainWindow || mainWindow.isDestroyed()) return false
  try {
    mainWindow.webContents.send('popover:child-close', outgoingPayload)
  } catch {
    return false
  }
  payload.ownerCloseNotified = true
  return true
}

function notifyOwnerClose(reason, payload = active) {
  if (!payload?.id) return false
  return sendOwnerCloseNotification(payload, {
    id: payload.id,
    reason,
    ...(payload.requestToken ? { requestToken: payload.requestToken } : {})
  })
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
  if (platformPolicy.family === 'mac') {
    createdWindow.excludedFromShownWindowsMenu = true
  }
  createdWindow.on('blur', () => {
    if (pendingProgrammaticBlur?.target === createdWindow) {
      pendingProgrammaticBlur = null
      return
    }
    scheduleFocusCheck({
      target: createdWindow,
      requestId: active?.requestId,
      closeWhenMainFocused: true
    })
  })
  createdWindow.on('focus', () => {
    if (pendingProgrammaticBlur?.target === createdWindow) pendingProgrammaticBlur = null
  })
  createdWindow.on('close', (event) => {
    if (authorizedCloseWindows.has(createdWindow)) return
    event.preventDefault()
    if (childWindow === createdWindow) {
      deactivatePopover({ reason: 'closed', notifyOwner: true, target: createdWindow })
      return
    }
    authorizedCloseWindows.add(createdWindow)
    createdWindow.destroy()
  })
  createdWindow.webContents.on('render-process-gone', () => {
    if (childWindow !== createdWindow) return
    destroyPopoverWindow(createdWindow, {
      notifyReason: 'crashed',
      outcome: 'renderer-gone'
    })
  })
  createdWindow.webContents.on('ipc-message', (_event, channel, payload) => {
    if (channel !== 'popover:reveal-ready') return
    if (
      childWindow !== createdWindow ||
      !active ||
      !Number.isSafeInteger(payload?.requestId) ||
      payload.requestId <= 0 ||
      !ownsActivePopover(payload)
    ) {
      return
    }
    revealGate.complete(createdWindow, payload.requestId)
  })
  createdWindow.on('closed', () => {
    authorizedCloseWindows.delete(createdWindow)
    if (childWindow !== createdWindow) return
    const capturedActive = active
    if (capturedActive) {
      notifyOwnerClose('closed', capturedActive)
      finishActiveSample(capturedActive, 'destroyed')
    }
    clearSessionTimers()
    pendingProgrammaticBlur = null
    if (childLoadPromise?.target === createdWindow) childLoadPromise = null
    active = null
    childWindow = null
    lastPresentedRequestId = 0
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

function loadChildWindow(target) {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return target.loadURL(`${process.env.ELECTRON_RENDERER_URL}/popover/index.html`)
  }
  return target.loadFile(join(__dirname, '../renderer/popover/index.html'))
}

function hasReadyChildWindow() {
  return Boolean(childWindow && !childWindow.isDestroyed() && childLoadPromise === null)
}

function hasNativeWindowEnded(target) {
  try {
    return target?.isDestroyed?.() === true
  } catch {
    return false
  }
}

function attemptExitDestroy(target) {
  if (hasNativeWindowEnded(target)) return
  try {
    target.close?.()
  } catch {
    // Exit cleanup must continue through the remaining managers and store flush.
  }
  if (hasNativeWindowEnded(target)) return
  try {
    target.destroy?.()
  } catch {
    // Native teardown is best-effort once the manager has detached its state.
  }
}

function destroyPopoverWindow(target, { notifyReason = null, outcome = 'destroyed' } = {}) {
  if (!target) return
  if (target === childWindow) {
    const capturedActive = active
    if (notifyReason && capturedActive) notifyOwnerClose(notifyReason, capturedActive)
    if (capturedActive) finishActiveSample(capturedActive, outcome)
    clearSessionTimers()
    if (pendingProgrammaticBlur) pendingProgrammaticBlur = null
    active = null
    childLoadPromise = null
    lastPresentedRequestId = 0
    childWindow = null
  }
  authorizedCloseWindows.add(target)
  if (!target.isDestroyed()) target.destroy()
}

export function destroyPopover() {
  const target = childWindow
  if (!target) return
  if (active) finishActiveSample(active, 'destroyed')
  clearSessionTimers()
  active = null
  childLoadPromise = null
  if (pendingProgrammaticBlur) pendingProgrammaticBlur = null
  childWindow = null
  lastPresentedRequestId = 0
  authorizedCloseWindows.add(target)
  attemptExitDestroy(target)
}

async function ensureChildWindowReady() {
  if (hasReadyChildWindow()) return childWindow
  if (!childWindow || childWindow.isDestroyed()) createChildWindow()
  const target = childWindow
  if (childLoadPromise?.target !== target) {
    const promise = Promise.resolve().then(() => loadChildWindow(target))
    childLoadPromise = { target, promise }
  }
  const loadState = childLoadPromise
  try {
    await loadState.promise
  } catch {
    if (childWindow === target) {
      destroyPopoverWindow(target, {
        notifyReason: 'open-failed',
        outcome: 'load-failed'
      })
    }
    return null
  }
  if (childWindow !== target || target.isDestroyed()) return null
  if (childLoadPromise === loadState) childLoadPromise = null
  return target
}

function scheduleMeasureFallback(target, requestId) {
  clearTimeout(measureTimer)
  measureTimer = setTimeout(() => {
    if (childWindow !== target || target.isDestroyed() || !active || active.requestId !== requestId)
      return
    target.setBounds(computePopoverBounds(active, active.desiredSizeDip))
    presentPopoverWindow(active, 'measure-fallback')
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

function scheduleFocusCheck({
  target = childWindow,
  requestId = active?.requestId,
  closeWhenMainFocused
}) {
  if (childWindow !== target || active?.requestId !== requestId) return
  clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    blurTimer = null
    if (childWindow !== target || active?.requestId !== requestId) return
    if (BrowserWindow.getFocusedWindow?.() === target) return
    if (!closeWhenMainFocused && BrowserWindow.getFocusedWindow?.() === mainWindow) return
    deactivatePopover({ reason: 'focus-lost', notifyOwner: true, target })
  }, POPOVER_FOCUS_SETTLE_DELAY_MS)
}
