import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getMainWindow } from './windowManager.js'
import { restoreMousePassthrough } from './windowMousePassthrough.js'
import { restoreStealthBodyVisibility } from './stealthBodyVisibility.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import { beginWindowOpenSample, finishWindowOpenSample } from './windowOpenLatencyProbe.js'
import { classifyPanelReveal, createPanelWindowRevealGate } from './panelWindowRevealGate.js'

let prefsWindow = null
let quarantinedPreferencesWindow = null
const platformPolicy = getRuntimePlatformPolicy()
const revealGate = createPanelWindowRevealGate({
  enabled: platformPolicy.window.maskTransparentPanelReveal === true
})
const PREFS_WINDOW_SIZE = { width: 420, height: 520 }
export const PREFERENCES_FIRST_FRAME_FALLBACK_MS = 1000
export const PREFERENCES_DEACTIVATE_ACK_TIMEOUT_MS = 1000

let prefsLoadSucceeded = false
let prefsNavigationReady = false
let navigationRevealPath = null
let firstFrameFallbackTimer = null
let shouldRevealPreferences = false
let pendingOpenRequest = null
let openRequestSequence = 0
let prefsSessionGeneration = 0
let prefsSessionActive = false
let pendingDeactivateGeneration = null
let deactivateAckTimer = null
let prefsFirstFrameReady = false
let prefsHasBeenPresented = false
let pendingPreferencesReveal = null
let preferencesRevealSequence = 0
let ownerBinding = null
const authorizedCloseWindows = new WeakSet()
const closedPreferencesWindows = new WeakSet()
const pendingNativeDialogs = new Set()

function hasPendingNativeDialogFor(target) {
  for (const lease of pendingNativeDialogs) {
    if (lease.createdWindow === target) return true
  }
  return false
}

function clearPendingNativeDialogsFor(target) {
  for (const lease of pendingNativeDialogs) {
    if (lease.createdWindow === target) pendingNativeDialogs.delete(lease)
  }
}

function isNativeDialogSessionUsable(target) {
  return Boolean(
    target &&
    prefsWindow === target &&
    !target.isDestroyed?.() &&
    !target.webContents?.isDestroyed?.() &&
    prefsNavigationReady &&
    prefsSessionActive &&
    shouldRevealPreferences &&
    pendingDeactivateGeneration === null
  )
}

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

function clearFirstFrameFallback() {
  clearTimeout(firstFrameFallbackTimer)
  firstFrameFallbackTimer = null
}

function clearDeactivateAckTimer() {
  clearTimeout(deactivateAckTimer)
  deactivateAckTimer = null
}

function cancelPendingPreferencesReveal() {
  revealGate.cancel()
  pendingPreferencesReveal = null
}

function hasNativeWindowEnded(target) {
  if (closedPreferencesWindows.has(target)) return true
  try {
    return target?.isDestroyed?.() === true
  } catch {
    return false
  }
}

function attemptNativeDestroy(target) {
  if (!hasNativeWindowEnded(target)) {
    try {
      target.close?.()
    } catch (error) {
      void error
    }
    if (!hasNativeWindowEnded(target)) {
      try {
        target.destroy?.()
      } catch (error) {
        void error
      }
    }
  }
  return hasNativeWindowEnded(target)
}

function concealAndHidePreferencesWindow(target) {
  revealGate.conceal(target)
  try {
    target.hide?.()
  } catch (error) {
    void error
  }
}

function retryQuarantinedPreferencesWindow() {
  const target = quarantinedPreferencesWindow
  if (!target) return true
  authorizedCloseWindows.add(target)
  if (!attemptNativeDestroy(target)) return false
  if (quarantinedPreferencesWindow === target) quarantinedPreferencesWindow = null
  return true
}

function unbindOwner(target = null) {
  if (!ownerBinding) return
  if (target && ownerBinding.target !== target) return
  const binding = ownerBinding
  ownerBinding = null
  try {
    binding.owner?.off?.('close', binding.closeHandler)
  } catch {
    // The owner may already be tearing down; global state is detached above.
  }
}

