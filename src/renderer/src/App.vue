<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useTheme } from './composables/useTheme.js'
import { useTransparency } from './composables/useTransparency.js'
import { provideAppState } from './composables/useAppState.js'
import { useAppStateEffects } from './composables/appStateEffects.js'
import { provideTxt } from './composables/useTxt.js'
import { provideTxtReaderController } from './composables/useTxtReaderController.js'
import { provideTxtSearch } from './composables/useTxtSearch.js'
import { createEpub, provideEpub } from './composables/useEpub.js'
import {
  createEpubReaderController,
  provideEpubCtrl
} from './composables/useEpubReaderController.js'
import { provideEpubSearch } from './composables/useEpubSearch.js'
import { createPdf, providePdf } from './composables/usePdf.js'
import { useAutoTurn } from './composables/useAutoTurn.js'
import { useReaderPrefs } from './composables/useReaderPrefs.js'
import { pushStatus } from './composables/usePageMessages.js'
import { createDragRoute, resolveDropDecision } from './composables/useDragRoute.js'
import { openDroppedFile } from './composables/dropOpenFlow.js'
import { activeReaderFlush } from './composables/useActiveReaderFlush.js'
import { useChromeVisibility } from './composables/useChromeVisibility.js'
import { useStealthAutoHide } from './composables/useStealthAutoHide.js'
import { useStealthWindowLeaveWatcher } from './composables/useStealthWindowLeaveWatcher.js'
import { provideChromeLockRegistry } from './composables/useChromeLockRegistry.js'
import {
  createAutoTurnChromePauseController,
  shouldPauseAutoTurnForChromeLocks
} from './composables/useAutoTurnChromePause.js'
import { resolveEffectiveOpacity } from '../../shared/transparencyPrefs.js'
import {
  CHROME_HOT_ZONE_HEIGHT,
  CHROME_MINI_DRAG_RAIL_WIDTH
} from '../../shared/chromeLayoutModel.js'
import {
  createTrackpadGestureService,
  provideTrackpadGesture
} from './composables/useTrackpadGesture.js'
import {
  createFileOpenCoordinator,
  provideFileOpenCoordinator
} from './composables/useFileOpenCoordinator.js'
import { createStartupRestore } from './composables/useStartupRestore.js'
import { logDiagnostic } from './composables/useDiagnosticLog.js'
import { createMaintenanceResetHandler } from './composables/useMaintenanceReset.js'
import TopBar from './components/TopBar.vue'
import BottomBar from './components/BottomBar.vue'
import ContentArea from './components/ContentArea.vue'
import ReaderPanelHost from './components/ReaderPanelHost.vue'

