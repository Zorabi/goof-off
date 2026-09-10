import { WebContentsView } from 'electron'
import { sendPageMessage } from './pageMessage.js'
import { isAllowedProtocol } from './urlPolicy.js'
import { attachCDPFallback } from './dialogBridgeSetup.js'
import { getMainWindow } from './windowManager.js'
import store from './store.js'
import {
  clearSiteWebPrefs,
  extractWebOrigin,
  resolveEffectiveUA,
  resolveEffectiveWebPrefs,
  shouldInjectPlainView,
  shouldReloadForUA,
  upsertSiteWebPrefs
} from './webPrefs.js'
import {
  clampGestureZoom,
  classifyWheelGesture,
  createWheelGestureRecognizer
} from '../shared/trackpadGesture.js'
import { canonicalizeWebUrl } from '../shared/webUrlCanonical.js'
import {
  createWebWheelSpeedScript,
  INJECTED_WHEEL_MARKER_SCREEN_X,
  INJECTED_WHEEL_MARKER_SCREEN_Y
} from '../shared/webWheelSpeedScript.js'
import { CHROME_HOT_ZONE_HEIGHT, createChromeLayout } from '../shared/chromeLayoutModel.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import * as preferencesWindow from './preferencesWindow.js'
import { diagnosticLogger } from './diagnosticLogger.js'
import { getEffectiveOpacity } from './transparencyService.js'

export const HIDE_MEDIA_CSS = `
img,
picture,
video,
audio,
source,
track,
svg image,
embed[type^='image/'],
object[type^='image/'] {
  display: none !important;
  visibility: hidden !important;
}`.trim()
export const PLAIN_VIEW_CSS = `
html,
body,
body *,
html::before,
html::after,
body::before,
body::after,
body *::before,
body *::after {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}`.trim()
export const STEALTH_TRANSPARENT_BACKGROUND_CSS = `
html,
body {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
}`.trim()
const HIDE_SCROLLBAR_CSS = [
  'html,',
  'body {',
  '  scrollbar-width: none;',
  '}',
  '',
  '::-webkit-scrollbar {',
  '  display: none;',
  '}',
  '',
  '::-webkit-scrollbar,',
  '::-webkit-scrollbar:hover,',
  '::-webkit-scrollbar:active,',
  '::-webkit-scrollbar-track,',
  '::-webkit-scrollbar-track:hover,',
  '::-webkit-scrollbar-track:active,',
  '::-webkit-scrollbar-track-piece,',
  '::-webkit-scrollbar-track-piece:hover,',
  '::-webkit-scrollbar-track-piece:active,',
  '::-webkit-scrollbar-corner,',
  '::-webkit-scrollbar-corner:hover,',
  '::-webkit-scrollbar-corner:active {',
  '  background: transparent;',
  '  background-color: transparent;',
  '  background-image: none;',
  '  border: 0;',
  '  box-shadow: none;',
  '}'
].join('\n')
const PAUSE_ACTIVE_MEDIA_SCRIPT = `(() => {
  const media = Array.from(document.querySelectorAll('audio,video'))
  let attempted = 0
  let paused = 0
  for (const item of media) {
    if (item.paused || item.ended) continue
    attempted += 1
    try {
      item.pause()
      if (item.paused) paused += 1
    } catch {}
  }
  return { attempted, paused }
})()`

