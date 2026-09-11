import test from 'node:test'
import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { createFileOpenCoordinator } from '../src/renderer/src/composables/useFileOpenCoordinator.js'

test('concurrent main-window file dialog requests share one pending dialog', async () => {
  let resolveDialog
  let dialogCalls = 0
  const dialogResult = new Promise((resolve) => {
    resolveDialog = resolve
  })
  const appState = {
    state: reactive({ content: 'home', fileKind: null }),
    dispatch() {}
  }
  const coordinator = createFileOpenCoordinator({
    api: {
      openAnyFileDialog: async () => {
        dialogCalls += 1
        return dialogResult
      }
    },
    browser: {},
    appState,
    txt: { savePosition() {}, load() {} },
    epub: {},
    pdf: {},
    flushActiveReader: async () => {},
    stopAutoTurn() {},
    pushStatus() {}
  })

  const first = coordinator.openAnyFileFromDialog()
  const second = coordinator.openAnyFileFromDialog()
  assert.equal(first, second)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(dialogCalls, 1)

  resolveDialog({ ok: false, reason: 'cancelled' })
  const result = await first
  assert.deepEqual(result, { ok: false, reason: 'cancelled' })
})