const appStateApi = provideAppState()
useAppStateEffects(appStateApi)
const theme = useTheme()
const isDarkTheme = computed(() => theme?.isDark?.value ?? false)
const { prefs: transparencyPrefs } = useTransparency()
const txt = provideTxt()
const ctrl = provideTxtReaderController()
const txtSearch = provideTxtSearch({ txt, ctrl, pushStatus })
const epub = provideEpub(createEpub())
const epubCtrl = createEpubReaderController()
provideEpubCtrl(epubCtrl)
const epubSearch = provideEpubSearch({ epub, ctrl: epubCtrl })
const pdf = providePdf(createPdf())
const { txtPrefs } = useReaderPrefs()
const browser = {
  async openSite(url, opts = {}) {
    const result =
      opts.silent === true
        ? await window.api.browserOpen(url, { silentPageMessages: true })
        : await window.api.browserOpen(url)
    return result || { ok: false, reason: 'load-error', message: '网页加载失败' }
  }
}
const dragRoute = createDragRoute()
const windowSize = reactive({ width: window.innerWidth, height: window.innerHeight })
const pointer = reactive({ inside: true, x: window.innerWidth / 2, y: window.innerHeight / 2 })
const webHotZones = reactive({ top: false, bottom: false })
const chromeLocks = provideChromeLockRegistry()
const topLocked = computed(() => chromeLocks.hasTopLock.value)
const bottomLocked = computed(() => chromeLocks.hasBottomLock.value)
const focused = ref(document.hasFocus())
let windowFocusGeneration = 0
let lastInputModality = null
const stealthAutoHide = useStealthAutoHide({
  appState: appStateApi.state,
  transparencyPrefs,
  activeLocks: chromeLocks.activeLocks,
  dragActive: dragRoute.dragActive,
  dragOverlayVisible: dragRoute.overlayVisible,
  focused,
  api: window.api,
  pushStatus,
  logDiagnostic
})
const stealthWindowLeaveArmed = computed(
  () =>
    stealthAutoHide.canWindowLeaveHideBodyIgnoringFocus.value &&
    appStateApi.state.hidden !== true &&
    stealthAutoHide.bodyHidden.value === false
)
const stealthWindowReentryArmed = computed(
  () =>
    appStateApi.state.hidden !== true &&
    stealthAutoHide.bodyHidden.value === true &&
    stealthAutoHide.bodyAutoHideEnabled.value === true
)
const stealthRevealRegion = computed(() =>
  stealthAutoHide.bodyFollowPointerEnabled.value ? 'window' : 'edges'
)
const stealthWindowLeaveReadingTargetKey = computed(
  () =>
    `${appStateApi.state.content || 'none'}:${appStateApi.state.fileKind || 'none'}:${appStateApi.state.form || 'none'}`
)
const stealthWindowLeaveWatcher = useStealthWindowLeaveWatcher({
  api: window.api,
  armed: stealthWindowLeaveArmed,
  revealArmed: stealthWindowReentryArmed,
  revealRegion: stealthRevealRegion,
  readingTargetKey: stealthWindowLeaveReadingTargetKey,
  canHideIgnoringFocus: stealthAutoHide.canWindowLeaveHideBodyIgnoringFocus,
  requestBodyHideForWindowLeave: stealthAutoHide.requestBodyHideForWindowLeave,
  requestBodyReveal: stealthAutoHide.restoreStealthInteraction
})
const txtAutoTurnShouldPause = computed(
  () =>
    appStateApi.state.content === 'file' &&
    appStateApi.state.fileKind === 'txt' &&
    appStateApi.state.form === 'normal' &&
    shouldPauseAutoTurnForChromeLocks(chromeLocks.bottomLocks.value)
)
const isMiniForm = computed(() => appStateApi.state.form === 'mini')
const isMiniEligibleFileKind = computed(
  () => appStateApi.state.fileKind === 'txt' || appStateApi.state.fileKind === 'epub'
)
const isMiniFileForm = computed(
  () => isMiniForm.value && appStateApi.state.content === 'file' && isMiniEligibleFileKind.value
)
const usesFloatingChromeLayout = computed(() => isMiniFileForm.value)
const toolbarAutoHideGateActive = computed(() => transparencyPrefs.value?.windowEnabled === true)
const effectiveToolbarAutoHideEnabled = computed(
  () => toolbarAutoHideGateActive.value && stealthAutoHide.toolbarAutoHideEnabled.value
)
const chrome = useChromeVisibility({
  appState: appStateApi.state,
  windowSize,
  pointer,
  webHotZones,
  topLocked,
  bottomLocked,
  toolbarAutoHideEnabled: effectiveToolbarAutoHideEnabled
})
const bottomBarVisible = computed(
  () =>
    chrome.bottomVisible.value &&
    !(stealthAutoHide.bodyHidden.value && stealthAutoHide.bodyFollowPointerEnabled.value === true)
)
const usesChromeZones = computed(
  () =>
    chrome.stealthEnabled.value &&
    (appStateApi.state.content === 'web' || usesFloatingChromeLayout.value)
)
const MAIN_SURFACE_BODY_CLASS = 'goof-off-main-window-surface'
const MAIN_SHELL_BACKGROUND_HIDDEN_BODY_CLASS = 'goof-off-main-shell-background-hidden'
const CHROME_FOCUS_LOCK_IDS = new Set(['top.focus-within', 'bottom.focus-within'])

function isClickThroughPassthroughActive() {
  return (
    stealthAutoHide.bodyHidden.value &&
    stealthAutoHide.bodyMode.value === 'click-through' &&
    stealthAutoHide.mousePassthroughActive.value
  )
}

// renderer 转发事件作为 main 全局光标采样的低延迟兜底。默认模式只在
// 顶部/底部 44px 回显；跟随模式允许窗口内任意位置立即唤回主体。
function shouldNotifyBodyMousemove(e) {
  const clickThroughPassthrough = isClickThroughPassthroughActive()
  if (!clickThroughPassthrough) return true
  if (stealthAutoHide.bodyFollowPointerEnabled.value) return true
  return (
    (e.clientY >= 0 && e.clientY < CHROME_HOT_ZONE_HEIGHT) ||
    e.clientY >= windowSize.height - CHROME_HOT_ZONE_HEIGHT
  )
}

function onWindowMousemove(e) {
  pointer.inside = true
  pointer.x = e.clientX
  pointer.y = e.clientY
  if (shouldNotifyBodyMousemove(e)) stealthAutoHide.notifyActivity('mousemove')
}