function normalizeRecoverableWebUrl(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

let view = null
let boundMainWindow = null
let resizeHandler = null
let lastNavStateJSON = ''
const chromeReserves = new Map()
let resizeTimer = null
let lastOpacity = 1
let stealthOpacityMultiplier = 1
let stealthBodyActivityBridgeEnabled = false
let opacityCssKey = null
let opacityCssValue = null
let stealthTransparentBackgroundCssKey = null
let hideScrollbarCssKey = null
let plainViewCssKey = null
let hideMediaCssKey = null
let visibleIntent = false
let sessionReady = false
let historyService = null
let pendingWebHistory = null
let staleWebHistoryKeys = new Set()
let currentUrl = ''
let currentOrigin = null
let sessionZoom = null
let webSwipeRecognizer = createWheelGestureRecognizer()
let runtimeAppState = null
let lastWebHotZoneState = { top: false, bottom: false }
let wheelSpeed = 1
let injectingWheelCount = 0
let openSiteSeq = 0
let pendingOpenCancellation = null
let cancelledOpenResults = new Map()
let silentLoadErrorKeys = new Set()
let silentLoadErrorTimers = new Map()
let pageScopedCssFresh = false
let mainFrameNavigationSeq = 0

const STEALTH_ACTIVITY_BY_MOUSE_TYPE = {
  mouseMove: 'mousemove',
  mouseWheel: 'wheel',
  mouseDown: 'pointerdown'
}

// mousemove 活动信号只用于重置自动隐藏计时，60-120Hz 逐条转发 IPC 纯属浪费；
// leading 节流即可，wheel/pointerdown 保持直发（低频且语义即时）。
const STEALTH_MOUSE_MOVE_ACTIVITY_THROTTLE_MS = 100
let lastStealthMouseMoveActivityAt = 0

// 热区判定几何缓存：mousemove 每次都 getContentBounds + 构建完整 chrome 布局代价过高，
// 只在几何真正变化（layout / resize / appState 变更）时失效重算。
let hotZoneGeometry = null

function invalidateHotZoneGeometry() {
  hotZoneGeometry = null
}

function resetPageScopedCssKeys() {
  opacityCssKey = null
  opacityCssValue = null
  stealthTransparentBackgroundCssKey = null
  hideScrollbarCssKey = null
  plainViewCssKey = null
  hideMediaCssKey = null
}

function staleOpenResult() {
  return { ok: false, reason: 'stale', message: '网页加载已过期' }
}

function cancelledOpenOutcome(result = staleOpenResult()) {
  return { type: 'cancelled', result }
}

function logOpenResult(result, requestSeq) {
  const level = result?.ok ? 'info' : 'warn'
  diagnosticLogger[level]('web.open.result', { ...result, requestSeq }, 'main')
}

function createPendingOpenCancellation(requestSeq) {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  pendingOpenCancellation = { requestSeq, resolve }
  return promise
}

function clearPendingOpenCancellation(requestSeq) {
  if (pendingOpenCancellation?.requestSeq === requestSeq) pendingOpenCancellation = null
}

function consumeCancelledOpenResult(requestSeq) {
  const result = cancelledOpenResults.get(requestSeq)
  cancelledOpenResults.delete(requestSeq)
  return result
}

function cancelPendingOpen(result = staleOpenResult()) {
  if (!pendingOpenCancellation) return false
  const pending = pendingOpenCancellation
  pendingOpenCancellation = null
  cancelledOpenResults.set(pending.requestSeq, result)
  if (pendingWebHistory?.requestedKey) staleWebHistoryKeys.add(pendingWebHistory.requestedKey)
  pendingWebHistory = null
  pending.resolve(cancelledOpenOutcome(result))
  return true
}

function clearSilentLoadErrorKey(key) {
  const timer = key ? silentLoadErrorTimers.get(key) : null
  if (timer) {
    clearTimeout(timer)
    silentLoadErrorTimers.delete(key)
  }
  if (key) silentLoadErrorKeys.delete(key)
}

function addSilentLoadErrorKey(key) {
  if (!key) return
  clearSilentLoadErrorKey(key)
  silentLoadErrorKeys.add(key)
}

function expireSilentLoadErrorKeySoon(key) {
  if (!key || !silentLoadErrorKeys.has(key) || silentLoadErrorTimers.has(key)) return
  const timer = setTimeout(() => {
    silentLoadErrorKeys.delete(key)
    silentLoadErrorTimers.delete(key)
  }, 1000)
  silentLoadErrorTimers.set(key, timer)
}

function sendCurrentSitePrefsToPreferencesWindow() {
  const prefsWin = preferencesWindow.getWindow()
  if (prefsWin && !prefsWin.isDestroyed()) {
    prefsWin.webContents.send('site-web-prefs:changed', getCurrentSiteWebPrefs())
  }
}

function setCurrentUrl(url) {
  const previousOrigin = currentOrigin
  currentUrl = typeof url === 'string' ? url : ''
  currentOrigin = extractWebOrigin(currentUrl)
  if (previousOrigin !== currentOrigin) sendCurrentSitePrefsToPreferencesWindow()
}

export function setCurrentUrlForTest(url) {
  setCurrentUrl(url)
}

export function getEffectiveCurrentWebPrefs() {
  return resolveEffectiveWebPrefs({
    webPrefs: store.get('webPrefs'),
    siteWebPrefs: store.get('siteWebPrefs'),
    origin: currentOrigin
  })
}

export function getCurrentSiteWebPrefs() {
  const sites = store.get('siteWebPrefs') || {}
  const effectivePrefs = getEffectiveCurrentWebPrefs()
  return {
    origin: currentOrigin,
    override: currentOrigin ? sites[currentOrigin] || null : null,
    effectivePrefs
  }
}

export function setHistoryService(service) {
  historyService = service
}

export function setHistoryServiceForTest(service) {
  historyService = service
  pendingWebHistory = null
  staleWebHistoryKeys = new Set()
}

let cssChain = Promise.resolve()
function queueCss(fn) {
  cssChain = cssChain.then(fn).catch((e) => {
    console.warn('[webviewManager] css op failed:', e?.message)
  })
  return cssChain
}

let pendingContentOpacity = null
let contentOpacityFlushQueued = false

function normalizeOpacityValue(value, fallback = 1) {
  const next = Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.min(1, Math.max(0, next))
}

function getEffectiveContentOpacity() {
  return normalizeOpacityValue(lastOpacity) * normalizeOpacityValue(stealthOpacityMultiplier)
}

function shouldHandleWebInputGesture() {
  const appState = getRuntimeAppState()
  return (
    appState.content === 'web' &&
    appState.form !== 'mini' &&
    visibleIntent === true &&
    sessionReady === true
  )
}

function getRuntimeAppState() {
  return runtimeAppState || store.get('appState') || {}
}

function shouldBridgeWebHotZones() {
  const appState = getRuntimeAppState()
  return (
    appState.content === 'web' &&
    appState.form === 'normal' &&
    visibleIntent === true &&
    sessionReady === true
  )
}

function sendWebHotZoneState(nextState, { force = false } = {}) {
  const normalized = {
    top: nextState?.top === true,
    bottom: nextState?.bottom === true
  }
  if (
    !force &&
    normalized.top === lastWebHotZoneState.top &&
    normalized.bottom === lastWebHotZoneState.bottom
  ) {
    return
  }
  lastWebHotZoneState = normalized
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('browser:web-hot-zone-state', normalized)
}

function resetWebHotZoneState(options) {
  sendWebHotZoneState({ top: false, bottom: false }, options)
}

function resolveHotZoneGeometry(mainWindow) {
  if (hotZoneGeometry) return hotZoneGeometry
  const windowSize = mainWindow.getContentBounds()
  const layoutState = createWebContentsLayout(windowSize)
  hotZoneGeometry = {
    contentY: layoutState.webContentsRect.y,
    windowHeight: windowSize.height
  }
  return hotZoneGeometry
}

function updateWebHotZoneBridge(input) {
  if (input?.type === 'mouseLeave') {
    resetWebHotZoneState({ force: true })
    return
  }
  if (input?.type !== 'mouseMove') return
  if (!shouldBridgeWebHotZones()) {
    resetWebHotZoneState()
    return
  }
  const y = Number(input.y)
  if (!Number.isFinite(y)) return
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  const geometry = resolveHotZoneGeometry(mainWindow)
  const windowY = geometry.contentY + y
  sendWebHotZoneState({
    top: windowY >= 0 && windowY < CHROME_HOT_ZONE_HEIGHT,
    bottom:
      windowY >= Math.max(0, geometry.windowHeight - CHROME_HOT_ZONE_HEIGHT) &&
      windowY < geometry.windowHeight
  })
}

function shouldHandleWebWheelSpeed() {
  const appState = getRuntimeAppState()
  return appState.content === 'web' && visibleIntent === true && sessionReady === true
}

function hasElectronModifier(input, names) {
  if (!Array.isArray(input?.modifiers)) return false
  const normalizedNames = new Set(names.map((name) => String(name).toLowerCase()))
  return input.modifiers.some((modifier) => normalizedNames.has(String(modifier).toLowerCase()))
}

function hasControlModifier(input) {
  return hasElectronModifier(input, ['control', 'ctrl'])
}

function hasShiftModifier(input) {
  return hasElectronModifier(input, ['shift'])
}

export function applyWheelSpeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    wheelSpeed = Math.max(0.1, Math.min(2, value))
  } else {
    wheelSpeed = 1
  }
  applyWheelSpeedScript()
}