function bindPreferencesOwner(target, owner) {
  unbindOwner()
  if (!target || target.isDestroyed?.()) return
  if (!owner || owner.isDestroyed?.()) {
    target.setParentWindow?.(null)
    return
  }

  target.setParentWindow?.(owner)
  const closeHandler = () => {
    if (prefsWindow !== target || ownerBinding?.target !== target || ownerBinding?.owner !== owner)
      return
    if (!platformPolicy.window.keepAlivePanelsAfterMainClose) {
      destroyPreferencesWindow(target)
      return
    }
    hidePreferences(target, { reason: 'owner-close' })
    if (prefsWindow === target && !target.isDestroyed()) {
      target.hide()
      target.setParentWindow?.(null)
    }
    unbindOwner(target)
  }
  owner.on?.('close', closeHandler)
  ownerBinding = { target, owner, closeHandler }
}

function canReuseAtOpenStart() {
  return Boolean(
    prefsWindow &&
    !prefsWindow.isDestroyed?.() &&
    prefsNavigationReady &&
    pendingDeactivateGeneration === null
  )
}

function finishOpenRequest(request, outcome, revealPath = null) {
  if (!request) return
  if (request.sample) finishWindowOpenSample(request.sample, { outcome, revealPath })
  request.sample = null
  if (pendingOpenRequest === request) pendingOpenRequest = null
}

function cancelPendingOpen(outcome = 'cancelled') {
  if (pendingOpenRequest) finishOpenRequest(pendingOpenRequest, outcome)
}

function startOpenRequest() {
  if (pendingOpenRequest) finishOpenRequest(pendingOpenRequest, 'cancelled')
  cancelPendingPreferencesReveal()
  pendingOpenRequest = {
    id: ++openRequestSequence,
    sample: beginWindowOpenSample('preferences', { reused: canReuseAtOpenStart() }),
    presentationRecoveryAttempted: false
  }
  shouldRevealPreferences = true
  return pendingOpenRequest
}

function maybeMarkNavigationReadyAndReveal(target) {
  if (prefsWindow !== target || target.isDestroyed()) return
  if (!prefsLoadSucceeded || navigationRevealPath === null) return
  prefsNavigationReady = true
  clearFirstFrameFallback()
  revealIfRequested(target)
}

function revealIfRequested(target) {
  if (
    prefsWindow !== target ||
    target.isDestroyed() ||
    target.webContents.isDestroyed?.() ||
    !prefsNavigationReady ||
    !shouldRevealPreferences ||
    pendingDeactivateGeneration !== null
  ) {
    return false
  }
  if (hasPendingNativeDialogFor(target)) return false
  const request = pendingOpenRequest
  if (!request) return false
  const owner = getMainWindow()
  const usableOwner = owner && !owner.isDestroyed() ? owner : null
  bindPreferencesOwner(target, usableOwner)
  target.setBounds?.(getInitialBounds(usableOwner))
  if ((prefsHasBeenPresented || revealGate.isConcealed(target)) && !prefsSessionActive) {
    if (
      pendingPreferencesReveal?.target === target &&
      pendingPreferencesReveal.request === request
    ) {
      return true
    }
    const revealId = ++preferencesRevealSequence
    pendingPreferencesReveal = { target, request, revealId }
    const pending = revealGate.begin({
      target,
      key: revealId,
      show: () => target.showInactive(),
      onComplete: (reason) => finishPreferencesPresentation(target, request, revealId, reason)
    })
    if (!pending) return true
    try {
      target.webContents.send('preferences:prepare-reveal', revealId)
    } catch {
      revealGate.complete(target, revealId, 'send-failed')
    }
    return true
  }
  if (!target.isVisible?.()) {
    try {
      target.show()
    } catch {
      recoverFromPresentationFailure(target, request)
      return false
    }
  }
  finishPreferencesPresentation(target, request, null)
  return true
}

