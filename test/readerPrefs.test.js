import test from 'node:test'
import assert from 'node:assert/strict'

test('reader font-size writes are optimistic and latest-write-wins', async () => {
  const previousWindow = globalThis.window
  const writes = []
  let notifyTxtPrefs = null
  globalThis.window = {
    api: {
      txtGetPrefs: async () => ({
        fontSize: 16,
        lineHeight: 1.7,
        autoTurnSec: 30,
        defaultEncoding: null,
        fontFamily: 'default',
        pageKeys: { next: 'Space', prev: 'Shift+Space' }
      }),
      txtSetPrefs: (patch) =>
        new Promise((resolve) => {
          writes.push({ patch, resolve })
        }),
      onTxtPrefsChange: (callback) => {
        notifyTxtPrefs = callback
        return () => {
          notifyTxtPrefs = null
        }
      }
    }
  }

  try {
    const { bootstrapReaderPrefs, useReaderPrefs } =
      await import('../src/renderer/src/composables/useReaderPrefs.js')
    await bootstrapReaderPrefs()
    const { txtPrefs, setTxtPrefs } = useReaderPrefs()

    const first = setTxtPrefs({ fontSize: 20 })
    const second = setTxtPrefs({ fontSize: 21 })
    assert.equal(txtPrefs.value.fontSize, 21)
    assert.deepEqual(
      writes.map(({ patch }) => patch),
      [{ fontSize: 20 }, { fontSize: 21 }]
    )

    const firstResult = { ...txtPrefs.value, fontSize: 20 }
    notifyTxtPrefs(firstResult)
    writes[0].resolve(firstResult)
    await first
    assert.equal(txtPrefs.value.fontSize, 21)

    const secondResult = { ...txtPrefs.value, fontSize: 21 }
    notifyTxtPrefs(secondResult)
    writes[1].resolve(secondResult)
    await second
    assert.equal(txtPrefs.value.fontSize, 21)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