function applyWheelSpeedScript() {
  if (!view || !sessionReady) return
  try {
    Promise.resolve(
      view.webContents.executeJavaScript(createWebWheelSpeedScript(wheelSpeed))
    ).catch((e) => {
      console.warn('[webviewManager] inject wheel speed script failed:', e?.message)
    })
  } catch (e) {
    console.warn('[webviewManager] inject wheel speed script failed:', e?.message)
  }
}

function injectScaledWheel(input, speed) {
  if (!view) return
  const modifiers = Array.isArray(input.modifiers) ? [...input.modifiers] : null
  const event = {
    type: 'mouseWheel',
    x: input.x,
    y: input.y,
    deltaX: Math.round((input.deltaX || 0) * speed),
    deltaY: Math.round((input.deltaY || 0) * speed),
    globalX: INJECTED_WHEEL_MARKER_SCREEN_X,
    globalY: INJECTED_WHEEL_MARKER_SCREEN_Y,
    hasPreciseScrollingDeltas: input.hasPreciseScrollingDeltas === true,
    canScroll: true
  }
  if (modifiers) event.modifiers = modifiers
  if (typeof input.wheelTicksX === 'number' && Number.isFinite(input.wheelTicksX)) {
    event.wheelTicksX = input.wheelTicksX * speed
  }
  if (typeof input.wheelTicksY === 'number' && Number.isFinite(input.wheelTicksY)) {
    event.wheelTicksY = input.wheelTicksY * speed
  }

  injectingWheelCount += 1
  try {
    view.webContents.sendInputEvent(event)
  } catch (e) {
    console.warn('[webviewManager] send scaled wheel failed:', e?.message)
  } finally {
    injectingWheelCount -= 1
  }
}

function maybeScaleWheelEvent(event, input) {
  if (!shouldHandleWebWheelSpeed()) return false
  if (hasControlModifier(input) || hasShiftModifier(input)) return false
  if (input?.hasPreciseScrollingDeltas === true) return false
  if ((input.deltaX || 0) === 0 && (input.deltaY || 0) === 0) return false
  if (wheelSpeed === 1) return false
  event.preventDefault()
  injectScaledWheel(input, wheelSpeed)
  return true
}

export function updateAppStateForRuntime(partial = {}) {
  const safePartial = partial && typeof partial === 'object' ? partial : {}
  runtimeAppState = { ...getRuntimeAppState(), ...safePartial }
  invalidateHotZoneGeometry()
  if (runtimeAppState.content !== 'web' || runtimeAppState.form !== 'normal') {
    resetWebHotZoneState()
  }
  return runtimeAppState
}

function handleWebHorizontalGesture(direction) {
  if (direction === 'left') return goBack()
  if (direction === 'right') return goForward()
}

function computeNextSessionZoomFromWheel(input) {
  const effective = getEffectiveCurrentWebPrefs()
  const base = sessionZoom ?? effective.zoom
  const direction = input.deltaY < 0 ? 1 : -1
  const step = Math.min(0.12, Math.max(0.04, Math.abs(input.deltaY || 0) / 1500))
  return clampGestureZoom(base + direction * step)
}

function broadcastSessionZoom(zoom) {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('browser:session-zoom-changed', zoom)
}

function sendBrowserContentPointerDown() {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('browser:content-pointer-down', { source: 'web-contents-view' })
}

function handleBeforeMouseEvent(event, input) {
  updateWebHotZoneBridge(input)
  if (input?.type === 'mouseDown') sendBrowserContentPointerDown()
  if (input?.type === 'mouseWheel' && injectingWheelCount > 0) return
  const activityKind = STEALTH_ACTIVITY_BY_MOUSE_TYPE[input?.type]
  if (activityKind) sendStealthBodyActivity(activityKind)
  if (input?.type !== 'mouseWheel') return

  if (shouldHandleWebInputGesture()) {
    const gesture = classifyWheelGesture(input)
    if (gesture.type === 'zoom') {
      if (!hasControlModifier(input)) return
      event.preventDefault()
      setSessionZoom(computeNextSessionZoomFromWheel(input))
      return
    }

    if (hasShiftModifier(input)) return

    const result = webSwipeRecognizer.push(input)
    if (result.consumed) {
      event.preventDefault()
      if (result.direction) handleWebHorizontalGesture(result.direction)
      return
    }
  }

  maybeScaleWheelEvent(event, input)
}