function clearWindowLeavePointerState() {
  pointer.inside = false
  webHotZones.top = false
  webHotZones.bottom = false
  dragRoute.cancel()
}

function releasePointerChromeFocusLocks(reason = 'window-pointer-leave') {
  if (lastInputModality !== 'pointer') return

  const activeLocks = chromeLocks.activeLocks.value
  const releasableFocusLockIds = new Set(
    activeLocks
      .filter((lock) => CHROME_FOCUS_LOCK_IDS.has(lock.ownerId))
      .filter(
        (focusLock) =>
          !activeLocks.some(
            (lock) =>
              !CHROME_FOCUS_LOCK_IDS.has(lock.ownerId) &&
              (lock.scope === focusLock.scope || lock.scope === 'global')
          )
      )
      .map((lock) => lock.ownerId)
  )
  if (releasableFocusLockIds.size === 0) return

  const activeElement = document.activeElement
  const activeScope = activeElement?.closest?.('.top-bar')
    ? 'top'
    : activeElement?.closest?.('.bottom-bar')
      ? 'bottom'
      : null

  if (activeScope && releasableFocusLockIds.has(`${activeScope}.focus-within`)) {
    activeElement.blur?.()
  }
  chromeLocks.clearLocksWhere((lock) => releasableFocusLockIds.has(lock.ownerId), reason)
}

function onWindowMouseleave() {
  clearWindowLeavePointerState()
  releasePointerChromeFocusLocks()
  void stealthWindowLeaveWatcher.handleDomAuxiliaryCandidate()
}

function onDocumentMouseout(e) {
  if (e.relatedTarget) return
  clearWindowLeavePointerState()
}

function onResize() {
  windowSize.width = window.innerWidth
  windowSize.height = window.innerHeight
}

function syncMainWindowSurfaceBodyClasses(hidden) {
  document.body.classList.add(MAIN_SURFACE_BODY_CLASS)
  document.body.classList.toggle(MAIN_SHELL_BACKGROUND_HIDDEN_BODY_CLASS, hidden)
}

watch(
  () => ({
    content: appStateApi.state.content,
    fileKind: appStateApi.state.fileKind,
    form: appStateApi.state.form
  }),
  ({ content, fileKind, form }) => {
    const domHotZonesAllowed =
      content === 'web' || (content === 'file' && form === 'mini' && isMiniEligibleFileKind.value)
    chromeLocks.clearStaleLocks({ content, fileKind, form }, 'app-state-change')
    if (!domHotZonesAllowed) {
      webHotZones.top = false
      webHotZones.bottom = false
    }
  }
)

watch(
  () => [appStateApi.state.content, appStateApi.state.fileKind],
  ([content, fileKind]) => {
    if (!(content === 'file' && fileKind === 'txt')) {
      ctrl.closeSearch?.()
      txtSearch.reset({ clearWorkerText: true })
    }
    if (!(content === 'file' && fileKind === 'epub')) {
      epubCtrl.closeSearch?.()
      epubSearch.reset({ clearLastQuery: true })
    }
  }
)

function flushActiveReader() {
  if (appStateApi.state.content !== 'file') return
  return activeReaderFlush.value?.()
}

const effectiveTransparency = computed(() => resolveEffectiveOpacity(transparencyPrefs.value))
watch(
  () => effectiveTransparency.value.shellBackgroundHidden === true,
  (hidden) => {
    syncMainWindowSurfaceBodyClasses(hidden)
  },
  { immediate: true }
)
const interfaceOpacity = computed(() => effectiveTransparency.value.interfaceOpacity)
const chromeGeometryStyle = computed(() => ({
  '--interface-opacity': interfaceOpacity.value,
  '--chrome-hot-zone-h': `${CHROME_HOT_ZONE_HEIGHT}px`,
  '--mini-drag-rail-w': `${CHROME_MINI_DRAG_RAIL_WIDTH}px`,
  '--stealth-file-body-opacity-multiplier': stealthAutoHide.bodyOpacityMultiplier.value
}))

const autoTurnSec = ref(30)
watch(
  () => txtPrefs.value.autoTurnSec,
  (value) => {
    autoTurnSec.value = value || 30
  },
  { immediate: true }
)
const {
  running: autoTurnRunning,
  paused: autoTurnPaused,
  countdown: autoTurnCountdown,
  toggle: toggleAutoTurn,
  stop: stopAutoTurn,
  pause: pauseAutoTurn,
  resume: resumeAutoTurn
} = useAutoTurn({
  intervalSec: autoTurnSec,
  onTick: () => {
    const advanced = ctrl.nextPage()
    if (!advanced) pushStatus('已读完')
    return advanced
  }
})

