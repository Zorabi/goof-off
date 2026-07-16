import { getMainWindow } from './windowManager.js'
import { applyContentOpacity } from './webviewManager.js'
import { resolveFramePolicy } from '../shared/framePolicy.js'

const DEFAULT_VIBRANCY = 'under-window'
const DEFAULT_VISUAL_EFFECT_STATE = 'active'

export function resolveCurrentFramePolicy(effectiveOpacity) {
  return resolveFramePolicy({
    effectiveOpacity,
    borderlessActive: false
  })
}

export function applyShadowPolicy(shouldHide) {
  const win = getMainWindow()
  if (!win) return
  win.setHasShadow(!shouldHide)
}

function applyWindowMaterial(win, shellBackgroundHidden) {
  if (typeof win.setVibrancy === 'function') {
    win.setVibrancy(shellBackgroundHidden ? null : DEFAULT_VIBRANCY)
  }
  if (typeof win.setVisualEffectState === 'function') {
    win.setVisualEffectState(shellBackgroundHidden ? 'inactive' : DEFAULT_VISUAL_EFFECT_STATE)
  }
}

export function applyTransparency(effectiveOpacity) {
  const win = getMainWindow()
  const framePolicy = resolveCurrentFramePolicy(effectiveOpacity)
  if (!win || win.isDestroyed?.()) return framePolicy
  const shellBackgroundHidden = effectiveOpacity.shellBackgroundHidden === true
  const interfaceOpacity = effectiveOpacity.interfaceOpacity ?? effectiveOpacity.contentOpacity ?? 1
  win.setHasShadow(!framePolicy.shouldHideShadow)
  applyWindowMaterial(win, shellBackgroundHidden)
  win.setOpacity(1)
  applyContentOpacity(interfaceOpacity)
  return framePolicy
}

export function hideWindow() {
  const win = getMainWindow()
  if (!win) return
  win.setOpacity(0)
  win.hide()
}

export function showWindow() {
  const win = getMainWindow()
  if (!win) return
  win.show()
  fadeOpacityTo(1, 200)
}

function fadeOpacityTo(target, durationMs) {
  const win = getMainWindow()
  if (!win) return
  const start = win.getOpacity()
  const startTime = Date.now()
  const tick = () => {
    const elapsed = Date.now() - startTime
    const t = Math.min(1, elapsed / durationMs)
    const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
    win.setOpacity(start + (target - start) * eased)
    if (t < 1) setTimeout(tick, 16)
  }
  tick()
}
