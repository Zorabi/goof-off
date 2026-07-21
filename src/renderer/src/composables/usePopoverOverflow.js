import { computed, getCurrentInstance, onBeforeUnmount, reactive, watch } from 'vue'
import { POPOVER_SHIFT_TOLERANCE_DIP } from '../../../shared/popoverProtocol.js'
import { createPopoverRequestToken } from '../popoverRequestToken.js'

export function decidePopoverHost({
  placement,
  triggerRectDip,
  mainWindowSizeDip,
  desiredSizeDip
}) {
  if (!triggerRectDip || !mainWindowSizeDip || !desiredSizeDip) return { host: 'main', placement }
  const candidate = computeMainCandidate({ placement, triggerRectDip, desiredSizeDip })
  const shifted = clampIntoWindow(candidate, mainWindowSizeDip, desiredSizeDip)
  const shiftDistance = Math.max(
    Math.abs(shifted.x - candidate.x),
    Math.abs(shifted.y - candidate.y)
  )
  const fits =
    shifted.x >= 0 &&
    shifted.y >= 0 &&
    shifted.x + desiredSizeDip.width <= mainWindowSizeDip.width &&
    shifted.y + desiredSizeDip.height <= mainWindowSizeDip.height
  if (!fits || shiftDistance > POPOVER_SHIFT_TOLERANCE_DIP) return { host: 'child', placement }
  return { host: 'main', placement }
}

export function createPopoverOverflowController(options) {
  const state = reactive({ childActive: false, disposed: false })
  const isChildHostActive = computed(() => state.childActive)
  const controller = { isChildHostActive, recompute, closeChild, dispose }
  let requestGeneration = 0
  let activeChildRequestToken = null
  let pendingChildOpen = null
  const stopSnapshotWatch = watch(
    () => options.snapshot.value,
    (snapshot) => {
      const requestToken = activeChildRequestToken ?? pendingChildOpen?.requestToken ?? null
      if (requestToken && snapshot) {
        window.api.popoverUpdateSnapshot(withRequestToken(snapshot, requestToken))
      }
    },
    { deep: true }
  )

  const removeAction = window.api.onPopoverChildAction?.((payload) => {
    const requestToken = activeChildRequestToken ?? pendingChildOpen?.requestToken ?? null
    if (payload?.id !== options.id || payload.requestToken !== requestToken) return
    options.onChildAction?.(payload)
  })
  const removeClose = window.api.onPopoverChildClose?.((payload) => {
    const requestToken = activeChildRequestToken ?? pendingChildOpen?.requestToken ?? null
    if (payload?.id !== options.id || payload.requestToken !== requestToken) return
    options.onChildClose?.(payload)
  })
  const removeRecompute = window.api.onPopoverRecomputeRequest?.((payload) => {
    if (payload?.id === options.id) controller.recompute()
  })
  const resizeObserver = new ResizeObserver(() => controller.recompute())
  const observedElements = new Set()
  const stopTriggerWatch = watch(() => options.triggerEl.value, updateObservedElement)
  const stopPanelWatch = watch(() => options.panelEl?.value, updateObservedElement)
  observeElement(options.triggerEl.value)
  observeElement(options.panelEl?.value)
  window.addEventListener('resize', controller.recompute)

  function shouldForceChildHost() {
    return options.forceChildHost?.value === true
  }

  function observeElement(el) {
    if (isObservableElement(el) && !observedElements.has(el)) {
      resizeObserver.observe(el)
      observedElements.add(el)
    }
  }

  function updateObservedElement(nextEl, previousEl) {
    if (previousEl && observedElements.has(previousEl)) {
      resizeObserver.unobserve(previousEl)
      observedElements.delete(previousEl)
    }
    observeElement(nextEl)
    controller.recompute()
  }

  async function recompute() {
    const generation = ++requestGeneration
    if (state.disposed || !options.modelValue.value) return closeChild()
    const triggerRectDip = readTriggerRect(options.triggerEl.value)
    if (!triggerRectDip || !options.snapshot.value) return closeChild()
    const desiredSizeDip = readEffectiveSize(options.panelEl?.value, options.desiredSizeDip)
    const decision = shouldForceChildHost()
      ? { host: 'child', placement: options.placement }
      : decidePopoverHost({
          placement: options.placement,
          triggerRectDip,
          mainWindowSizeDip: { width: window.innerWidth, height: window.innerHeight },
          desiredSizeDip
        })
    if (decision.host === 'child') {
      const updatingActiveChild = state.childActive && activeChildRequestToken !== null
      let openState = updatingActiveChild ? null : pendingChildOpen
      const requestToken =
        activeChildRequestToken ?? openState?.requestToken ?? createPopoverRequestToken(options.id)
      const childPayload = {
        id: options.id,
        requestToken,
        placement: decision.placement,
        triggerRectDip,
        desiredSizeDip,
        mainWindowSizeDip: { width: window.innerWidth, height: window.innerHeight },
        snapshot: options.snapshot.value
      }

      let opened
      if (updatingActiveChild) {
        opened = await window.api.popoverUpdateSnapshot(childPayload)
      } else if (openState) {
        await window.api.popoverUpdateSnapshot(childPayload)
        opened = await openState.promise
      } else {
        const promise = Promise.resolve(window.api.popoverOpen(childPayload))
        openState = { requestToken, promise }
        pendingChildOpen = openState
        opened = await promise
      }

      const ownsRequest = updatingActiveChild
        ? activeChildRequestToken === requestToken
        : pendingChildOpen === openState
      const stale = generation !== requestGeneration || state.disposed || !options.modelValue.value
      if (stale) {
        if (opened === true && (state.disposed || !options.modelValue.value) && ownsRequest) {
          await window.api.popoverClose({ id: options.id, requestToken })
        }
        return
      }

      if (openState && pendingChildOpen === openState) pendingChildOpen = null
      activeChildRequestToken = opened === true ? requestToken : null
      state.childActive = opened === true
      if (opened !== true && shouldForceChildHost()) {
        options.onChildOpenFailed?.()
      }
    } else {
      await closeChild()
    }
  }

  async function closeChild() {
    requestGeneration++
    const requestToken = activeChildRequestToken ?? pendingChildOpen?.requestToken ?? null
    activeChildRequestToken = null
    pendingChildOpen = null
    state.childActive = false
    if (!requestToken) return
    await window.api.popoverClose({ id: options.id, requestToken })
  }

  function dispose() {
    state.disposed = true
    stopSnapshotWatch()
    removeAction?.()
    removeClose?.()
    removeRecompute?.()
    stopTriggerWatch()
    stopPanelWatch()
    resizeObserver.disconnect()
    window.removeEventListener('resize', controller.recompute)
    closeChild()
  }

  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return controller
}