const txtAutoTurnChromePause = createAutoTurnChromePauseController({
  running: autoTurnRunning,
  paused: autoTurnPaused,
  pause: pauseAutoTurn,
  resume: resumeAutoTurn
})

watch(autoTurnRunning, (v) => {
  ctrl.autoTurnRunning.value = v
})
watch(autoTurnPaused, (v) => {
  ctrl.autoTurnPaused.value = v
})
watch(autoTurnCountdown, (v) => {
  ctrl.autoTurnCountdown.value = v
})
watch(
  () => [txtAutoTurnShouldPause.value, autoTurnRunning.value],
  ([shouldPause]) => {
    txtAutoTurnChromePause.sync(shouldPause)
  },
  { immediate: true }
)

const fileOpenCoordinator = provideFileOpenCoordinator(
  createFileOpenCoordinator({
    api: window.api,
    browser,
    appState: appStateApi,
    txt,
    epub,
    pdf,
    flushActiveReader,
    stopAutoTurn,
    pushStatus
  })
)

const handleMaintenanceReset = createMaintenanceResetHandler({
  api: window.api,
  appState: appStateApi,
  fileCoordinator: fileOpenCoordinator,
  txt,
  txtSearch,
  epub,
  epubCtrl,
  epubSearch,
  pdf,
  stopAutoTurn,
  restoreStealthInteraction: stealthAutoHide.restoreStealthInteraction,
  resetStealthAutoHideRuntime: stealthAutoHide.resetRuntime
})
let unlistenMaintenanceReset = null

const startupRestore = createStartupRestore({
  api: window.api,
  fileCoordinator: fileOpenCoordinator,
  appState: appStateApi,
  pushStatus
})

const trackpadGesture = provideTrackpadGesture(
  createTrackpadGestureService({
    appState: appStateApi.state,
    dispatch: appStateApi.dispatch,
    txtCtrl: ctrl,
    epubCtrl
  })
)

function onWindowWheel(e) {
  stealthAutoHide.notifyActivity('wheel')
  trackpadGesture.handleWheel(e, 'window')
}

function onWindowPointerdown() {
  lastInputModality = 'pointer'
  stealthAutoHide.notifyActivity('pointerdown')
}

function onStealthBodyActivity(payload) {
  if (isClickThroughPassthroughActive()) return
  const kind = payload?.kind || 'activity'
  stealthAutoHide.notifyActivity(`webcontents-${kind}`)
}

function onBrowserWebHotZoneState(payload) {
  if (appStateApi.state.content !== 'web' || appStateApi.state.form !== 'normal') {
    webHotZones.top = false
    webHotZones.bottom = false
    return
  }
  webHotZones.top = payload?.top === true
  webHotZones.bottom = payload?.bottom === true
}

async function onBrowserContentPointerDown() {
  lastInputModality = 'pointer'
  const closed = chromeLocks.handleOutsidePointer({
    reason: 'browser-content-pointer',
    restoreFocus: false
  })
  if (closed) await nextTick()
  releasePointerChromeFocusLocks('browser-content-pointer')
}

function onDocumentKeydown(e) {
  lastInputModality = 'keyboard'
  stealthAutoHide.notifyActivity('keydown')
  if (e.key !== 'Escape') return
  if (!chromeLocks.handleEscape()) return
  e.preventDefault()
  e.stopPropagation()
}

async function closeChromeSurfaceForFocusLoss(reason) {
  const closed = chromeLocks.handleOutsidePointer({
    reason,
    restoreFocus: false
  })
  const clearedFocusLocks = chromeLocks.clearLocksWhere(
    (lock) => CHROME_FOCUS_LOCK_IDS.has(lock.ownerId),
    reason
  )
  if (closed || clearedFocusLocks.removedCount > 0) await nextTick()
  return closed || clearedFocusLocks.removedCount > 0
}

async function isPopoverChildFocusedForBlur() {
  try {
    return (await window.api?.popoverIsChildFocused?.()) === true
  } catch {
    return false
  }
}

function isStaleWindowBlur(reason, focusGeneration) {
  return reason === 'window-blur' && focusGeneration !== windowFocusGeneration
}