function finishPreferencesPresentation(
  target,
  request,
  revealId,
  presentationReason = 'immediate'
) {
  if (
    prefsWindow !== target ||
    target.isDestroyed() ||
    !shouldRevealPreferences ||
    pendingOpenRequest !== request ||
    (revealId !== null && pendingPreferencesReveal?.revealId !== revealId)
  ) {
    if (prefsWindow === target && !target.isDestroyed()) {
      revealGate.conceal(target)
      target.hide()
    }
    return
  }
  const classification = classifyPanelReveal(presentationReason)
  if (classification === 'failed') {
    pendingPreferencesReveal = null
    recoverFromPresentationFailure(target, request)
    return
  }
  pendingPreferencesReveal = null
  try {
    target.focus()
  } catch {
    recoverFromPresentationFailure(target, request)
    return
  }
  prefsSessionActive = true
  prefsHasBeenPresented = true
  finishOpenRequest(
    request,
    classification === 'guaranteed' ? 'shown' : 'reveal-degraded',
    classification === 'guaranteed' ? navigationRevealPath : null
  )
}

function recoverFromPresentationFailure(target, request) {
  const preserveOpenRequest = Boolean(
    prefsWindow === target &&
    !target.isDestroyed() &&
    shouldRevealPreferences &&
    pendingOpenRequest === request &&
    request &&
    request.presentationRecoveryAttempted !== true
  )
  if (preserveOpenRequest) request.presentationRecoveryAttempted = true
  destroyPreferencesWindow(target, { preserveOpenRequest, outcome: 'destroyed' })
}

function resetInstanceState(target) {
  if (!target || prefsWindow !== target) return
  clearPendingNativeDialogsFor(target)
  unbindOwner(target)
  clearFirstFrameFallback()
  clearDeactivateAckTimer()
  cancelPendingPreferencesReveal()
  prefsLoadSucceeded = false
  prefsFirstFrameReady = false
  prefsNavigationReady = false
  navigationRevealPath = null
  prefsSessionActive = false
  prefsHasBeenPresented = false
  pendingDeactivateGeneration = null
  prefsWindow = null
}

function clearCurrentPreferencesWindowState(
  target,
  { preserveOpenRequest = false, outcome = 'destroyed' } = {}
) {
  if (!target || prefsWindow !== target) return null
  const request = preserveOpenRequest ? pendingOpenRequest : null
  if (!preserveOpenRequest) {
    shouldRevealPreferences = false
    finishOpenRequest(pendingOpenRequest, outcome)
  }
  prefsSessionGeneration += 1
  clearPendingNativeDialogsFor(target)
  resetInstanceState(target)
  return request
}

function destroyPreferencesWindow(
  target,
  { preserveOpenRequest = false, outcome = 'destroyed' } = {}
) {
  if (!target) return
  const isCurrent = prefsWindow === target
  const request = isCurrent
    ? clearCurrentPreferencesWindowState(target, { preserveOpenRequest, outcome })
    : null
  authorizedCloseWindows.add(target)
  const ended = attemptNativeDestroy(target)
  if (isCurrent && !ended) {
    quarantinedPreferencesWindow = target
    shouldRevealPreferences = false
    if (preserveOpenRequest && request && pendingOpenRequest === request) {
      finishOpenRequest(request, outcome)
    }
  }
  if (
    isCurrent &&
    preserveOpenRequest &&
    ended &&
    request &&
    shouldRevealPreferences &&
    pendingOpenRequest === request
  ) {
    createPreferencesWindow(request)
  }
}

export function destroy() {
  const target = prefsWindow
  if (target) {
    destroyPreferencesWindow(target, { outcome: 'destroyed' })
    return
  }
  retryQuarantinedPreferencesWindow()
}

function handleDeactivateAckTimeout(target, generation) {
  if (prefsWindow !== target || pendingDeactivateGeneration !== generation) return
  const preserveOpenRequest = Boolean(shouldRevealPreferences && pendingOpenRequest)
  destroyPreferencesWindow(target, { preserveOpenRequest })
}

function handleUntrustedPreferencesWindow(target, generation) {
  if (prefsWindow !== target || pendingDeactivateGeneration !== generation) return
  const preserveOpenRequest = Boolean(shouldRevealPreferences && pendingOpenRequest)
  destroyPreferencesWindow(target, { preserveOpenRequest })
}

