import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRangeProgress } from '../src/shared/rangeMath.js'
import {
  STEALTH_REVEAL_REGION_WINDOW,
  resolveStealthRevealEdge,
  resolveStealthRevealTarget
} from '../src/shared/stealthRevealRegion.js'
import { createVisualActionScheduler } from '../src/renderer/src/popoverAdapters.js'
import { ref } from 'vue'
import { useStealthWindowLeaveWatcher } from '../src/renderer/src/composables/useStealthWindowLeaveWatcher.js'

test('range fill is normalized against its non-zero minimum', () => {
  assert.equal(normalizeRangeProgress(0.1, 0.1, 0.95), 0)
  assert.equal(normalizeRangeProgress(0.95, 0.1, 0.95), 1)
  assert.ok(Math.abs(normalizeRangeProgress(0.525, 0.1, 0.95) - 0.5) < Number.EPSILON)
  assert.equal(normalizeRangeProgress(-1, 0.1, 0.95), 0)
  assert.equal(normalizeRangeProgress(2, 0.1, 0.95), 1)
})

test('hidden window reveal region covers full-width top and bottom 44px', () => {
  const bounds = { x: 100, y: 200, width: 400, height: 300 }

  assert.equal(resolveStealthRevealEdge({ x: 100, y: 200 }, bounds), 'top')
  assert.equal(resolveStealthRevealEdge({ x: 499, y: 243 }, bounds), 'top')
  assert.equal(resolveStealthRevealEdge({ x: 300, y: 244 }, bounds), null)
  assert.equal(resolveStealthRevealEdge({ x: 300, y: 456 }, bounds), 'bottom')
  assert.equal(resolveStealthRevealEdge({ x: 500, y: 220 }, bounds), null)
})

test('pointer-follow mode reveals from anywhere inside the window', () => {
  const bounds = { x: 100, y: 200, width: 400, height: 300 }

  assert.equal(
    resolveStealthRevealTarget({ x: 300, y: 350 }, bounds, STEALTH_REVEAL_REGION_WINDOW),
    'window'
  )
  assert.equal(
    resolveStealthRevealTarget({ x: 99, y: 350 }, bounds, STEALTH_REVEAL_REGION_WINDOW),
    null
  )
  assert.equal(
    resolveStealthRevealTarget({ x: 500, y: 350 }, bounds, STEALTH_REVEAL_REGION_WINDOW),
    null
  )
})

test('visual scheduler keeps the latest value for each independent slider', async () => {
  const applied = []
  const scheduler = createVisualActionScheduler((action) => applied.push(action), 5)

  scheduler.schedule({ action: 'set-content-level', value: 0.2 })
  scheduler.schedule({ action: 'set-zoom', value: 1.2 })
  scheduler.schedule({ action: 'set-content-level', value: 0.4 })
  await new Promise((resolve) => setTimeout(resolve, 15))

  assert.deepEqual(applied, [
    { action: 'set-content-level', value: 0.4 },
    { action: 'set-zoom', value: 1.2 }
  ])
})

test('leave watcher switches to reentry mode only while the body is hidden', async () => {
  const armed = ref(true)
  const revealArmed = ref(false)
  const enabledModes = []
  const reveals = []
  let epoch = 0
  const watcher = useStealthWindowLeaveWatcher({
    armed,
    revealArmed,
    readingTargetKey: ref('home:none:normal'),
    canHideIgnoringFocus: ref(true),
    requestBodyHideForWindowLeave: async () => ({ ok: true }),
    requestBodyReveal: async (reason) => {
      reveals.push(reason)
      return { ok: true }
    },
    api: {
      async windowEnableStealthLeaveWatcher({ mode }) {
        enabledModes.push(mode)
        return { ok: true, watcherEpoch: ++epoch, mode }
      },
      async windowDisableStealthLeaveWatcher() {
        return { ok: true }
      }
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(watcher.currentWatcherMode.value, 'leave')

  revealArmed.value = true
  armed.value = false
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(watcher.currentWatcherMode.value, 'reentry')
  await watcher.handleWindowReentered({
    watcherEpoch: watcher.currentWatcherEpoch.value,
    edge: 'top'
  })

  assert.deepEqual(enabledModes, ['leave', 'reentry'])
  assert.deepEqual(reveals, ['window-reenter-top'])
  watcher.dispose()
})

test('leave watcher forwards the pointer-follow reveal region', async () => {
  const enabled = []
  const watcher = useStealthWindowLeaveWatcher({
    armed: ref(false),
    revealArmed: ref(true),
    revealRegion: ref(STEALTH_REVEAL_REGION_WINDOW),
    readingTargetKey: ref('file:txt:normal'),
    canHideIgnoringFocus: ref(false),
    requestBodyHideForWindowLeave: async () => ({ ok: true }),
    api: {
      async windowEnableStealthLeaveWatcher(payload) {
        enabled.push(payload)
        return { ok: true, watcherEpoch: 1, ...payload }
      },
      async windowDisableStealthLeaveWatcher() {
        return { ok: true }
      }
    }
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(enabled, [{ mode: 'reentry', revealRegion: 'window' }])
  assert.equal(watcher.currentWatcherRevealRegion.value, 'window')
  watcher.dispose()
})