function withRequestToken(payload, requestToken) {
  if (!requestToken) return payload
  return { ...payload, requestToken }
}

function readTriggerRect(el) {
  const rect = el?.getBoundingClientRect?.()
  if (!rect) return null
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function isObservableElement(el) {
  return el?.nodeType === 1
}

function readEffectiveSize(panelEl, desiredSizeDip) {
  const rect = panelEl?.getBoundingClientRect?.()
  if (!rect) return desiredSizeDip
  return {
    width: Math.max(desiredSizeDip.width, Math.ceil(rect.width)),
    height: Math.max(desiredSizeDip.height, Math.ceil(rect.height))
  }
}

function computeMainCandidate({ placement, triggerRectDip, desiredSizeDip }) {
  if (placement === 'bottom') {
    return {
      x: triggerRectDip.x + triggerRectDip.width / 2 - desiredSizeDip.width / 2,
      y: triggerRectDip.y + triggerRectDip.height
    }
  }
  if (placement === 'left') {
    return {
      x: triggerRectDip.x - desiredSizeDip.width,
      y: triggerRectDip.y + triggerRectDip.height / 2 - desiredSizeDip.height / 2
    }
  }
  if (placement === 'right') {
    return {
      x: triggerRectDip.x + triggerRectDip.width,
      y: triggerRectDip.y + triggerRectDip.height / 2 - desiredSizeDip.height / 2
    }
  }
  return {
    x: triggerRectDip.x + triggerRectDip.width / 2 - desiredSizeDip.width / 2,
    y: triggerRectDip.y - desiredSizeDip.height
  }
}

function clampIntoWindow(candidate, mainWindowSizeDip, desiredSizeDip) {
  return {
    x: Math.min(Math.max(candidate.x, 0), mainWindowSizeDip.width - desiredSizeDip.width),
    y: Math.min(Math.max(candidate.y, 0), mainWindowSizeDip.height - desiredSizeDip.height)
  }
}