export function setStealthBodyActivityBridgeEnabled(enabled) {
  stealthBodyActivityBridgeEnabled = enabled === true
  return { ok: true, enabled: stealthBodyActivityBridgeEnabled }
}

function sendStealthBodyActivity(kind) {
  if (!stealthBodyActivityBridgeEnabled) return
  if (kind === 'mousemove') {
    const now = Date.now()
    if (now - lastStealthMouseMoveActivityAt < STEALTH_MOUSE_MOVE_ACTIVITY_THROTTLE_MS) return
    lastStealthMouseMoveActivityAt = now
  }
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('stealth:auto-hide-body-activity', { kind })
}

function handleBeforeInputEvent(_event, input) {
  if (input?.type === 'keyDown') sendStealthBodyActivity('keydown')
}

function getBoundMainWindow() {
  if (boundMainWindow && !boundMainWindow.isDestroyed?.()) return boundMainWindow
  const current = getMainWindow()
  if (current && !current.isDestroyed?.()) return current
  return null
}

function bindViewToMainWindow(mainWindow) {
  if (!view || !mainWindow || mainWindow.isDestroyed?.()) return
  if (boundMainWindow === mainWindow) {
    layout()
    return
  }
  const previousWindow = boundMainWindow
  if (previousWindow && !previousWindow.isDestroyed?.()) {
    if (resizeHandler) previousWindow.off?.('resize', resizeHandler)
    previousWindow.contentView?.removeChildView?.(view)
  }
  boundMainWindow = mainWindow
  lastNavStateJSON = ''
  mainWindow.contentView.addChildView(view)
  resizeHandler = () => {
    invalidateHotZoneGeometry()
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(layout, 30)
  }
  mainWindow.on('resize', resizeHandler)
  layout()
}

export function init(mainWindow) {
  if (view) {
    bindViewToMainWindow(mainWindow)
    return view
  }
  lastOpacity = getEffectiveOpacity({ isPdf: false }).interfaceOpacity
  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  view.setBackgroundColor('#00000000')
  setCurrentUrl('')
  applyWheelSpeed(getEffectiveCurrentWebPrefs().wheelSpeed)
  view.webContents.setUserAgent(resolveEffectiveUA(getEffectiveCurrentWebPrefs()))
  view.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = isAllowedProtocol(url)
    diagnosticLogger.info('web.window_open', { url, allowed }, 'main')
    if (!allowed) {
      sendPageMessage({ kind: 'external-blocked', url })
      return { action: 'deny' }
    }
    view.webContents.loadURL(url)
    return { action: 'deny' }
  })

  bindViewToMainWindow(mainWindow)

  const wc = view.webContents
  webSwipeRecognizer = createWheelGestureRecognizer()
  wc.on('before-mouse-event', handleBeforeMouseEvent)
  wc.on('before-input-event', handleBeforeInputEvent)
  const pushNavState = (sourceEvent = 'unknown') => {
    const targetWindow = getBoundMainWindow()
    if (!targetWindow) return
    const restoreWritable = sourceEvent === 'did-navigate' || sourceEvent === 'did-navigate-in-page'
    const next = {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(),
      canForward: wc.navigationHistory.canGoForward(),
      sourceEvent,
      restoreWritable
    }
    const json = JSON.stringify(next)
    if (json === lastNavStateJSON) return
    lastNavStateJSON = json
    targetWindow.webContents.send('browser:nav-state', next)
    diagnosticLogger.info(
      'web.nav_state',
      {
        sourceEvent,
        url: next.url,
        loading: next.loading,
        canBack: next.canBack,
        canForward: next.canForward
      },
      'main'
    )
  }
  const commitNavigationHistory = (finalUrl) => {
    if (!historyService || !finalUrl) return
    const title = wc.getTitle()
    const finalKey = canonicalizeWebUrl(finalUrl)
    if (!finalKey) return
    if (staleWebHistoryKeys.has(finalKey)) {
      staleWebHistoryKeys.delete(finalKey)
      return
    }
    if (pendingWebHistory) {
      const { pendingKey } = pendingWebHistory
      pendingWebHistory = null
      historyService.commitPendingWeb({ pendingKey, finalUrl, title })
      return
    }
    historyService.upsertWeb({ url: finalUrl, title })
  }
  wc.on('did-start-loading', () => {
    pageScopedCssFresh = false
    pushNavState('did-start-loading')
  })
  wc.on('did-stop-loading', () => pushNavState('did-stop-loading'))
  wc.on('did-navigate', (_event, finalUrl) => {
    const navigationSeq = ++mainFrameNavigationSeq
    setCurrentUrl(finalUrl)
    commitNavigationHistory(finalUrl)
    pageScopedCssFresh = true
    pushNavState('did-navigate')
    return reapplyAll({ resetCssKeys: true, navigationSeq })
  })
  wc.on('did-navigate-in-page', (_event, finalUrl, isMainFrame) => {
    if (isMainFrame) {
      setCurrentUrl(finalUrl)
      commitNavigationHistory(finalUrl)
      pushNavState('did-navigate-in-page')
      return
    }
    pushNavState('did-navigate-in-page-subframe')
  })
  wc.on('did-finish-load', () => pushNavState('did-finish-load'))
  wc.on('page-title-updated', (_event, nextTitle) => {
    historyService?.updateCurrentWebTitle({ url: wc.getURL(), title: nextTitle || wc.getTitle() })
    pushNavState('page-title-updated')
  })
  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    const failedKey = canonicalizeWebUrl(validatedURL)
    const suppressLoadMessage = Boolean(failedKey && silentLoadErrorKeys.delete(failedKey))
    if (suppressLoadMessage) {
      const timer = silentLoadErrorTimers.get(failedKey)
      if (timer) clearTimeout(timer)
      silentLoadErrorTimers.delete(failedKey)
    }
    if (errorCode !== -3 && !suppressLoadMessage) {
      sendPageMessage({
        kind: 'load-error',
        url: validatedURL,
        code: errorCode,
        description: errorDescription
      })
    }
    diagnosticLogger.warn(
      'web.fail_load',
      {
        url: validatedURL,
        code: errorCode,
        description: errorDescription,
        suppressed: suppressLoadMessage
      },
      'main'
    )
    if (pendingWebHistory?.requestedKey === canonicalizeWebUrl(validatedURL)) {
      pendingWebHistory = null
    }
    pushNavState('did-fail-load')
  })

  wc.on('context-menu', (e) => {
    e.preventDefault()
  })

  const blockNonHttp = (e, url) => {
    if (!isAllowedProtocol(url)) {
      e.preventDefault()
      sendPageMessage({ kind: 'external-blocked', url })
    }
  }
  wc.on('will-navigate', blockNonHttp)
  wc.on('will-redirect', blockNonHttp)

  view.webContents.on('did-finish-load', () => {
    const resetCssKeys = !pageScopedCssFresh
    pageScopedCssFresh = true
    return reapplyAll({ resetCssKeys })
  })

  attachCDPFallback(view)

  hide()
  return view
}

