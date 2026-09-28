import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canConfirmChapterNavigationLocation,
  findAdjacentTocNavigationTarget,
  flattenTocNavigationTargets,
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

test('chapter navigation follows TOC fragment targets in reading order', () => {
  const toc = [
    { href: 'text/book.xhtml#chapter-1' },
    {
      href: 'text/book.xhtml#chapter-2',
      subitems: [{ href: 'text/book.xhtml#chapter-3' }]
    },
    { href: 'text/next.xhtml' }
  ]
  const canonical = (href) => `book://${href}`
  const targets = flattenTocNavigationTargets(toc, canonical)

  assert.deepEqual(
    targets.map((target) => target.href),
    [
      'text/book.xhtml#chapter-1',
      'text/book.xhtml#chapter-2',
      'text/book.xhtml#chapter-3',
      'text/next.xhtml'
    ]
  )
  assert.equal(
    findAdjacentTocNavigationTarget(targets, 'text/book.xhtml#chapter-2', 'next', canonical)?.href,
    'text/book.xhtml#chapter-3'
  )
  assert.equal(
    findAdjacentTocNavigationTarget(targets, 'text/book.xhtml#chapter-2', 'prev', canonical)?.href,
    'text/book.xhtml#chapter-1'
  )
})

test('chapter navigation deduplicates identical TOC targets', () => {
  const targets = flattenTocNavigationTargets([
    { href: 'text/book.xhtml#chapter-1' },
    { href: 'text/book.xhtml#chapter-1' }
  ])

  assert.equal(targets.length, 1)
})