async function handleWindowFocusLoss(
  reason = 'window-blur',
  focusGeneration = windowFocusGeneration
) {
  const childPopoverFocused =
    reason === 'window-blur' ? await isPopoverChildFocusedForBlur() : false
  if (isStaleWindowBlur(reason, focusGeneration)) return
  if (childPopoverFocused) {
    stealthAutoHide.notifyActivity('popover-child-focus')
    return
  }
  focused.value = false
  await closeChromeSurfaceForFocusLoss(reason)
  if (isStaleWindowBlur(reason, focusGeneration)) return
  void stealthWindowLeaveWatcher.handleFocusLoss()
  if (reason === 'window-blur') stealthAutoHide.handleWindowBlur()
  else stealthAutoHide.notifyActivity(reason)
  clearWindowLeavePointerState()
}

function onWindowBlur() {
  windowFocusGeneration += 1
  void handleWindowFocusLoss('window-blur', windowFocusGeneration)
}

function onPopoverChildClose(payload) {
  if (payload?.reason !== 'focus-lost') return
  if (document.hasFocus?.() === true) return
  if (!focused.value) return
  void handleWindowFocusLoss('popover-child-focus-lost')
}

function onWindowFocus() {
  windowFocusGeneration += 1
  focused.value = true
  stealthAutoHide.notifyActivity('window-focus')
}

function onDocumentVisibilityChange() {
  const visible = document.visibilityState !== 'hidden'
  if (!visible) {
    void handleWindowFocusLoss('visibilitychange')
    return
  }
  focused.value = document.hasFocus?.() ?? true
  stealthAutoHide.notifyActivity('visibilitychange')
}

async function onDrop(e) {
  e.preventDefault()
  e.stopPropagation()
  const armed = dragRoute.handleDrop()
  if (!armed) return

  const decision = resolveDropDecision(e.dataTransfer)
  logDiagnostic('drag.drop_decision', {
    ok: decision.ok,
    kind: decision.kind,
    message: decision.ok ? undefined : decision.message
  })
  if (!decision.ok) {
    pushStatus(decision.message)
    return
  }

  await fileOpenCoordinator.openDroppedDecision(decision, openDroppedFile)
}

function onDragover(e) {
  stealthAutoHide.notifyActivity('dragover')
  dragRoute.handleDragOver(e)
}

function handleDocDragenter(e) {
  stealthAutoHide.notifyActivity('dragenter')
  dragRoute.handleDragEnter(e)
}

function handleDocDragleave(e) {
  dragRoute.handleDragLeave(e)
}

function handleDocDrop(e) {
  e.preventDefault()
  dragRoute.cancel()
}

function onToggleAutoTurnEvent() {
  toggleAutoTurn()
  logDiagnostic('reader.auto_turn_toggle', {
    running: autoTurnRunning.value
  })
}

const webContentsBodyActivityBridgeEnabled = computed(
  () =>
    appStateApi.state.content === 'web' &&
    appStateApi.state.form === 'normal' &&
    stealthAutoHide.bodyAutoHideAvailable.value &&
    stealthAutoHide.bodyAutoHideEnabled.value &&
    !isClickThroughPassthroughActive()
)

function syncStealthBodyActivityBridge(enabled) {
  void window.api.browserSetStealthBodyActivityBridgeEnabled?.({ enabled })
}

let unsubscribeStealthBodyVisibilityRestore = null
let unsubscribeStealthBodyActivity = null
let unsubscribeBrowserWebHotZoneState = null
let unsubscribeBrowserContentPointerDown = null
let unsubscribeStealthWindowLeft = null
let unsubscribeStealthWindowReentered = null
let unsubscribeBossHidden = null
let unsubscribeBossRestored = null
let unsubscribePopoverChildClose = null
let stopStealthBodyActivityBridgeWatch = null