function ensureViewReady() {
  if (view) return true
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return false
  init(mainWindow)
  return Boolean(view)
}

export function show() {
  visibleIntent = true
  layout()
}
export function showIfReady() {
  visibleIntent = true
  if (sessionReady) {
    layout()
  } else {
    hideViewBounds()
  }
}
function hideViewBounds() {
  if (!view) return
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  resetWebHotZoneState()
}
export function hide() {
  pauseActiveMediaBeforeHide()
  visibleIntent = false
  cancelPendingOpen()
  view?.webContents?.stop?.()
  hideViewBounds()
}
export function goBack() {
  if (!view) return
  const h = view.webContents.navigationHistory
  if (h.canGoBack()) h.goBack()
}
export function goForward() {
  if (!view) return
  const h = view.webContents.navigationHistory
  if (h.canGoForward()) h.goForward()
}
export function reload() {
  if (!view) return
  view.webContents.reload()
}
export function openDevTools() {
  if (!view) return
  view.webContents.openDevTools({ mode: 'detach' })
}
export function clearHistory() {
  if (!view) return
  view.webContents.navigationHistory.clear()
}

export async function resetForMaintenance() {
  const result = { ok: true }
  openSiteSeq += 1
  cancelledOpenResults.clear()
  cancelPendingOpen({
    ok: false,
    reason: 'maintenance-reset',
    message: '维护操作已取消网页加载'
  })
  pendingWebHistory = null
  sessionReady = false
  sessionZoom = null
  chromeReserves.clear()
  setCurrentUrl('')
  stealthOpacityMultiplier = 1
  stealthBodyActivityBridgeEnabled = false
  resetPageScopedCssKeys()
  pageScopedCssFresh = false
  hide()
  clearHistory()
  try {
    await view?.webContents?.loadURL?.('about:blank')
  } catch (error) {
    result.ok = false
    result.reason = error?.message || 'blank-load-failed'
  }
  return result
}

export async function openSite(url, options = {}) {
  cancelPendingOpen()
  const requestSeq = ++openSiteSeq
  diagnosticLogger.info('web.open.request', { url, requestSeq }, 'main')
  if (!ensureViewReady()) {
    const result = { ok: false, reason: 'not-ready', message: '网页不可用' }
    logOpenResult(result, requestSeq)
    return result
  }
  const targetUrl = normalizeRecoverableWebUrl(url)
  if (!targetUrl) {
    const result = { ok: false, reason: 'invalid-url', message: '网页不可用' }
    logOpenResult(result, requestSeq)
    return result
  }
  webSwipeRecognizer.reset()
  const pendingKey = historyService?.createPendingWeb(targetUrl) || null
  const requestedKey = canonicalizeWebUrl(targetUrl)
  if (options?.silentPageMessages) addSilentLoadErrorKey(requestedKey)
  else clearSilentLoadErrorKey(requestedKey)
  if (pendingWebHistory?.requestedKey) staleWebHistoryKeys.add(pendingWebHistory.requestedKey)
  if (requestedKey) staleWebHistoryKeys.delete(requestedKey)
  pendingWebHistory = pendingKey && requestedKey ? { pendingKey, requestedKey } : null
  sessionReady = false
  layout()
  clearHistory()
  setCurrentUrl(targetUrl)
  try {
    applyPreNavigationWebPrefs()
    if (requestSeq !== openSiteSeq) {
      clearSilentLoadErrorKey(requestedKey)
      const result = consumeCancelledOpenResult(requestSeq) || staleOpenResult()
      logOpenResult(result, requestSeq)
      return result
    }

    const cancellationPromise = createPendingOpenCancellation(requestSeq)
    const loadOutcome = await Promise.race([
      view.webContents.loadURL(targetUrl).then(
        () => ({ type: 'loaded' }),
        (error) => ({ type: 'load-error', error })
      ),
      cancellationPromise
    ])
    if (loadOutcome.type === 'cancelled') {
      consumeCancelledOpenResult(requestSeq)
      if (options?.silentPageMessages) expireSilentLoadErrorKeySoon(requestedKey)
      else clearSilentLoadErrorKey(requestedKey)
      logOpenResult(loadOutcome.result, requestSeq)
      return loadOutcome.result
    }
    if (loadOutcome.type === 'load-error') throw loadOutcome.error
    if (requestSeq !== openSiteSeq) {
      clearSilentLoadErrorKey(requestedKey)
      const result = consumeCancelledOpenResult(requestSeq) || staleOpenResult()
      logOpenResult(result, requestSeq)
      return result
    }
    sessionReady = true
    layout()
    applyWheelSpeed(getEffectiveCurrentWebPrefs().wheelSpeed)
    const finalUrl = view.webContents.getURL() || targetUrl
    if (!finalUrl || finalUrl === 'about:blank') {
      clearSilentLoadErrorKey(requestedKey)
      const result = { ok: false, reason: 'load-error', message: '网页加载失败' }
      logOpenResult(result, requestSeq)
      return result
    }
    clearSilentLoadErrorKey(requestedKey)
    const result = { ok: true, url: finalUrl }
    logOpenResult(result, requestSeq)
    return result
  } catch (e) {
    if (requestSeq !== openSiteSeq) {
      expireSilentLoadErrorKeySoon(requestedKey)
      const result = consumeCancelledOpenResult(requestSeq) || staleOpenResult()
      logOpenResult(result, requestSeq)
      return result
    }
    if (e?.errno === -3) {
      sessionReady = true
      layout()
      if (options?.silentPageMessages) expireSilentLoadErrorKeySoon(requestedKey)
      else clearSilentLoadErrorKey(requestedKey)
      const result = { ok: false, reason: 'cancelled', message: '网页加载已取消' }
      logOpenResult(result, requestSeq)
      return result
    }
    sessionReady = true
    layout()
    expireSilentLoadErrorKeySoon(requestedKey)
    console.warn('[webviewManager] loadURL error:', e?.message)
    const result = { ok: false, reason: 'load-error', message: '网页加载失败' }
    logOpenResult(result, requestSeq)
    return result
  } finally {
    clearPendingOpenCancellation(requestSeq)
  }
}

