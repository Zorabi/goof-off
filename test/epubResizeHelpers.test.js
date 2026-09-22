import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampScrollOffset,
  scrollOffsetForViewportAnchor
} from '../src/renderer/src/components/epubResizeHelpers.js'

test('viewport anchor keeps the same element offset after text reflow', () => {
  // Before reflow, the element is 60px below the viewport top. Reflow moves
  // that same DOM element from y=560 to y=700 within its iframe.
  const nextScrollTop = scrollOffsetForViewportAnchor(500, 700, 500, -60)

  assert.equal(nextScrollTop, 640)
  assert.equal(700 - nextScrollTop, 60)
})

test('restored scroll offsets are clamped to the new scrollable range', () => {
  assert.equal(clampScrollOffset(640, 900, 300), 600)
  assert.equal(clampScrollOffset(-1, 900, 300), 0)
})
