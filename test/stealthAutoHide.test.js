import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive, ref } from 'vue'
import { useStealthAutoHide } from '../src/renderer/src/composables/useStealthAutoHide.js'

function createHarness(overrides = {}) {
  const passthroughCalls = []
  const api = {
    platformPolicy: {
      window: { stealthAutoHide: { bodyFade: true, bodyClickThrough: true } }
    },
    async windowSetMousePassthrough({ enabled }) {
      passthroughCalls.push(enabled)
      return { ok: true, enabled }
    },
    async browserSetStealthContentOpacityMultiplier() {
      return { ok: true }
    },
    ...overrides.api
  }
  const service = useStealthAutoHide({
    appState: reactive({ content: 'home', fileKind: null, form: 'normal', hidden: false }),
    transparencyPrefs: ref({ windowEnabled: true }),
    api,
    pushStatus() {},
    logDiagnostic() {}
  })
  return { service, passthroughCalls }
}

test('home screen participates in toolbar and body auto-hide', async () => {
  const { service } = createHarness()

  assert.deepEqual(service.setBodyAutoHideEnabled(true), { ok: true })
  assert.equal(service.canWindowLeaveHideBody.value, true)
  assert.equal((await service.requestBodyHideForWindowLeave()).ok, true)
  assert.equal(service.bodyHidden.value, true)
})

test('click-through failure restores the body instead of leaving an input shield', async () => {
  const { service } = createHarness({
    api: {
      async windowSetMousePassthrough({ enabled }) {
        return enabled ? { ok: false, reason: 'test-failure' } : { ok: true, enabled }
      }
    }
  })

  service.setBodyAutoHideEnabled(true)
  const result = await service.requestBodyHideForWindowLeave()

  assert.equal(result.ok, false)
  assert.equal(service.bodyHidden.value, false)
  assert.equal(service.bodyOpacityMultiplier.value, 1)
  assert.equal(service.bodyAutoHideEnabled.value, false)
  assert.equal(service.toolbarAutoHideEnabled.value, true)
})

test('failed input restoration keeps a marker so later activity retries', async () => {
  let restoreAttempts = 0
  const { service } = createHarness({
    api: {
      async windowSetMousePassthrough({ enabled }) {
        if (enabled) return { ok: true, enabled: true }
        restoreAttempts += 1
        return restoreAttempts === 1
          ? { ok: false, reason: 'test-restore-failure' }
          : { ok: true, enabled: false }
      }
    }
  })

  service.setBodyAutoHideEnabled(true)
  await service.requestBodyHideForWindowLeave()
  const firstRestore = await service.restoreStealthInteraction('test')

  assert.equal(firstRestore.ok, false)
  assert.equal(service.mousePassthroughActive.value, true)
  service.notifyActivity('retry')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(restoreAttempts, 2)
  assert.equal(service.mousePassthroughActive.value, false)
})