function hidePreferences(target, { reason = 'close' } = {}) {
  shouldRevealPreferences = false
  cancelPendingOpen(reason === 'destroyed' ? 'destroyed' : 'cancelled')
  cancelPendingPreferencesReveal()
  if (!target) {
    retryQuarantinedPreferencesWindow()
    return false
  }
  if (target !== prefsWindow || target.isDestroyed()) return false

  const wasSessionActive = prefsSessionActive
  prefsSessionActive = false
  const hasPendingNativeDialog = hasPendingNativeDialogFor(target)
  if (wasSessionActive) {
    const generation = ++prefsSessionGeneration
    pendingDeactivateGeneration = generation
    clearDeactivateAckTimer()
    if (hasPendingNativeDialog) {
      concealAndHidePreferencesWindow(target)
      destroyPreferencesWindow(target, { outcome: 'destroyed' })
      return true
    }
    deactivateAckTimer = setTimeout(
      () => handleDeactivateAckTimeout(target, generation),
      PREFERENCES_DEACTIVATE_ACK_TIMEOUT_MS
    )
    try {
      target.webContents.send('preferences:deactivate', generation)
    } catch {
      handleUntrustedPreferencesWindow(target, generation)
      return true
    }
  }
  if (!hasNativeWindowEnded(target)) concealAndHidePreferencesWindow(target)
  return true
}

