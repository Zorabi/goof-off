import { screen } from 'electron'
import { getMainWindow } from './windowManager.js'

export const WATCHER_SAMPLE_INTERVAL_MS = 50
export const WINDOW_LEFT_CHANNEL = 'stealth:auto-hide-window-left'

let timer = null
let active = false
let sampling = false
let watcherEpoch = 0
let outsideEpoch = 0
let outsideActive = false
let sentOutsideEpoch = null
let reviewableOutsideEpochs = new Set()

function getWindow() {
  const win = getMainWindow?.()
  return win && !win.isDestroyed?.() ? win : null
}

function getCurrentOutside() {
  const win = getWindow()
  if (!win) return { ok: false, reason: 'window-not-ready' }
  const bounds = win.getBounds()
  const point = screen.getCursorScreenPoint()
  const outside =
    point.x < bounds.x ||
    point.y < bounds.y ||
    point.x >= bounds.x + bounds.width ||
    point.y >= bounds.y + bounds.height
  return { ok: true, win, outside }
}

function resetOutsideState() {
  outsideActive = false
  sentOutsideEpoch = null
  reviewableOutsideEpochs.clear()
}

function issueOutsideCandidate({ markWatcherActive = false } = {}) {
  if (markWatcherActive) outsideActive = true
  outsideEpoch += 1
  reviewableOutsideEpochs.add(outsideEpoch)
  if (markWatcherActive) sentOutsideEpoch = outsideEpoch
  return { watcherEpoch, outsideEpoch }
}

function markWatcherOutsideCandidate() {
  if (outsideActive) return { watcherEpoch, outsideEpoch: sentOutsideEpoch }
  return issueOutsideCandidate({ markWatcherActive: true })
}

function stopSampling() {
  if (timer != null) clearInterval(timer)
  timer = null
  sampling = false
}

function hasReviewableOutsideEpoch(epoch) {
  return reviewableOutsideEpochs.has(epoch)
}

function consumeReviewableOutsideEpoch(epoch) {
  reviewableOutsideEpochs.delete(epoch)
}

function createDomAuxiliaryOutsideCandidate() {
  return issueOutsideCandidate({ markWatcherActive: false })
}

function sampleWindowLeave() {
  if (!active || !sampling) return
  const current = getCurrentOutside()
  if (!current.ok) {
    disableWindowLeaveWatcher()
    return
  }
  if (!current.outside) {
    resetOutsideState()
    return
  }
  if (!outsideActive) {
    current.win.webContents?.send?.(WINDOW_LEFT_CHANNEL, markWatcherOutsideCandidate())
  }
}

export function enableWindowLeaveWatcher() {
  const win = getWindow()
  if (!win) return { ok: false, reason: 'window-not-ready' }
  disableWindowLeaveWatcher()
  watcherEpoch += 1
  active = true
  sampling = true
  resetOutsideState()
  timer = setInterval(sampleWindowLeave, WATCHER_SAMPLE_INTERVAL_MS)
  return { ok: true, watcherEpoch }
}

export function disableWindowLeaveWatcher(payload = {}) {
  if (payload?.watcherEpoch != null && payload.watcherEpoch !== watcherEpoch) {
    return { ok: false, reason: 'stale-watcher-epoch', watcherEpoch }
  }
  stopSampling()
  if (payload?.preserveReviewEpoch === true) {
    return { ok: true, watcherEpoch, sampling: false, preserved: true }
  }
  active = false
  resetOutsideState()
  return { ok: true, watcherEpoch }
}

export function reviewWindowLeaveCandidate(payload = {}) {
  if (!active) return { ok: false, reason: 'watcher-inactive', watcherEpoch }
  if (payload.watcherEpoch !== watcherEpoch) {
    return { ok: false, reason: 'stale-watcher-epoch', watcherEpoch }
  }
  if (!hasReviewableOutsideEpoch(payload.outsideEpoch)) {
    return { ok: false, reason: 'stale-outside-epoch', watcherEpoch, outsideEpoch }
  }
  const current = getCurrentOutside()
  if (!current.ok) return { ...current, watcherEpoch, outsideEpoch: payload.outsideEpoch }
  consumeReviewableOutsideEpoch(payload.outsideEpoch)
  if (!current.outside) resetOutsideState()
  return {
    ok: true,
    watcherEpoch,
    outsideEpoch: payload.outsideEpoch,
    outside: current.outside
  }
}

export function createWindowLeaveCandidate(payload = {}) {
  if (!active) return { ok: false, reason: 'watcher-inactive', watcherEpoch }
  if (payload.watcherEpoch !== watcherEpoch) {
    return { ok: false, reason: 'stale-watcher-epoch', watcherEpoch }
  }
  const current = getCurrentOutside()
  if (!current.ok) return { ...current, watcherEpoch }
  if (!current.outside) {
    resetOutsideState()
    return { ok: true, watcherEpoch, outside: false }
  }
  return { ok: true, ...createDomAuxiliaryOutsideCandidate(), outside: true }
}

export function reviewWindowLeaveFocusLoss(payload = {}) {
  if (!active) return { ok: false, reason: 'watcher-inactive', watcherEpoch }
  if (payload.watcherEpoch !== watcherEpoch) {
    return { ok: false, reason: 'stale-watcher-epoch', watcherEpoch }
  }
  const current = getCurrentOutside()
  if (!current.ok) return { ...current, watcherEpoch }
  if (!current.outside) resetOutsideState()
  return { ok: true, watcherEpoch, outside: current.outside }
}

export function getWindowLeaveWatcherState() {
  return {
    active,
    sampling,
    watcherEpoch,
    outsideEpoch,
    outsideActive,
    sentOutsideEpoch,
    reviewableOutsideEpochs: [...reviewableOutsideEpochs]
  }
}

export function configureWindowLeaveWatcherForTest() {
  if (timer != null) clearInterval(timer)
  timer = null
  active = false
  sampling = false
  watcherEpoch = 0
  outsideEpoch = 0
  resetOutsideState()
}
