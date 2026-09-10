import { computed, ref, unref, watch } from 'vue'

export function useStealthWindowLeaveWatcher({
  api = globalThis.window?.api,
  armed,
  revealArmed = ref(false),
  readingTargetKey,
  canHideIgnoringFocus,
  requestBodyHideForWindowLeave,
  requestBodyReveal = () => Promise.resolve({ ok: false, reason: 'reveal-unavailable' })
}) {
  const currentWatcherEpoch = ref(null)
  const currentWatcherMode = ref(null)
  let enabling = null
  let enableGeneration = 0
  let disposed = false
  let pendingReviews = 0
  let disableAfterPendingReview = false
  let samplingStoppedForPendingReview = false
  let revealPending = null

  const isArmed = computed(() => unref(armed) === true)
  const trackingMode = computed(() => {
    if (unref(revealArmed) === true) return 'reentry'
    if (isArmed.value) return 'leave'
    return null
  })

  async function invokeWatcherIpc(operation, failureReason) {
    try {
      return await operation()
    } catch {
      return { ok: false, reason: failureReason }
    }
  }

  async function enable() {
    const requestedMode = trackingMode.value
    if (disposed || !requestedMode || currentWatcherEpoch.value != null || enabling) return
    const generation = ++enableGeneration
    const pendingEnable = invokeWatcherIpc(
      () => api?.windowEnableStealthLeaveWatcher?.({ mode: requestedMode }),
      'enable-ipc-failed'
    )
    enabling = pendingEnable
    try {
      const result = await pendingEnable
      const canAdoptForActiveArming = trackingMode.value === requestedMode
      const canAdoptForPendingFocusLoss =
        requestedMode === 'leave' &&
        pendingReviews > 0 &&
        disableAfterPendingReview &&
        currentWatcherEpoch.value == null
      if (
        result?.ok === true &&
        result.watcherEpoch != null &&
        !disposed &&
        generation === enableGeneration &&
        (canAdoptForActiveArming || canAdoptForPendingFocusLoss)
      ) {
        currentWatcherEpoch.value = result.watcherEpoch
        currentWatcherMode.value = requestedMode
        if (canAdoptForActiveArming) {
          disableAfterPendingReview = false
          samplingStoppedForPendingReview = false
        } else {
          await stopSamplingForPendingReview()
        }
      } else if (result?.watcherEpoch != null) {
        await invokeWatcherIpc(
          () => api?.windowDisableStealthLeaveWatcher?.({ watcherEpoch: result.watcherEpoch }),
          'disable-ipc-failed'
        )
      }
    } finally {
      if (enabling === pendingEnable) {
        enabling = null
        if (
          !disposed &&
          trackingMode.value &&
          currentWatcherEpoch.value == null &&
          generation !== enableGeneration
        ) {
          void enable()
        }
      }
    }
  }

  async function performDisable() {
    enableGeneration += 1
    const epoch = currentWatcherEpoch.value
    currentWatcherEpoch.value = null
    currentWatcherMode.value = null
    disableAfterPendingReview = false
    samplingStoppedForPendingReview = false
    if (epoch != null) {
      return invokeWatcherIpc(
        () => api?.windowDisableStealthLeaveWatcher?.({ watcherEpoch: epoch }),
        'disable-ipc-failed'
      )
    }
    return { ok: true, watcherEpoch: null }
  }

  async function stopSamplingForPendingReview() {
    const epoch = currentWatcherEpoch.value
    disableAfterPendingReview = true
    if (epoch == null && enabling) {
      return { ok: true, deferred: true, watcherEpoch: null }
    }
    enableGeneration += 1
    if (epoch == null || samplingStoppedForPendingReview) {
      return { ok: true, deferred: true, watcherEpoch: epoch }
    }
    samplingStoppedForPendingReview = true
    const result = await invokeWatcherIpc(
      () =>
        api?.windowDisableStealthLeaveWatcher?.({
          watcherEpoch: epoch,
          preserveReviewEpoch: true
        }),
      'disable-ipc-failed'
    )
    if (result?.ok === false) return result
    return { ok: true, deferred: true, watcherEpoch: epoch }
  }

  async function disable({ force = false } = {}) {
    if (!force && pendingReviews > 0) {
      return stopSamplingForPendingReview()
    }
    return performDisable()
  }

  async function rebuildWatcher() {
    if (disposed) return
    await disable({ force: true })
    if (!disposed && trackingMode.value) void enable()
  }

  function stillCurrent(epoch) {
    return (
      !disposed &&
      currentWatcherEpoch.value === epoch &&
      (trackingMode.value != null || pendingReviews > 0)
    )
  }

  async function runWithPendingReview(review) {
    pendingReviews += 1
    try {
      return await review()
    } finally {
      pendingReviews = Math.max(0, pendingReviews - 1)
      if (pendingReviews === 0 && (!isArmed.value || disableAfterPendingReview)) {
        await performDisable()
        if (!disposed && trackingMode.value) void enable()
      }
    }
  }

  async function resolveFocusLossEpoch() {
    if (currentWatcherEpoch.value != null) return currentWatcherEpoch.value
    const pendingEnable = enabling
    if (!pendingEnable) return null
    const result = await pendingEnable
    if (
      result?.ok === true &&
      result.watcherEpoch != null &&
      currentWatcherEpoch.value === result.watcherEpoch &&
      stillCurrent(result.watcherEpoch)
    ) {
      return result.watcherEpoch
    }
    return null
  }

  async function reviewLeaveCandidate(payload = {}, hideReason = 'window-left') {
    const epoch = payload.watcherEpoch
    const outsideEpoch = payload.outsideEpoch
    if (epoch == null || outsideEpoch == null || epoch !== currentWatcherEpoch.value) {
      return { ok: false, reason: 'stale' }
    }
    const review = await invokeWatcherIpc(
      () =>
        api?.windowReviewStealthLeaveCandidate?.({
          watcherEpoch: epoch,
          outsideEpoch
        }),
      'review-ipc-failed'
    )
    if (
      review?.ok === true &&
      review.outside === true &&
      review.watcherEpoch === epoch &&
      review.outsideEpoch === outsideEpoch &&
      stillCurrent(epoch) &&
      unref(canHideIgnoringFocus) === true
    ) {
      return requestBodyHideForWindowLeave(hideReason, { allowUnfocused: true })
    }
    return review || { ok: false, reason: 'review-failed' }
  }

  async function handleWindowLeftCandidate(payload = {}) {
    const epoch = payload.watcherEpoch
    if (
      currentWatcherMode.value !== 'leave' ||
      epoch == null ||
      epoch !== currentWatcherEpoch.value
    ) {
      return { ok: false, reason: 'stale' }
    }
    return runWithPendingReview(() => reviewLeaveCandidate(payload, 'window-left'))
  }

  async function handleDomAuxiliaryCandidate() {
    const epoch = currentWatcherEpoch.value
    if (epoch == null) return { ok: false, reason: 'watcher-inactive' }
    if (!isArmed.value) return { ok: false, reason: 'watcher-disarmed' }
    return runWithPendingReview(async () => {
      const candidate = await invokeWatcherIpc(
        () => api?.windowCreateStealthLeaveCandidate?.({ watcherEpoch: epoch }),
        'candidate-ipc-failed'
      )
      if (
        candidate?.ok !== true ||
        candidate.outside !== true ||
        candidate.watcherEpoch !== epoch ||
        candidate.outsideEpoch == null ||
        !stillCurrent(epoch)
      ) {
        return candidate || { ok: false, reason: 'candidate-failed' }
      }
      return reviewLeaveCandidate(
        { watcherEpoch: epoch, outsideEpoch: candidate.outsideEpoch },
        'window-left'
      )
    })
  }

  function handleWindowReentered(payload = {}) {
    const epoch = payload.watcherEpoch
    if (
      disposed ||
      trackingMode.value !== 'reentry' ||
      currentWatcherMode.value !== 'reentry' ||
      epoch == null ||
      epoch !== currentWatcherEpoch.value
    ) {
      return Promise.resolve({ ok: false, reason: 'stale' })
    }
    if (revealPending) return revealPending
    const pending = Promise.resolve(requestBodyReveal(`window-reenter-${payload.edge || 'edge'}`))
    const tracked = pending.finally(() => {
      if (revealPending === tracked) revealPending = null
    })
    revealPending = tracked
    return tracked
  }

  async function handleFocusLoss() {
    if (!isArmed.value || currentWatcherMode.value !== 'leave') {
      return { ok: false, reason: 'watcher-disarmed' }
    }
    return runWithPendingReview(async () => {
      const epoch = await resolveFocusLossEpoch()
      if (epoch == null) return { ok: false, reason: 'watcher-inactive' }
      const review = await invokeWatcherIpc(
        () => api?.windowReviewStealthFocusLoss?.({ watcherEpoch: epoch }),
        'focus-review-ipc-failed'
      )
      if (
        review?.ok === true &&
        review.outside === true &&
        review.watcherEpoch === epoch &&
        stillCurrent(epoch) &&
        unref(canHideIgnoringFocus) === true
      ) {
        return requestBodyHideForWindowLeave('window-blur', { allowUnfocused: true })
      }
      return review || { ok: false, reason: 'review-failed' }
    })
  }

  const stop = watch(
    trackingMode,
    (mode, previousMode) => {
      if (mode === previousMode) return
      if (previousMode == null && mode != null && currentWatcherEpoch.value == null) {
        void enable()
        return
      }
      void rebuildWatcher()
    },
    { immediate: true }
  )

  const stopReadingTarget = watch(
    () => unref(readingTargetKey),
    (value, previous) => {
      if (previous === undefined || value === previous) return
      if (trackingMode.value === 'leave') void rebuildWatcher()
    }
  )

  function dispose() {
    disposed = true
    enableGeneration += 1
    stop()
    stopReadingTarget()
    void disable({ force: true })
  }

  return {
    currentWatcherEpoch,
    currentWatcherMode,
    enable,
    disable,
    dispose,
    handleWindowLeftCandidate,
    handleWindowReentered,
    handleFocusLoss,
    handleDomAuxiliaryCandidate
  }
}