onMounted(() => {
  unlistenMaintenanceReset = window.api.onMaintenanceResetRequested?.((payload) => {
    return handleMaintenanceReset(payload)
  })
  window.api.onFileOpenRequest(() => {
    logDiagnostic('file.menu_open_request', { kind: 'txt' })
    fileOpenCoordinator.openFileFromDialog('txt', window.api.openTxtDialog)
  })
  window.api.onEpubOpenRequest(() => {
    logDiagnostic('file.menu_open_request', { kind: 'epub' })
    fileOpenCoordinator.openFileFromDialog('epub', window.api.openEpubDialog)
  })
  window.api.onPdfOpenRequest(() => {
    logDiagnostic('file.menu_open_request', { kind: 'pdf' })
    fileOpenCoordinator.openFileFromDialog('pdf', window.api.openPdfDialog)
  })
  window.addEventListener('txt:toggle-auto-turn', onToggleAutoTurnEvent)
  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('wheel', onWindowWheel, { passive: false })
  window.addEventListener('pointerdown', onWindowPointerdown)
  document.addEventListener('keydown', onDocumentKeydown, true)
  document.addEventListener('mouseout', onDocumentMouseout)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onDocumentVisibilityChange)
  document.addEventListener('dragenter', handleDocDragenter)
  document.addEventListener('dragleave', handleDocDragleave)
  document.addEventListener('drop', handleDocDrop)
  unsubscribeStealthBodyVisibilityRestore = window.api.onStealthBodyVisibilityRestore?.(
    (payload) => {
      return stealthAutoHide.restoreStealthInteraction(payload?.reason || 'external-restore')
    }
  )
  unsubscribeStealthBodyActivity = window.api.onStealthBodyActivity?.((payload) => {
    onStealthBodyActivity(payload)
  })
  unsubscribeBrowserWebHotZoneState = window.api.onBrowserWebHotZoneState?.((payload) => {
    onBrowserWebHotZoneState(payload)
  })
  unsubscribeBrowserContentPointerDown = window.api.onBrowserContentPointerDown?.(() => {
    void onBrowserContentPointerDown()
  })
  unsubscribeStealthWindowLeft = window.api.onStealthWindowLeft?.((payload) => {
    void stealthWindowLeaveWatcher.handleWindowLeftCandidate(payload)
  })
  unsubscribeStealthWindowReentered = window.api.onStealthWindowReentered?.((payload) => {
    void stealthWindowLeaveWatcher.handleWindowReentered(payload)
  })
  unsubscribeBossHidden = window.api.onBossHidden?.(() => {
    void stealthWindowLeaveWatcher.disable({ force: true })
    void stealthAutoHide.restoreStealthInteraction('boss-hidden')
  })
  unsubscribeBossRestored = window.api.onBossRestored?.(() => {
    void stealthAutoHide.restoreStealthInteraction('boss-restored')
  })
  unsubscribePopoverChildClose = window.api.onPopoverChildClose?.((payload) => {
    onPopoverChildClose(payload)
  })
  stopStealthBodyActivityBridgeWatch = watch(
    webContentsBodyActivityBridgeEnabled,
    (enabled) => {
      syncStealthBodyActivityBridge(enabled)
    },
    { immediate: true }
  )
  startupRestore.runOnce().catch((e) => {
    console.warn('[App] startup restore failed:', e)
  })
})

onUnmounted(() => {
  unlistenMaintenanceReset?.()
  txtSearch.dispose()
  epubSearch.dispose()
  window.removeEventListener('txt:toggle-auto-turn', onToggleAutoTurnEvent)
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('wheel', onWindowWheel)
  window.removeEventListener('pointerdown', onWindowPointerdown)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  document.removeEventListener('mouseout', onDocumentMouseout)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
  document.removeEventListener('dragenter', handleDocDragenter)
  document.removeEventListener('dragleave', handleDocDragleave)
  document.removeEventListener('drop', handleDocDrop)
  unsubscribeStealthBodyVisibilityRestore?.()
  unsubscribeStealthBodyVisibilityRestore = null
  unsubscribeStealthBodyActivity?.()
  unsubscribeStealthBodyActivity = null
  unsubscribeBrowserWebHotZoneState?.()
  unsubscribeBrowserWebHotZoneState = null
  unsubscribeBrowserContentPointerDown?.()
  unsubscribeBrowserContentPointerDown = null
  unsubscribeStealthWindowLeft?.()
  unsubscribeStealthWindowLeft = null
  unsubscribeStealthWindowReentered?.()
  unsubscribeStealthWindowReentered = null
  unsubscribeBossHidden?.()
  unsubscribeBossHidden = null
  unsubscribeBossRestored?.()
  unsubscribeBossRestored = null
  unsubscribePopoverChildClose?.()
  unsubscribePopoverChildClose = null
  stopStealthBodyActivityBridgeWatch?.()
  stopStealthBodyActivityBridgeWatch = null
  syncStealthBodyActivityBridge(false)
  void stealthAutoHide.restoreStealthInteraction('component-unmount').finally(() => {
    stealthAutoHide.resetRuntime('component-unmount')
  })
  stealthWindowLeaveWatcher.dispose()
  document.body.classList.remove(MAIN_SURFACE_BODY_CLASS)
  document.body.classList.remove(MAIN_SHELL_BACKGROUND_HIDDEN_BODY_CLASS)
})

defineExpose({ chromeLocks, stealthAutoHide, stealthWindowLeaveWatcher })
</script>