export function requestChromeReserve(input = {}) {
  const ownerId = typeof input.ownerId === 'string' && input.ownerId ? input.ownerId : null
  if (!ownerId) return
  const size = Math.max(0, Number(input.size) | 0)
  if (size <= 0) {
    chromeReserves.delete(ownerId)
  } else {
    chromeReserves.set(ownerId, {
      ownerId,
      kind: typeof input.kind === 'string' && input.kind ? input.kind : 'reserved-area',
      edge: input.edge,
      size
    })
  }
  layout()
}

export function releaseChromeReserve(ownerId) {
  if (typeof ownerId === 'string' && ownerId) chromeReserves.delete(ownerId)
  layout()
}

export function requestPopoverZone(height) {
  requestChromeReserve({
    ownerId: 'browser.popover-zone',
    kind: 'popover',
    edge: 'bottom',
    size: height
  })
}

export function releasePopoverZone() {
  releaseChromeReserve('browser.popover-zone')
}

async function _applyStealthTransparentBackground(active) {
  if (!view) return null
  const wc = view.webContents
  if (active && !stealthTransparentBackgroundCssKey) {
    try {
      stealthTransparentBackgroundCssKey = await wc.insertCSS(STEALTH_TRANSPARENT_BACKGROUND_CSS, {
        cssOrigin: 'user'
      })
    } catch (e) {
      console.warn('[webviewManager] insert stealth transparent background CSS failed:', e?.message)
      return {
        ok: false,
        reason: 'insert-stealth-transparent-background-css-failed',
        message: e?.message || 'insert-stealth-transparent-background-css-failed'
      }
    }
  } else if (!active && stealthTransparentBackgroundCssKey) {
    const key = stealthTransparentBackgroundCssKey
    stealthTransparentBackgroundCssKey = null
    try {
      await wc.removeInsertedCSS(key)
    } catch {
      /* ignore stale key */
    }
  }
  return { ok: true }
}

async function _applyEffectiveContentOpacity({ reportStealthFailure = false } = {}) {
  const value = getEffectiveContentOpacity()
  const multiplier = normalizeOpacityValue(stealthOpacityMultiplier)
  if (!view) {
    return reportStealthFailure && multiplier < 0.999
      ? { ok: false, reason: 'no-webcontents-view', multiplier }
      : { ok: true, multiplier }
  }
  const wc = view.webContents
  const needsOpacityCss = value < 0.999
  const needsStealthTransparentBackground = multiplier < 0.001
  if (needsOpacityCss && opacityCssKey && opacityCssValue === value) {
    const stealthBackgroundResult = await _applyStealthTransparentBackground(
      needsStealthTransparentBackground
    )
    await _applyPlainView({ interfaceOpacity: value, contentOpacity: value })
    if (stealthBackgroundResult?.ok === false && reportStealthFailure) {
      return { ...stealthBackgroundResult, multiplier }
    }
    return { ok: true, multiplier }
  }
  if (opacityCssKey) {
    try {
      await wc.removeInsertedCSS(opacityCssKey)
    } catch {
      /* ignore stale key */
    }
    opacityCssKey = null
    opacityCssValue = null
  }
  let failure = null
  if (needsOpacityCss) {
    try {
      opacityCssKey = await wc.insertCSS(`html { opacity: ${value} !important; }`)
      opacityCssValue = value
    } catch (e) {
      opacityCssKey = null
      opacityCssValue = null
      failure = {
        ok: false,
        reason: 'insert-css-failed',
        message: e?.message || 'insert-css-failed',
        multiplier
      }
      console.warn('[webviewManager] insertCSS failed:', e?.message)
    }
  }
  const stealthBackgroundResult = await _applyStealthTransparentBackground(
    needsStealthTransparentBackground
  )
  await _applyPlainView({ interfaceOpacity: value, contentOpacity: value })
  if (failure && reportStealthFailure) return failure
  if (stealthBackgroundResult?.ok === false && reportStealthFailure) {
    return { ...stealthBackgroundResult, multiplier }
  }
  return { ok: true, multiplier }
}

