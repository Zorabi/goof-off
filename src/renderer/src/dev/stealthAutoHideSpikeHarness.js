export const FILE_BODY_OPACITY_VAR = '--stealth-file-body-opacity-multiplier'
const DEFAULT_HOT_ZONE_PX = 44
const TOP_DRAG_ONLY_PX = 6

function getFileBodyOpacityTargets(target = window) {
  const appContainer = target.document?.querySelector?.('.app-container') || null
  const documentElement = target.document?.documentElement || null
  return {
    appContainer,
    documentElement
  }
}

function normalizeOpacityMultiplier(value) {
  const next = Number(value)
  if (!Number.isFinite(next)) return 1
  return Math.min(1, Math.max(0, next))
}

function inspectEpubRenderState(target = window) {
  const container = target.document?.querySelector?.('.epub-view-container') || null
  const iframes = container?.querySelectorAll?.('iframe') || []
  let iframeBodyCount = 0
  let iframeBodyChildCount = 0
  let hasVisibleBodyText = false

  for (const iframe of iframes) {
    let body = null
    try {
      body = iframe?.contentDocument?.body || null
    } catch {
      body = null
    }
    if (!body) continue
    iframeBodyCount += 1
    iframeBodyChildCount += Number(body.childElementCount) || 0
    hasVisibleBodyText ||= Boolean(String(body.innerText || body.textContent || '').trim())
  }

  return {
    ok: true,
    visibilityState: target.document?.visibilityState || 'unknown',
    hasContainer: Boolean(container),
    containerChildCount: Number(container?.childElementCount) || 0,
    iframeCount: iframes.length,
    iframeBodyCount,
    iframeBodyChildCount,
    hasVisibleBodyText
  }
}

function createProbeState() {
  return {
    clickThroughActive: false,
    hotZoneWakeCount: 0,
    lockRecoveryCount: 0,
    lastWakeZone: null,
    hotZoneListener: null
  }
}

export function resetStealthFileBodyOpacity(target = window) {
  const { appContainer, documentElement } = getFileBodyOpacityTargets(target)
  appContainer?.style?.setProperty(FILE_BODY_OPACITY_VAR, '1')
  documentElement?.style?.removeProperty(FILE_BODY_OPACITY_VAR)
  return { ok: true, multiplier: 1 }
}

export function installStealthAutoHideSpikeHarness({
  dev = import.meta.env.DEV,
  enabled = false,
  target = window,
  api = target.api
} = {}) {
  if (!dev || enabled !== true || !api?.windowProbeMousePassthrough) return false
  const probeState = createProbeState()
  const disableClickThrough = async () => {
    const result = await api.windowProbeMousePassthrough({ enabled: false })
    if (result?.ok !== false) probeState.clickThroughActive = false
    return result
  }
  target.__goofOffStealthSpike = {
    enableClickThrough: async () => {
      const result = await api.windowProbeMousePassthrough({ enabled: true })
      if (result?.ok !== false) probeState.clickThroughActive = true
      return result
    },
    disableClickThrough,
    startHotZoneWakeProbe: ({
      top = DEFAULT_HOT_ZONE_PX,
      bottom = DEFAULT_HOT_ZONE_PX,
      topHoverStart = TOP_DRAG_ONLY_PX
    } = {}) => {
      if (probeState.hotZoneListener) {
        target.removeEventListener?.('mousemove', probeState.hotZoneListener)
      }
      probeState.hotZoneListener = async (event) => {
        const y = Number(event?.clientY)
        if (!Number.isFinite(y) || !probeState.clickThroughActive) return
        const height = Number(target.innerHeight) || 0
        const zone =
          y > topHoverStart && y <= top
            ? 'top'
            : height > 0 && height - y <= bottom
              ? 'bottom'
              : null
        if (!zone) return
        probeState.hotZoneWakeCount += 1
        probeState.lastWakeZone = zone
        await disableClickThrough()
      }
      target.addEventListener?.('mousemove', probeState.hotZoneListener)
      return { ok: true, top, bottom, topHoverStart }
    },
    stopHotZoneWakeProbe: () => {
      if (probeState.hotZoneListener) {
        target.removeEventListener?.('mousemove', probeState.hotZoneListener)
      }
      probeState.hotZoneListener = null
      return { ok: true }
    },
    probeChromeLockRecovery: async (lockId = 'manual-lock') => {
      probeState.lockRecoveryCount += 1
      await disableClickThrough()
      return { ok: true, recovered: true, lockId }
    },
    getProbeState: () => ({
      clickThroughActive: probeState.clickThroughActive,
      hotZoneWakeCount: probeState.hotZoneWakeCount,
      lockRecoveryCount: probeState.lockRecoveryCount,
      lastWakeZone: probeState.lastWakeZone
    }),
    setWebOpacity: (multiplier = 0.02) => api.browserSetStealthContentOpacityMultiplier(multiplier),
    resetWebOpacity: () => api.browserSetStealthContentOpacityMultiplier(1),
    setFileOpacity: (multiplier = 0.02) => {
      const normalized = normalizeOpacityMultiplier(multiplier)
      const { appContainer, documentElement } = getFileBodyOpacityTargets(target)
      appContainer?.style?.setProperty(FILE_BODY_OPACITY_VAR, String(normalized))
      documentElement?.style?.setProperty(FILE_BODY_OPACITY_VAR, String(normalized))
      return { ok: true, multiplier: normalized }
    },
    resetFileOpacity: () => {
      return resetStealthFileBodyOpacity(target)
    },
    pauseMedia: () => api.browserPauseActiveMediaForStealth(),
    inspectEpubRender: () => inspectEpubRenderState(target),
    logResult: (capability, ok, reason = 'manual') =>
      api.diagnosticLog(
        'stealth_auto_hide.spike_result',
        {
          platformFamily: api.platformPolicy?.family || 'unknown',
          capability,
          ok: ok === true,
          reason
        },
        'info'
      )
  }
  return true
}
