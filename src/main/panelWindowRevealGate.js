export const PANEL_REVEAL_WATCHDOG_TIMEOUT_MS = 250

export function classifyPanelReveal(reason) {
  if (reason === 'presented' || reason === 'immediate') return 'guaranteed'
  if (reason === 'show-failed' || reason === 'restore-failed' || reason === 'target-destroyed') {
    return 'failed'
  }
  return 'degraded'
}

function setOpacity(target, value) {
  if (typeof target?.setOpacity !== 'function') return false
  try {
    target.setOpacity(value)
    return true
  } catch {
    return false
  }
}

function waitForNextPresentedFrame(target, onPresented) {
  const contents = target?.webContents
  if (
    typeof contents?.beginFrameSubscription !== 'function' ||
    typeof contents?.endFrameSubscription !== 'function' ||
    typeof contents?.invalidate !== 'function'
  ) {
    return null
  }

  let active = true
  let subscribed = false
  const stop = () => {
    if (!active) return
    active = false
    if (!subscribed) return
    try {
      contents.endFrameSubscription()
    } catch {
      // The renderer may have ended while the panel was being revealed.
    }
  }
  const handlePresentedFrame = () => {
    if (!active) return
    active = false
    try {
      contents.endFrameSubscription()
    } catch {
      // Completion still fails open if Electron rejects subscription cleanup.
    }
    onPresented()
  }

  try {
    subscribed = true
    contents.beginFrameSubscription(false, handlePresentedFrame)
    if (active) contents.invalidate()
    return stop
  } catch {
    stop()
    return null
  }
}

export function createPanelWindowRevealGate({
  enabled = true,
  timeoutMs = PANEL_REVEAL_WATCHDOG_TIMEOUT_MS
} = {}) {
  let pending = null
  const concealedTargets = new WeakSet()

  function cancel() {
    if (!pending) return
    const entry = pending
    pending = null
    clearTimeout(entry.timer)
    entry.cancelPresentation?.()
  }

  function conceal(target) {
    cancel()
    if (!enabled) {
      concealedTargets.delete(target)
      return
    }
    concealedTargets.add(target)
    setOpacity(target, 0)
  }

  function finish(target, key, reason) {
    if (!pending || pending.target !== target || pending.key !== key) return false
    const entry = pending
    pending = null
    clearTimeout(entry.timer)
    entry.cancelPresentation?.()
    if (target?.isDestroyed?.()) {
      entry.onComplete?.('target-destroyed')
      return false
    }
    const restored = setOpacity(target, 1)
    if (restored) concealedTargets.delete(target)
    entry.onComplete?.(restored ? reason : 'restore-failed')
    return true
  }

  function complete(target, key, reason = 'ack') {
    if (!pending || pending.target !== target || pending.key !== key) return false
    if (reason !== 'ack') return finish(target, key, reason)

    const entry = pending
    if (entry.presentationStarted) return false
    entry.presentationStarted = true
    const cancelPresentation = waitForNextPresentedFrame(target, () => {
      finish(target, key, 'presented')
    })
    if (pending !== entry) {
      cancelPresentation?.()
      return true
    }
    if (!cancelPresentation) return finish(target, key, 'presentation-unavailable')
    entry.cancelPresentation = cancelPresentation
    return true
  }

  function begin({ target, key, show, onComplete }) {
    cancel()
    const wasConcealed = concealedTargets.has(target)
    const supportsOpacity = typeof target?.setOpacity === 'function'
    const masked = enabled && setOpacity(target, 0)
    if (masked) concealedTargets.add(target)
    const entry = masked
      ? {
          target,
          key,
          onComplete,
          timer: null,
          presentationStarted: false,
          cancelPresentation: null
        }
      : null

    if (entry) {
      pending = entry
      entry.timer = setTimeout(() => finish(target, key, 'timeout'), timeoutMs)
    }

    try {
      show()
    } catch {
      if (entry) finish(target, key, 'show-failed')
      else onComplete?.('show-failed')
      return false
    }

    if (!entry) {
      let reason = enabled ? 'mask-unavailable' : 'immediate'
      if (enabled && (wasConcealed || supportsOpacity)) {
        if (setOpacity(target, 1)) concealedTargets.delete(target)
        else reason = 'restore-failed'
      }
      onComplete?.(reason)
      return false
    }
    return true
  }

  function isPending(target, key) {
    return Boolean(pending && pending.target === target && pending.key === key)
  }

  function isConcealed(target) {
    return concealedTargets.has(target)
  }

  return { begin, cancel, complete, conceal, isPending, isConcealed }
}