async function _applyContentOpacity(value) {
  lastOpacity = normalizeOpacityValue(value)
  await _applyEffectiveContentOpacity()
}

export function applyContentOpacity(value) {
  pendingContentOpacity = normalizeOpacityValue(value)
  if (contentOpacityFlushQueued) return cssChain

  contentOpacityFlushQueued = true
  return queueCss(async () => {
    try {
      while (pendingContentOpacity != null) {
        const latestOpacity = pendingContentOpacity
        pendingContentOpacity = null
        await _applyContentOpacity(latestOpacity)
      }
    } finally {
      contentOpacityFlushQueued = false
    }
  })
}

export function applyStealthContentOpacityMultiplier(value) {
  return queueCss(async () => {
    stealthOpacityMultiplier = normalizeOpacityValue(value)
    return _applyEffectiveContentOpacity({ reportStealthFailure: true })
  })
}

export async function applyUA(prefs, { skipReload = false } = {}) {
  if (!view) return
  const wc = view.webContents
  const nextUA = resolveEffectiveUA(prefs)
  const currentUA = wc.getUserAgent()
  if (currentUA === nextUA) return
  wc.setUserAgent(nextUA)
  if (skipReload) return
  const contentMode = getRuntimeAppState().content
  if (shouldReloadForUA({ currentUA, nextUA, contentMode })) {
    wc.reload()
  }
}

export function applyZoom(zoom) {
  if (!view) return
  const wc = view.webContents
  if (wc.getZoomFactor() === zoom) return
  wc.setZoomFactor(zoom)
}

export function setSessionZoom(zoom) {
  const next = clampGestureZoom(zoom)
  sessionZoom = next
  applyZoom(next)
  broadcastSessionZoom(next)
  return next
}

function applyPreNavigationWebPrefs() {
  if (!view) return
  const prefs = getEffectiveCurrentWebPrefs()
  const wc = view.webContents
  const nextUA = resolveEffectiveUA(prefs)
  if (wc.getUserAgent() !== nextUA) wc.setUserAgent(nextUA)
  applyZoom(resolveRuntimeZoom(prefs))
}

async function _applyHideScrollbar(hideScrollbar) {
  if (!view) return
  const wc = view.webContents
  const wantHidden = Boolean(hideScrollbar)
  if (wantHidden && !hideScrollbarCssKey) {
    try {
      hideScrollbarCssKey = await wc.insertCSS(HIDE_SCROLLBAR_CSS)
    } catch (e) {
      console.warn('[webviewManager] insert scrollbar CSS failed:', e?.message)
    }
  } else if (!wantHidden && hideScrollbarCssKey) {
    const key = hideScrollbarCssKey
    hideScrollbarCssKey = null
    try {
      await wc.removeInsertedCSS(key)
    } catch {
      /* ignore */
    }
  }
}

export function applyHideScrollbar(hideScrollbar) {
  return queueCss(() => _applyHideScrollbar(hideScrollbar))
}

function logHideMediaApply(level, data) {
  diagnosticLogger[level]('web.media_apply_result', data, 'main')
}

async function _applyHideMedia(hideMedia) {
  const requestedHideMedia = Boolean(hideMedia)
  if (!view) {
    logHideMediaApply('info', {
      requestedHideMedia,
      action: 'noop',
      activeView: false,
      ok: true
    })
    return
  }
  const wc = view.webContents
  if (requestedHideMedia && !hideMediaCssKey) {
    try {
      hideMediaCssKey = await wc.insertCSS(HIDE_MEDIA_CSS)
      logHideMediaApply('info', {
        requestedHideMedia,
        action: 'insert-css',
        activeView: true,
        ok: true
      })
    } catch (e) {
      console.warn('[webviewManager] insert hideMedia CSS failed:', e?.message)
      logHideMediaApply('error', {
        requestedHideMedia,
        action: 'insert-css',
        activeView: true,
        ok: false,
        error: e
      })
    }
  } else if (!requestedHideMedia && hideMediaCssKey) {
    const key = hideMediaCssKey
    hideMediaCssKey = null
    try {
      await wc.removeInsertedCSS(key)
      logHideMediaApply('info', {
        requestedHideMedia,
        action: 'remove-css',
        activeView: true,
        ok: true
      })
    } catch (e) {
      logHideMediaApply('error', {
        requestedHideMedia,
        action: 'remove-css',
        activeView: true,
        ok: false,
        error: e
      })
    }
  } else {
    logHideMediaApply('info', {
      requestedHideMedia,
      action: 'noop',
      activeView: true,
      ok: true
    })
  }
}

export function applyHideMedia(hideMedia) {
  return queueCss(() => _applyHideMedia(hideMedia))
}

function shouldPauseActiveMedia({ requireActiveWebState = true } = {}) {
  if (!view || visibleIntent !== true || sessionReady !== true) return false
  if (!requireActiveWebState) return true
  const appState = getRuntimeAppState()
  return appState.content === 'web'
}

async function pauseActiveMedia({ requireActiveWebState = true } = {}) {
  if (!shouldPauseActiveMedia({ requireActiveWebState })) {
    return { ok: true, attempted: 0, paused: 0, skipped: true }
  }
  try {
    const raw = await view.webContents.executeJavaScript(PAUSE_ACTIVE_MEDIA_SCRIPT)
    const attempted = Math.max(0, Number(raw?.attempted) || 0)
    const paused = Math.max(0, Number(raw?.paused) || 0)
    const result = { ok: true, attempted, paused }
    await diagnosticLogger.info('stealth_auto_hide.media_pause', result, 'main')
    return result
  } catch (error) {
    const result = {
      ok: false,
      attempted: 0,
      paused: 0,
      reason: error?.message || 'media-pause-failed'
    }
    await diagnosticLogger.warn('stealth_auto_hide.media_pause', result, 'main')
    return result
  }
}

