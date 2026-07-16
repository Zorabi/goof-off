import { ref } from 'vue'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'

const webPrefs = ref({
  ua: 'iphone',
  compat: false,
  zoom: 1.0,
  hideScrollbar: true,
  plainView: false,
  hideMedia: false,
  wheelSpeed: 1
})
const currentSiteWebPrefs = ref({ origin: null, override: null, effectivePrefs: null })
const sessionZoom = ref(1.0)

let bootstrapPromise = null
let listenerRegistered = false
let hasSessionZoomOverride = false

function syncSessionZoomFromEffective({ force = false } = {}) {
  if (!force && hasSessionZoomOverride) return
  sessionZoom.value = currentSiteWebPrefs.value?.effectivePrefs?.zoom ?? webPrefs.value.zoom
}

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    try {
      webPrefs.value = await window.api.getWebPrefs()
      currentSiteWebPrefs.value = (await window.api.getCurrentSiteWebPrefs?.()) || {
        origin: null,
        override: null,
        effectivePrefs: null
      }
      syncSessionZoomFromEffective({ force: true })
    } catch (e) {
      console.error('[useWebPrefs] bootstrap failed, will retry on next call:', e)
      bootstrapPromise = null
      throw e
    }
    if (!listenerRegistered) {
      listenerRegistered = true
      window.api.onWebPrefsChange((newPrefs) => {
        webPrefs.value = newPrefs
        syncSessionZoomFromEffective()
      })
      window.api.onCurrentSiteWebPrefsChange?.((snapshot) => {
        currentSiteWebPrefs.value = snapshot || {
          origin: null,
          override: null,
          effectivePrefs: null
        }
        syncSessionZoomFromEffective()
      })
      window.api.onBrowserSessionZoomChanged?.((zoom) => {
        if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return
        hasSessionZoomOverride = true
        sessionZoom.value = zoom
      })
    }
  })()
  return bootstrapPromise
}

function recordTrackedWebPrefDiagnostics(patch, request) {
  const tasks = []
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'hideMedia')) {
    tasks.push(
      request.then(
        (accepted) =>
          logDiagnostic('web.media_visibility_change', {
            requestedHideMedia: Boolean(patch.hideMedia),
            acceptedHideMedia: Boolean((accepted || webPrefs.value).hideMedia),
            source: 'main-window',
            ok: true
          }),
        (error) =>
          logDiagnosticError('web.media_visibility_change', error, {
            requestedHideMedia: Boolean(patch.hideMedia),
            source: 'main-window',
            ok: false
          })
      )
    )
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'wheelSpeed')) {
    tasks.push(
      request.then(
        (accepted) =>
          logDiagnostic('web.wheel_speed_change', {
            requestedWheelSpeed: Number(patch.wheelSpeed),
            acceptedWheelSpeed: Number((accepted || webPrefs.value).wheelSpeed),
            source: 'main-window',
            ok: true
          }),
        (error) =>
          logDiagnosticError('web.wheel_speed_change', error, {
            requestedWheelSpeed: Number(patch.wheelSpeed),
            source: 'main-window',
            ok: false
          })
      )
    )
  }
  Promise.allSettled(tasks).catch(() => {})
}

export function useWebPrefs() {
  bootstrap().catch(() => {})

  function setWebPrefs(patch) {
    webPrefs.value = { ...webPrefs.value, ...patch }
    let request
    try {
      request = Promise.resolve(window.api.setWebPrefs(patch))
    } catch (error) {
      request = Promise.reject(error)
    }
    recordTrackedWebPrefDiagnostics(patch, request)
    return request
  }

  async function refreshWebPrefs() {
    webPrefs.value = await window.api.getWebPrefs()
    currentSiteWebPrefs.value = (await window.api.getCurrentSiteWebPrefs?.()) || {
      origin: null,
      override: null,
      effectivePrefs: null
    }
    syncSessionZoomFromEffective({ force: true })
    return webPrefs.value
  }

  async function setWebSessionZoom(value) {
    hasSessionZoomOverride = true
    sessionZoom.value = value
    try {
      const result = await window.api.browserSetSessionZoom?.(value)
      if (result && result.ok === false) {
        hasSessionZoomOverride = false
        syncSessionZoomFromEffective({ force: true })
      }
      return result
    } catch (e) {
      hasSessionZoomOverride = false
      syncSessionZoomFromEffective({ force: true })
      throw e
    }
  }

  return {
    webPrefs,
    currentSiteWebPrefs,
    sessionZoom,
    setWebPrefs,
    setWebSessionZoom,
    refreshWebPrefs
  }
}
