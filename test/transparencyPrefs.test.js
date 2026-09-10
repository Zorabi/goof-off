import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_INTERFACE_OPACITY,
  applyTransparencyToggle,
  normalizeTransparencyPrefs,
  resolveEffectiveOpacity
} from '../src/shared/transparencyPrefs.js'
import { validatePopoverAction, validatePopoverSnapshot } from '../src/shared/popoverProtocol.js'

test('legacy zero opacity is normalized to a recoverable value', () => {
  const prefs = normalizeTransparencyPrefs({
    merged: true,
    windowEnabled: true,
    contentEnabled: true,
    contentLevel: 0
  })

  assert.equal(prefs.contentLevel, MIN_INTERFACE_OPACITY)
  assert.equal(resolveEffectiveOpacity(prefs).interfaceOpacity, MIN_INTERFACE_OPACITY)
})

test('unified transparency toggle changes both visible layers', () => {
  const enabled = applyTransparencyToggle(normalizeTransparencyPrefs({ merged: true }), {
    kind: 'unified',
    value: true
  })
  const disabled = applyTransparencyToggle(enabled, { kind: 'unified', value: false })

  assert.equal(enabled.windowEnabled, true)
  assert.equal(enabled.contentEnabled, true)
  assert.equal(disabled.windowEnabled, false)
  assert.equal(disabled.contentEnabled, false)
})

test('popover protocol rejects a fully invisible interface', () => {
  const snapshot = {
    id: 'visual',
    merged: true,
    windowEnabled: true,
    contentEnabled: true,
    contentLevel: 0,
    zoom: 1,
    wheelSpeed: 1,
    plainView: false,
    hideMedia: false,
    webControlsVisible: true,
    theme: { isDark: false, cssVars: {} }
  }

  assert.equal(validatePopoverSnapshot(snapshot).ok, false)
  assert.equal(
    validatePopoverAction({ id: 'visual', action: 'set-content-level', value: 0 }).ok,
    false
  )
})