export function pauseActiveMediaForStealth() {
  return pauseActiveMedia({ requireActiveWebState: true })
}

function pauseActiveMediaBeforeHide() {
  if (!shouldPauseActiveMedia({ requireActiveWebState: false })) return
  void pauseActiveMedia({ requireActiveWebState: false })
}

async function _applyPlainView(overrides = {}) {
  if (!view) return
  const wc = view.webContents
  const prefs = store.get('webPrefs')
  const effective = getEffectiveOpacity()
  const shellBackgroundHidden =
    overrides.shellBackgroundHidden ?? effective.shellBackgroundHidden ?? false
  const interfaceOpacity =
    overrides.interfaceOpacity ??
    overrides.contentOpacity ??
    effective.interfaceOpacity ??
    lastOpacity
  const plainView = overrides.plainView ?? prefs.plainView
  const inject = shouldInjectPlainView({
    windowOpacity: 1,
    shellBackgroundHidden,
    interfaceOpacity,
    contentOpacity: interfaceOpacity,
    plainView
  })
  if (inject && !plainViewCssKey) {
    try {
      plainViewCssKey = await wc.insertCSS(PLAIN_VIEW_CSS, { cssOrigin: 'user' })
    } catch (e) {
      console.warn('[webviewManager] insert plainView CSS failed:', e?.message)
    }
  } else if (!inject && plainViewCssKey) {
    const key = plainViewCssKey
    plainViewCssKey = null
    try {
      await wc.removeInsertedCSS(key)
    } catch {
      /* ignore */
    }
  }
}

export function applyPlainView(overrides = {}) {
  return queueCss(() => _applyPlainView(overrides))
}

function resolveRuntimeZoom(prefs) {
  return sessionZoom ?? prefs.zoom
}

async function _applyWebPrefs(
  prefs,
  { skipReload = false, reloadForPlainViewDisable = false } = {}
) {
  await applyUA(prefs, { skipReload })
  applyZoom(resolveRuntimeZoom(prefs))
  if (reloadForPlainViewDisable && prefs?.plainView === false) {
    resetPageScopedCssKeys()
    pageScopedCssFresh = false
    view?.webContents?.reload()
    return
  }
  await _applyHideScrollbar(prefs.hideScrollbar)
  await _applyHideMedia(prefs.hideMedia)
  await _applyPlainView({ plainView: prefs.plainView })
}

export function applyWebPrefs(prefs, options = {}) {
  applyWheelSpeed(prefs?.wheelSpeed)
  return queueCss(() => _applyWebPrefs(prefs, options))
}

export function applyCurrentWebPrefs(options = {}) {
  return applyWebPrefs(getEffectiveCurrentWebPrefs(), options)
}

export async function setCurrentSiteWebPrefs(patch) {
  if (!currentOrigin) return { ok: false, reason: 'unsupported-origin' }
  const next = upsertSiteWebPrefs({
    current: store.get('siteWebPrefs') || {},
    origin: currentOrigin,
    patch,
    baseEffectivePrefs: getEffectiveCurrentWebPrefs()
  })
  store.set('siteWebPrefs', next)
  await applyCurrentWebPrefs()
  return { ok: true, ...getCurrentSiteWebPrefs() }
}

export async function clearCurrentSiteWebPrefs() {
  if (!currentOrigin) return { ok: false, reason: 'unsupported-origin' }
  const next = clearSiteWebPrefs(store.get('siteWebPrefs') || {}, currentOrigin)
  store.set('siteWebPrefs', next)
  await applyCurrentWebPrefs()
  return { ok: true, ...getCurrentSiteWebPrefs() }
}

function reapplyAll({ resetCssKeys = false, navigationSeq = null } = {}) {
  return queueCss(async () => {
    if (navigationSeq !== null && navigationSeq !== mainFrameNavigationSeq) return
    const prefs = getEffectiveCurrentWebPrefs()
    if (resetCssKeys) resetPageScopedCssKeys()
    applyWheelSpeed(prefs.wheelSpeed)
    await applyUA(prefs, { skipReload: true })
    applyZoom(resolveRuntimeZoom(prefs))
    await _applyHideScrollbar(prefs.hideScrollbar)
    await _applyHideMedia(prefs.hideMedia)
    await _applyEffectiveContentOpacity()
    await _applyPlainView()
  })
}

function createWebContentsLayout(bounds) {
  const appState = getRuntimeAppState()
  const reserves = Array.from(chromeReserves.values())
  const platformPolicy = getRuntimePlatformPolicy()
  return createChromeLayout({
    windowSize: bounds,
    form: appState.form,
    content: appState.content,
    fileKind: appState.fileKind,
    platformPolicy,
    topChrome: { visible: false, interactive: false },
    bottomChrome: { visible: false, interactive: false },
    reserves
  })
}

function layout() {
  const mainWindow = getBoundMainWindow()
  if (!view || !mainWindow) return
  if (!visibleIntent || !sessionReady) {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    invalidateHotZoneGeometry()
    return
  }
  const bounds = mainWindow.getContentBounds()
  const layoutState = createWebContentsLayout(bounds)
  view.setBounds(layoutState.webContentsRect)
  hotZoneGeometry = {
    contentY: layoutState.webContentsRect.y,
    windowHeight: bounds.height
  }
}