<template>
  <div
    class="app-container"
    :class="{
      'is-stealth': chrome.stealthEnabled.value,
      'is-floating-chrome-layout': usesFloatingChromeLayout,
      'is-mini-form': isMiniForm,
      'is-mini-file-form': isMiniFileForm,
      'is-body-hidden': stealthAutoHide.bodyHidden.value,
      'is-shell-background-hidden': effectiveTransparency.shellBackgroundHidden
    }"
    :style="chromeGeometryStyle"
    @drop="onDrop"
    @dragover="onDragover"
    @mouseleave="onWindowMouseleave"
  >
    <div class="chrome-drag-band" aria-hidden="true"></div>
    <div
      v-if="usesChromeZones"
      class="top-chrome-zone"
      @mouseenter="webHotZones.top = true"
      @mouseleave="webHotZones.top = false"
    ></div>
    <TopBar
      :visible="chrome.topVisible.value"
      :interactive="chrome.topInteractive.value"
      :solid="chrome.topSolid.value"
      :toolbar-auto-hide-enabled="stealthAutoHide.toolbarAutoHideEnabled.value"
      :body-auto-hide-enabled="stealthAutoHide.bodyAutoHideEnabled.value"
      :body-follow-pointer-enabled="stealthAutoHide.bodyFollowPointerEnabled.value"
      :body-auto-hide-available="stealthAutoHide.bodyAutoHideAvailable.value"
      :body-auto-hide-disabled-title="stealthAutoHide.bodyAutoHideDisabledTitle.value"
      :toolbar-auto-hide-locked="stealthAutoHide.toolbarAutoHideLocked.value"
      :auto-hide-gate-active="toolbarAutoHideGateActive"
      :auto-hide-controls-visible="stealthAutoHide.controlsVisible.value"
      :body-hidden="stealthAutoHide.bodyHidden.value"
      @toggle-toolbar-auto-hide="stealthAutoHide.setToolbarAutoHideEnabled"
      @toggle-body-auto-hide="stealthAutoHide.setBodyAutoHideEnabled"
      @toggle-body-follow-pointer="stealthAutoHide.setBodyFollowPointerEnabled"
      @mouseenter="usesChromeZones && (webHotZones.top = true)"
      @mouseleave="usesChromeZones && (webHotZones.top = false)"
    />
    <ContentArea :opacity="interfaceOpacity" :stealth-overlay="usesFloatingChromeLayout" />
    <ReaderPanelHost />
    <div
      v-if="usesChromeZones"
      class="bottom-chrome-zone"
      @mouseenter="webHotZones.bottom = true"
      @mouseleave="webHotZones.bottom = false"
    ></div>
    <BottomBar
      :visible="bottomBarVisible"
      :interactive="chrome.bottomInteractive.value"
      :solid="chrome.bottomSolid.value"
      :is-dark-theme="isDarkTheme"
      @mouseenter="usesChromeZones && (webHotZones.bottom = true)"
      @mouseleave="usesChromeZones && (webHotZones.bottom = false)"
    />
    <div v-if="isMiniFileForm" class="mini-drag-rail mini-drag-rail-left" aria-hidden="true"></div>
    <div v-if="isMiniFileForm" class="mini-drag-rail mini-drag-rail-right" aria-hidden="true"></div>
    <div v-if="dragRoute.overlayVisible.value" class="drag-overlay">松手覆盖当前阅读</div>
  </div>
</template>

