import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canConfirmChapterNavigationLocation,
  hrefForChapterRelocation,
  isChapterNavigationSettled
} from '../src/renderer/src/components/epubChapterNavigationHelpers.js'

test('a menu chapter target ignores a same-section location until its anchor is aligned', () => {
  const target = {
    awaitsLocationConfirmation: true,
    layoutAligned: false,
    locationConfirmed: false
  }

  assert.equal(isChapterNavigationSettled(target), false)
  assert.equal(canConfirmChapterNavigationLocation(target), false)

  // An old relocated callback for the previously visible fragment is not a
  // confirmation because the new menu target has not been aligned yet.
  if (canConfirmChapterNavigationLocation(target)) target.locationConfirmed = true
  assert.equal(target.locationConfirmed, false)

  target.layoutAligned = true
  assert.equal(canConfirmChapterNavigationLocation(target), true)
  target.locationConfirmed = true
  assert.equal(isChapterNavigationSettled(target), true)
})

test('a relocated location keeps the exact logical chapter href when geometry has no TOC match', () => {
  assert.equal(
    hrefForChapterRelocation({
      activeTocItem: null,
      currentChapterTarget: {
        href: 'text/book.xhtml#chapter-14',
        canonicalHref: 'text/book.xhtml'
      },
      canonicalHref: 'text/book.xhtml',
      locationHref: 'text/book.xhtml'
    }),
    'text/book.xhtml#chapter-14'
  )
})
