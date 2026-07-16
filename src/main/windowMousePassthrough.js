import { diagnosticLogger } from './diagnosticLogger.js'
import { getMainWindow } from './windowManager.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

let active = false
let runtimePlatformPolicy = getRuntimePlatformPolicy()

function normalizeSource(source) {
  return source === 'spike-harness' ? 'spike-harness' : 'main-window'
}

function getStealthCapability() {
  return runtimePlatformPolicy?.window?.stealthAutoHide || {}
}

function logMousePassthrough(level, payload) {
  return diagnosticLogger[level]('stealth_auto_hide.mouse_passthrough', payload, 'main')
}

export function configureMousePassthroughForTest({ platformPolicy } = {}) {
  runtimePlatformPolicy = platformPolicy || getRuntimePlatformPolicy()
  active = false
}

export function getMousePassthroughState() {
  return { active }
}

export async function setMousePassthrough(enabled, options = {}) {
  const requested = enabled === true
  const source = normalizeSource(options.source)
  const allowUnsupported = options.allowUnsupported === true

  if (requested && !allowUnsupported && getStealthCapability().bodyClickThrough !== true) {
    await logMousePassthrough('warn', {
      enabled: true,
      ok: false,
      reason: 'unsupported',
      source
    })
    return { ok: false, enabled: false, reason: 'unsupported' }
  }

  const win = getMainWindow()
  if (!win || win.isDestroyed?.()) {
    if (!requested) active = false
    await logMousePassthrough('warn', {
      enabled: requested,
      ok: false,
      reason: 'window-not-ready',
      source
    })
    return { ok: false, enabled: requested, reason: 'window-not-ready' }
  }

  try {
    if (requested) {
      win.setIgnoreMouseEvents(true, { forward: true })
      active = true
    } else {
      win.setIgnoreMouseEvents(false)
      active = false
    }
    await logMousePassthrough('info', {
      enabled: requested,
      ok: true,
      source
    })
    return { ok: true, enabled: requested }
  } catch (error) {
    const reason = error?.message || 'set-ignore-mouse-events-failed'
    await logMousePassthrough('error', {
      enabled: requested,
      ok: false,
      reason,
      source
    })
    return { ok: false, enabled: active, reason }
  }
}

export function restoreMousePassthrough(reason = 'restore') {
  return setMousePassthrough(false, {
    allowUnsupported: true,
    source: 'main-window',
    reason
  })
}