<style scoped>
.app-container {
  --effective-shell-bg: var(--app-shell-bg);
  --drag-overlay-scrim: color-mix(in srgb, var(--app-shell-bg) 72%, transparent);
  --drag-overlay-text: var(--color-text-secondary);
  --effective-toolbar-bg: var(--toolbar-bg);
  --effective-toolbar-solid-bg: var(--toolbar-bg);
  --effective-toolbar-border: var(--toolbar-border);
  --effective-toolbar-solid-border: var(--toolbar-border);
  --effective-toolbar-backdrop-filter: blur(var(--panel-material-blur));
  --effective-popover-bg: var(--panel-bg);
  --effective-popover-border: var(--toolbar-border);
  --effective-popover-hover-bg: var(--color-hover-bg);
  --effective-popover-shadow: var(--shadow-float);
  --effective-popover-backdrop-filter: blur(var(--panel-material-blur));
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: var(--radius-window);
  /* clip 而非 hidden：app 壳永不滚动；焦点/scrollIntoView 无法滚动 clip 容器，
     面板 translateY 进场的临时溢出也不会把正文顶起（overflow:hidden 仍是可编程滚动容器） */
  overflow: clip;
  position: relative;
  background: var(--effective-shell-bg);
}
.app-container.is-floating-chrome-layout {
  display: block;
}
.app-container.is-mini-form {
  border-radius: 8px;
}
.app-container.is-shell-background-hidden {
  --effective-shell-bg: transparent;
  --drag-overlay-scrim: var(--stealth-popover-bg);
  --drag-overlay-text: var(--color-text-primary);
  --effective-toolbar-bg: var(--stealth-toolbar-bg);
  --effective-toolbar-solid-bg: var(--stealth-toolbar-solid-bg);
  --effective-toolbar-border: var(--toolbar-border);
  --effective-toolbar-solid-border: var(--stealth-toolbar-solid-border);
  --effective-toolbar-backdrop-filter: var(--stealth-toolbar-backdrop-filter);
  --effective-popover-bg: var(--stealth-popover-bg);
  --effective-popover-border: var(--stealth-popover-border);
  --effective-popover-hover-bg: var(--stealth-popover-hover-bg);
  --effective-popover-shadow: var(--stealth-popover-shadow);
  --effective-popover-backdrop-filter: var(--stealth-popover-backdrop-filter);
}
.app-container.is-shell-background-hidden :deep(.top-bar .file-name) {
  color: var(--color-text-primary);
  text-shadow: 0 1px 2px color-mix(in srgb, var(--color-reader-bg) 72%, transparent);
}
:global(body.goof-off-main-window-surface) {
  --effective-popover-bg: var(--panel-bg);
  --effective-popover-border: var(--toolbar-border);
  --effective-popover-hover-bg: var(--color-hover-bg);
  --effective-popover-shadow: var(--shadow-float);
  --effective-popover-backdrop-filter: blur(var(--panel-material-blur));
}
:global(body.goof-off-main-window-surface.goof-off-main-shell-background-hidden) {
  --effective-popover-bg: var(--stealth-popover-bg);
  --effective-popover-border: var(--stealth-popover-border);
  --effective-popover-hover-bg: var(--stealth-popover-hover-bg);
  --effective-popover-shadow: var(--stealth-popover-shadow);
  --effective-popover-backdrop-filter: var(--stealth-popover-backdrop-filter);
}
.app-container.is-body-hidden {
  cursor: default;
}
.chrome-drag-band {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--drag-band-h);
  z-index: var(--z-drag-band);
  -webkit-app-region: drag;
}
.top-chrome-zone,
.bottom-chrome-zone {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--chrome-hot-zone-h);
  z-index: var(--z-chrome);
  pointer-events: auto;
}
.top-chrome-zone {
  top: var(--drag-band-h);
  height: calc(var(--chrome-hot-zone-h) - var(--drag-band-h));
}
.bottom-chrome-zone {
  bottom: 0;
}
.app-container:not(.is-floating-chrome-layout) > :deep(.top-bar) {
  position: relative;
  z-index: var(--z-chrome);
}
.app-container.is-floating-chrome-layout > :deep(.top-bar) {
  top: 0;
}
.app-container.is-floating-chrome-layout > :deep(.bottom-bar) {
  bottom: 0;
}
.app-container.is-floating-chrome-layout > :deep(.top-bar),
.app-container.is-floating-chrome-layout > :deep(.bottom-bar) {
  position: absolute;
  left: 0;
  right: 0;
  z-index: var(--z-chrome);
}
.mini-drag-rail {
  position: absolute;
  top: var(--chrome-hot-zone-h);
  bottom: var(--chrome-hot-zone-h);
  width: var(--mini-drag-rail-w);
  z-index: var(--z-drag-band);
  -webkit-app-region: drag;
}
.mini-drag-rail-left {
  left: 0;
}
.mini-drag-rail-right {
  right: 0;
}
.app-container.is-mini-file-form :deep(.content-area) {
  left: var(--mini-drag-rail-w);
  right: var(--mini-drag-rail-w);
  width: auto;
  margin: 0;
}
.app-container.is-mini-file-form :deep(.top-bar),
.app-container.is-mini-file-form :deep(.bottom-bar),
.app-container.is-mini-file-form :deep(button),
.app-container.is-mini-file-form :deep(input),
.app-container.is-mini-file-form :deep(.txt-reader),
.app-container.is-mini-file-form :deep(.epub-view-container),
.app-container.is-mini-file-form :deep(iframe) {
  -webkit-app-region: no-drag;
}
.app-container.is-mini-file-form :deep(.top-bar.is-mini) {
  -webkit-app-region: drag;
}
.drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  background: var(--drag-overlay-scrim);
  color: var(--drag-overlay-text);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-size: 12px;
}
</style>
