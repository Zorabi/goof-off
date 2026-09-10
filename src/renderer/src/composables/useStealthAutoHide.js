import { computed, ref, unref, watch } from 'vue'
import { logDiagnostic as defaultLogDiagnostic } from './useDiagnosticLog.js'
import { pushStatus as defaultPushStatus } from './usePageMessages.js'

const BODY_HIDDEN_MULTIPLIER = 0

function readCapability(api) {
  return api?.platformPolicy?.window?.stealthAutoHide || {}
}

function isAutoHideControlSurface(appState) {
  return (
    appState?.form === 'normal' &&
    (appState?.content === 'home' ||
      appState?.content === 'history' ||
      appState?.content === 'web' ||
      appState?.content === 'file')
  )
}

function isNormalAutoHideState(appState) {
  return isAutoHideControlSurface(appState)
}

function getBodyHideGateLocks(activeLocks) {
  return (unref(activeLocks) || []).filter((lock) => lock?.bodyHideGate !== false)
}

function hasBodyHideGateLocks(activeLocks) {
  return getBodyHideGateLocks(activeLocks).length > 0
}

function normalizeReason(reason) {
  return String(reason || 'runtime-recovery')
}

export function useStealthAutoHide({
  appState,
  transparencyPrefs,
  activeLocks = ref([]),
  dragActive = ref(false),
  dragOverlayVisible = ref(false),
  focused = ref(true),
  api = globalThis.window?.api,
  pushStatus = defaultPushStatus,
  logDiagnostic = defaultLogDiagnostic
} = {}) {
  const toolbarAutoHideEnabled = ref(false)
  const bodyAutoHideEnabled = ref(false)
  const bodyHidden = ref(false)
  const mousePassthroughActive = ref(false)
  const bodyClickThroughRuntimeDisabled = ref(false)
  const bodyOpacityMultiplier = ref(1)
  const statusShown = new Set()
  let hideAttemptGeneration = 0
  let activeHideAttempt = null
  let webContentsOpacityOwner = null
  let bodyOpacityMultiplierOwner = null
  let bodyHiddenOwner = null
  let passthroughOwner = null

  const capability = computed(() => readCapability(api))
  const transparencyEnabled = computed(() => transparencyPrefs?.value?.windowEnabled === true)
  const controlsVisible = computed(() => isAutoHideControlSurface(appState))
  const readingControlsActive = computed(() => isNormalAutoHideState(appState))
  const bodyFadeAvailable = computed(() => capability.value.bodyFade === true)
  const bodyClickThroughAvailable = computed(
    () => capability.value.bodyClickThrough === true && !bodyClickThroughRuntimeDisabled.value
  )
  const bodyAutoHideAvailable = computed(() => transparencyEnabled.value && bodyFadeAvailable.value)
  const bodyAutoHideRuntimeAvailable = computed(
    () => readingControlsActive.value && bodyAutoHideAvailable.value
  )
  const bodyMode = computed(() => {
    if (!transparencyEnabled.value) return 'off'
    if (bodyAutoHideEnabled.value && bodyFadeAvailable.value) {
      return bodyClickThroughAvailable.value ? 'click-through' : 'body-fade'
    }
    if (toolbarAutoHideEnabled.value) return 'toolbar-only'
    return 'off'
  })
  const toolbarAutoHideLocked = computed(() => false)
  const bodyAutoHideDisabledTitle = computed(() => {
    if (!transparencyEnabled.value) return '开启背景隐去后可用'
    if (!bodyFadeAvailable.value) return '当前平台不可用'
    return ''
  })
  const bodyHideGateLocks = computed(() => getBodyHideGateLocks(activeLocks))

  function clearResourceOwnership() {
    activeHideAttempt = null
    webContentsOpacityOwner = null
    bodyOpacityMultiplierOwner = null
    bodyHiddenOwner = null
    passthroughOwner = null
  }

  function invalidateHideAttempts() {
    hideAttemptGeneration += 1
    return hideAttemptGeneration
  }

  function canWindowLeaveHideBodyNow({ allowUnfocused = false, requireVisibleBody = true } = {}) {
    return (
      readingControlsActive.value &&
      transparencyEnabled.value &&
      bodyAutoHideRuntimeAvailable.value &&
      bodyAutoHideEnabled.value &&
      appState?.hidden !== true &&
      (requireVisibleBody ? bodyHidden.value === false : true) &&
      hasBodyHideGateLocks(activeLocks) === false &&
      unref(dragActive) !== true &&
      unref(dragOverlayVisible) !== true &&
      (allowUnfocused || unref(focused) === true)
    )
  }

  const canWindowLeaveHideBody = computed(() =>
    canWindowLeaveHideBodyNow({ allowUnfocused: false, requireVisibleBody: true })
  )
  const canWindowLeaveHideBodyIgnoringFocus = computed(() =>
    canWindowLeaveHideBodyNow({ allowUnfocused: true, requireVisibleBody: true })
  )

  function showOnce(key, text) {
    if (statusShown.has(key)) return
    statusShown.add(key)
    pushStatus(text)
  }

  function logToggle(kind, value) {
    logDiagnostic(
      'stealth_auto_hide.toggle',
      {
        kind,
        value,
        gateActive: transparencyEnabled.value,
        mode: bodyMode.value
      },
      'info'
    )
  }

  function hasRestorableStealthState() {
    return (
      bodyHidden.value ||
      mousePassthroughActive.value ||
      bodyOpacityMultiplier.value !== 1 ||
      webContentsOpacityOwner != null
    )
  }

  function isFreshHideAttempt(attempt) {
    return activeHideAttempt === attempt && attempt.generation === hideAttemptGeneration
  }

  function canContinueBeforeHidden(attempt) {
    return (
      isFreshHideAttempt(attempt) &&
      canWindowLeaveHideBodyNow({
        allowUnfocused: attempt.allowUnfocused,
        requireVisibleBody: true
      })
    )
  }

  function canContinueAfterHidden(attempt) {
    return (
      isFreshHideAttempt(attempt) &&
      bodyHidden.value === true &&
      canWindowLeaveHideBodyNow({
        allowUnfocused: attempt.allowUnfocused,
        requireVisibleBody: false
      })
    )
  }

  function markOpacityWriteApplied(attempt, result) {
    if (!result?.ok || result.applied !== true) return
    attempt.opacityApplied = true
    if (webContentsOpacityOwner == null || webContentsOpacityOwner === attempt) {
      webContentsOpacityOwner = attempt
    }
  }

  function markBodyOpacityMultiplierApplied(attempt) {
    attempt.bodyOpacityMultiplierApplied = true
    if (bodyOpacityMultiplierOwner == null || bodyOpacityMultiplierOwner === attempt) {
      bodyOpacityMultiplierOwner = attempt
    }
  }

  function markPassthroughWriteApplied(attempt, result) {
    if (result?.ok === false) return
    attempt.passthroughApplied = true
    if (passthroughOwner == null || passthroughOwner === attempt) passthroughOwner = attempt
  }

  async function applyBodyOpacityMultiplier(multiplier) {
    if (appState.content !== 'web') return { ok: true, applied: false }
    const setContentOpacityMultiplier = api?.browserSetStealthContentOpacityMultiplier
    if (typeof setContentOpacityMultiplier !== 'function') {
      return { ok: false, reason: 'opacity-ipc-unavailable', applied: false }
    }
    try {
      const result = await setContentOpacityMultiplier(multiplier)
      if (result?.ok === false) {
        return { ok: false, reason: result.reason || 'opacity-ipc-failed', applied: false }
      }
      return { ok: true, applied: true }
    } catch (error) {
      return { ok: false, reason: error?.message || 'opacity-ipc-failed', applied: false }
    }
  }

  async function abortStaleHideAttempt(attempt, reason = 'stale-hide-attempt') {
    const clearPassthrough = attempt.passthroughApplied === true && passthroughOwner === attempt
    const clearWebContentsOpacity =
      attempt.opacityApplied === true && webContentsOpacityOwner === attempt
    const clearBodyOpacityMultiplier =
      attempt.bodyOpacityMultiplierApplied === true && bodyOpacityMultiplierOwner === attempt
    const clearBodyHidden = bodyHiddenOwner === attempt
    if (activeHideAttempt === attempt) activeHideAttempt = null

    if (clearPassthrough) {
      passthroughOwner = null
      mousePassthroughActive.value = false
      try {
        await api?.windowSetMousePassthrough?.({ enabled: false })
      } catch {
        // Stale attempts should not surface user-facing failures.
      }
    }
    if (clearBodyOpacityMultiplier) {
      bodyOpacityMultiplierOwner = null
      bodyOpacityMultiplier.value = 1
    }
    if (clearWebContentsOpacity) {
      webContentsOpacityOwner = null
      try {
        await api?.browserSetStealthContentOpacityMultiplier?.(1)
      } catch {
        // Stale attempts should not surface user-facing failures.
      }
    }
    if (clearBodyHidden) {
      bodyHiddenOwner = null
      bodyHidden.value = false
    }
    return { ok: false, reason }
  }

  async function degradeBodyFade(reason = 'opacity-ipc-failed', from = 'body-fade') {
    invalidateHideAttempts()
    clearResourceOwnership()
    toolbarAutoHideEnabled.value = true
    bodyAutoHideEnabled.value = false
    bodyHidden.value = false
    bodyOpacityMultiplier.value = 1
    await restoreStealthInteraction('body-hide-degraded', { modeBefore: from })
    showOnce('body-fade-degraded', '主体自动隐藏不可用，已恢复内容并保留工具栏自动隐藏')
    logDiagnostic('stealth_auto_hide.degraded', { from, to: 'toolbar-only', reason }, 'warn')
    return { ok: false, reason }
  }

  async function runBodyHideAttempt(attempt) {
    const mode = bodyMode.value
    if (appState.content === 'web') {
      try {
        const media = await api?.browserPauseActiveMediaForStealth?.()
        if (!isFreshHideAttempt(attempt)) return abortStaleHideAttempt(attempt)
        if (media?.ok === false) showOnce('media-pause-failed', '媒体暂停失败，已继续隐藏')
      } catch {
        if (!isFreshHideAttempt(attempt)) return abortStaleHideAttempt(attempt)
        showOnce('media-pause-failed', '媒体暂停失败，已继续隐藏')
      }
    }
    if (!canContinueBeforeHidden(attempt)) return abortStaleHideAttempt(attempt)
    const opacityResult = await applyBodyOpacityMultiplier(BODY_HIDDEN_MULTIPLIER)
    markOpacityWriteApplied(attempt, opacityResult)
    if (!canContinueBeforeHidden(attempt)) return abortStaleHideAttempt(attempt)
    if (!opacityResult.ok) return degradeBodyFade(opacityResult.reason)
    bodyOpacityMultiplier.value = BODY_HIDDEN_MULTIPLIER
    markBodyOpacityMultiplierApplied(attempt)
    bodyHidden.value = true
    bodyHiddenOwner = attempt
    if (mode === 'click-through') {
      let result
      let passthroughFailure = null
      try {
        result = await api?.windowSetMousePassthrough?.({ enabled: true })
        if (result?.ok === false) passthroughFailure = result.reason || 'ipc-failed'
        else markPassthroughWriteApplied(attempt, result)
        if (!canContinueAfterHidden(attempt)) return abortStaleHideAttempt(attempt)
      } catch (error) {
        if (!canContinueAfterHidden(attempt)) return abortStaleHideAttempt(attempt)
        passthroughFailure = error?.message || 'ipc-failed'
      }
      if (passthroughFailure) {
        bodyClickThroughRuntimeDisabled.value = true
        return degradeBodyFade(passthroughFailure, 'click-through')
      } else {
        mousePassthroughActive.value = true
      }
    }
    if (activeHideAttempt === attempt) activeHideAttempt = null
    return { ok: true, mode: bodyMode.value }
  }

  function requestBodyHideForWindowLeave(reason = 'window-left', options = {}) {
    const allowUnfocused = options.allowUnfocused === true
    if (!canWindowLeaveHideBodyNow({ allowUnfocused, requireVisibleBody: true })) {
      return Promise.resolve({ ok: false, reason: 'conditions-not-met' })
    }
    if (activeHideAttempt?.generation === hideAttemptGeneration && activeHideAttempt.promise) {
      return activeHideAttempt.promise
    }
    const attempt = {
      generation: invalidateHideAttempts(),
      allowUnfocused,
      reason,
      promise: null
    }
    activeHideAttempt = attempt
    attempt.promise = runBodyHideAttempt(attempt).finally(() => {
      if (activeHideAttempt === attempt) activeHideAttempt = null
    })
    return attempt.promise
  }

  async function restoreStealthInteraction(reason = 'runtime-recovery', options = {}) {
    const modeBefore = options.modeBefore || bodyMode.value
    const normalizedReason = normalizeReason(reason)
    const failures = []
    const shouldRestoreWebContentsOpacity =
      appState?.content === 'web' || webContentsOpacityOwner != null
    invalidateHideAttempts()
    clearResourceOwnership()

    let passthroughRestored = false
    try {
      const passthrough = await api?.windowSetMousePassthrough?.({ enabled: false })
      if (passthrough?.ok === false) {
        failures.push(passthrough.reason || 'passthrough-restore-failed')
      } else {
        passthroughRestored = true
      }
    } catch (error) {
      failures.push(error?.message || 'passthrough-restore-failed')
    } finally {
      // Keep the recovery marker when the native call failed. Subsequent
      // activity/reveal events can then retry instead of assuming the window is
      // interactive while it may still ignore input.
      mousePassthroughActive.value = !passthroughRestored
    }

    if (shouldRestoreWebContentsOpacity) {
      try {
        const opacity = await api?.browserSetStealthContentOpacityMultiplier?.(1)
        if (opacity?.ok === false) {
          failures.push(opacity.reason || 'opacity-restore-failed')
        }
      } catch (error) {
        failures.push(error?.message || 'opacity-restore-failed')
      }
    }
    bodyOpacityMultiplier.value = 1
    bodyHidden.value = false
    clearResourceOwnership()

    logDiagnostic('stealth_auto_hide.restore', { reason: normalizedReason, modeBefore }, 'info')
    if (failures.length > 0) {
      logDiagnostic(
        'stealth_auto_hide.restore_failed',
        { reason: normalizedReason, modeBefore, failures },
        'warn'
      )
    }
    return failures.length > 0
      ? { ok: false, reason: failures.join('; ') }
      : { ok: true, reason: normalizedReason }
  }

  function resetRuntime(reason = 'state-change') {
    const modeBefore = bodyMode.value
    toolbarAutoHideEnabled.value = false
    bodyAutoHideEnabled.value = false
    bodyClickThroughRuntimeDisabled.value = false
    statusShown.clear()
    invalidateHideAttempts()
    clearResourceOwnership()
    mousePassthroughActive.value = false
    bodyOpacityMultiplier.value = 1
    bodyHidden.value = false
    if (modeBefore !== 'off') {
      logDiagnostic('stealth_auto_hide.restore', { reason, modeBefore }, 'info')
    }
  }

  function recoverInactiveRuntime(reason = 'state-change') {
    invalidateHideAttempts()
    if (hasRestorableStealthState()) {
      void restoreStealthInteraction(reason)
      return
    }
    clearResourceOwnership()
    mousePassthroughActive.value = false
    bodyOpacityMultiplier.value = 1
    bodyHidden.value = false
  }

  function setToolbarAutoHideEnabled(value) {
    const next = value === true
    if (!transparencyEnabled.value) return { ok: false, reason: 'transparency-disabled' }
    const wasEnabled = toolbarAutoHideEnabled.value === true
    toolbarAutoHideEnabled.value = next
    if (!next) {
      if (wasEnabled && hasRestorableStealthState()) {
        void restoreStealthInteraction('toolbar-disabled')
      }
    } else {
      invalidateHideAttempts()
    }
    logToggle('toolbar', next)
    return { ok: true }
  }

  function setBodyAutoHideEnabled(value) {
    const next = value === true
    if (!next) {
      const modeBefore = bodyMode.value
      bodyAutoHideEnabled.value = false
      void restoreStealthInteraction('body-disabled', { modeBefore })
      logToggle('body', false)
      return { ok: true }
    }
    if (!transparencyEnabled.value) return { ok: false, reason: 'transparency-disabled' }
    if (!bodyFadeAvailable.value) {
      showOnce('body-fade-unavailable', '主体自动隐藏在当前平台不可用')
      logToggle('body', false)
      return { ok: false, reason: 'body-fade-unavailable' }
    }
    bodyAutoHideEnabled.value = true
    toolbarAutoHideEnabled.value = true
    invalidateHideAttempts()
    logToggle('body', true)
    return { ok: true }
  }

  function notifyActivity(reason = 'activity') {
    if (bodyHidden.value || hasRestorableStealthState()) {
      void restoreStealthInteraction(reason)
      return
    }
    invalidateHideAttempts()
  }

  function handleWindowBlur() {
    if (!bodyHidden.value) {
      invalidateHideAttempts()
      return
    }
    if (bodyMode.value === 'click-through' && mousePassthroughActive.value) return
    void restoreStealthInteraction('window-blur')
  }

  watch(
    () => [transparencyEnabled.value, readingControlsActive.value],
    ([enabled, runtimeActive]) => {
      if (!enabled || !runtimeActive) recoverInactiveRuntime('state-change')
    },
    { immediate: true }
  )

  watch(
    () => [
      bodyHideGateLocks.value.length,
      unref(focused),
      appState.content,
      appState.fileKind,
      appState.form,
      appState.hidden
    ],
    (values, previous = []) => {
      const [lockCount, , content, fileKind, form, hidden] = values
      const [, , prevContent, prevFileKind, prevForm, prevHidden] = previous
      const stateChanged =
        prevContent !== undefined &&
        (content !== prevContent ||
          fileKind !== prevFileKind ||
          form !== prevForm ||
          hidden !== prevHidden)
      const blocksPendingAttempt = lockCount > 0 || hidden === true || stateChanged
      if (activeHideAttempt != null && blocksPendingAttempt) invalidateHideAttempts()
      else if (bodyHidden.value && hidden === true) void restoreStealthInteraction('boss-hidden')
      else if (bodyHidden.value && lockCount > 0) void restoreStealthInteraction('chrome-lock')
      else if (bodyHidden.value && stateChanged) void restoreStealthInteraction('state-change')
      else if (blocksPendingAttempt) invalidateHideAttempts()
    }
  )

  return {
    toolbarAutoHideEnabled,
    bodyAutoHideEnabled,
    bodyAutoHideAvailable,
    bodyAutoHideDisabledTitle,
    toolbarAutoHideLocked,
    bodyHidden,
    bodyMode,
    bodyOpacityMultiplier,
    mousePassthroughActive,
    controlsVisible,
    canWindowLeaveHideBody,
    canWindowLeaveHideBodyIgnoringFocus,
    setToolbarAutoHideEnabled,
    setBodyAutoHideEnabled,
    notifyActivity,
    restoreStealthInteraction,
    resetRuntime,
    handleWindowBlur,
    requestBodyHideForWindowLeave
  }
}