function createPreferencesWindow(request) {
  if (!request || pendingOpenRequest !== request || !shouldRevealPreferences) return null

  clearFirstFrameFallback()
  clearDeactivateAckTimer()
  prefsLoadSucceeded = false
  prefsFirstFrameReady = false
  prefsNavigationReady = false
  navigationRevealPath = null
  prefsSessionActive = false
  prefsHasBeenPresented = false
  pendingDeactivateGeneration = null

  const parent = getMainWindow()
  const usableParent = parent && !parent.isDestroyed() ? parent : null
  const initialBounds = getInitialBounds(usableParent)
  const createdWindow = new BrowserWindow({
    ...(usableParent ? { parent: usableParent } : {}),
    ...initialBounds,
    frame: false,
    transparent: true,
    ...getPreferencesPlatformOptions(),
    resizable: false,
    show: false,
    acceptFirstMouse: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preferences.js'),
      sandbox: false
    }
  })
  prefsWindow = createdWindow
  authorizedCloseWindows.delete(createdWindow)
  if (platformPolicy.family === 'mac') {
    createdWindow.excludedFromShownWindowsMenu = true
  }
  bindPreferencesOwner(createdWindow, usableParent)

  createdWindow.once('ready-to-show', () => {
    if (prefsWindow !== createdWindow || createdWindow.isDestroyed()) return
    if (prefsFirstFrameReady) return
    prefsFirstFrameReady = true
    navigationRevealPath = 'ready-to-show'
    maybeMarkNavigationReadyAndReveal(createdWindow)
  })
  createdWindow.on('close', (event) => {
    if (authorizedCloseWindows.has(createdWindow)) return
    event.preventDefault()
    if (prefsWindow === createdWindow) {
      hidePreferences(createdWindow, { reason: 'native-close' })
    }
  })
  createdWindow.webContents.on('ipc-message', (_event, channel, generation) => {
    if (
      channel === 'preferences:reveal-ready' &&
      Number.isSafeInteger(generation) &&
      generation > 0 &&
      prefsWindow === createdWindow &&
      pendingPreferencesReveal?.target === createdWindow &&
      pendingPreferencesReveal.revealId === generation &&
      shouldRevealPreferences &&
      pendingDeactivateGeneration === null &&
      !hasPendingNativeDialogFor(createdWindow)
    ) {
      revealGate.complete(createdWindow, generation)
      return
    }
    if (
      channel !== 'preferences:deactivated' ||
      !Number.isSafeInteger(generation) ||
      generation <= 0 ||
      prefsWindow !== createdWindow ||
      pendingDeactivateGeneration !== generation
    ) {
      return
    }
    clearDeactivateAckTimer()
    pendingDeactivateGeneration = null
    revealIfRequested(createdWindow)
  })
  createdWindow.on('closed', () => {
    closedPreferencesWindows.add(createdWindow)
    authorizedCloseWindows.delete(createdWindow)
    if (quarantinedPreferencesWindow === createdWindow) quarantinedPreferencesWindow = null
    clearCurrentPreferencesWindowState(createdWindow)
  })
  createdWindow.webContents.on('render-process-gone', () => {
    if (prefsWindow !== createdWindow) return
    const preserveOpenRequest = Boolean(
      pendingDeactivateGeneration !== null && shouldRevealPreferences && pendingOpenRequest
    )
    destroyPreferencesWindow(createdWindow, { preserveOpenRequest, outcome: 'renderer-gone' })
  })

  const load =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? createdWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/preferences/index.html`)
      : createdWindow.loadFile(join(__dirname, '../renderer/preferences/index.html'))
  Promise.resolve(load)
    .then(() => {
      if (prefsWindow !== createdWindow || createdWindow.isDestroyed()) return
      prefsLoadSucceeded = true
      if (!prefsFirstFrameReady) {
        firstFrameFallbackTimer = setTimeout(() => {
          if (
            prefsWindow !== createdWindow ||
            createdWindow.isDestroyed() ||
            createdWindow.webContents.isDestroyed?.() ||
            !prefsLoadSucceeded ||
            prefsFirstFrameReady
          )
            return
          prefsFirstFrameReady = true
          navigationRevealPath = 'first-frame-fallback'
          maybeMarkNavigationReadyAndReveal(createdWindow)
        }, PREFERENCES_FIRST_FRAME_FALLBACK_MS)
      }
      maybeMarkNavigationReadyAndReveal(createdWindow)
    })
    .catch((error) => {
      if (prefsWindow !== createdWindow) return
      console.warn('[preferencesWindow] load failed:', error?.message || error)
      destroyPreferencesWindow(createdWindow, { outcome: 'load-failed' })
    })

  return createdWindow
}

export function open() {
  const request = startOpenRequest()
  void restoreMousePassthrough('preferences-open')
  restoreStealthBodyVisibility('preferences-open')
  if (!retryQuarantinedPreferencesWindow()) {
    if (pendingOpenRequest === request) {
      shouldRevealPreferences = false
      finishOpenRequest(request, 'destroyed')
    }
    return null
  }

  const target = prefsWindow
  if (target && !target.isDestroyed()) {
    if (
      prefsNavigationReady &&
      pendingDeactivateGeneration === null &&
      !hasPendingNativeDialogFor(target) &&
      prefsSessionActive &&
      target.isVisible?.()
    ) {
      target.focus()
      prefsSessionActive = true
      finishOpenRequest(request, 'already-visible')
      return target
    }
    const owner = getMainWindow()
    const usableOwner = owner && !owner.isDestroyed() ? owner : null
    bindPreferencesOwner(target, usableOwner)
    revealIfRequested(target)
    return target
  }
  if (target) clearCurrentPreferencesWindowState(target, { preserveOpenRequest: true })
  return createPreferencesWindow(request)
}

export function toggle() {
  if (
    shouldRevealPreferences ||
    (prefsWindow && !prefsWindow.isDestroyed() && prefsWindow.isVisible?.())
  ) {
    hidePreferences(prefsWindow, { reason: 'toggle' })
    return
  }
  open()
}

export function close() {
  return hidePreferences(prefsWindow, { reason: 'close' })
}

export function hideForOwnerHide() {
  return hidePreferences(prefsWindow, { reason: 'owner-hide' })
}

export function getWindow() {
  return prefsWindow
}

export function beginNativeDialog(sender) {
  const target = prefsWindow
  if (!isNativeDialogSessionUsable(target) || target.webContents !== sender) return null
  const lease = { createdWindow: target, prefsSessionGeneration }
  pendingNativeDialogs.add(lease)
  return lease
}

export function finishNativeDialog(lease) {
  if (!lease || !pendingNativeDialogs.delete(lease)) return undefined
  const target = lease.createdWindow
  if (!hasPendingNativeDialogFor(target) && pendingOpenRequest) revealIfRequested(target)
  return undefined
}

export function isNativeDialogSessionCurrent(lease) {
  if (!lease || !pendingNativeDialogs.has(lease)) return false
  const target = lease.createdWindow
  return (
    lease.prefsSessionGeneration === prefsSessionGeneration && isNativeDialogSessionUsable(target)
  )
}
