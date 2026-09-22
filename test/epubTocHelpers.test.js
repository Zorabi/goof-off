import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findActiveNode,
  findActiveTocItemByViewport
} from '../src/renderer/src/components/epubTocHelpers.js'

const toc = [
  { id: 'chapter-13', href: 'text/book.xhtml#chapter-13', subitems: [] },
  { id: 'chapter-14', href: 'text/book.xhtml#chapter-14', subitems: [] },
  { id: 'chapter-15', href: 'text/next.xhtml', subitems: [] }
]

test('TOC selection distinguishes fragment chapters in the same spine section', () => {
  assert.equal(findActiveNode(toc, 'text/book.xhtml#chapter-14'), 'chapter-14')
})

test('TOC selection falls back to the first item in a matching spine section', () => {
  assert.equal(findActiveNode(toc, 'text/book.xhtml'), 'chapter-13')
})

test('active TOC item is selected in viewport coordinates after reflow', () => {
  const positions = new Map([
    ['chapter-13', -420],
    ['chapter-14', 58],
    ['chapter-15', 640]
  ])

  assert.equal(
    findActiveTocItemByViewport(toc, 60, (item) => positions.get(item.id)).id,
    'chapter-14'
  )
})

test('missing anchor positions do not replace the current logical chapter', () => {
  const positions = new Map([
    ['chapter-13', -420],
    ['chapter-14', 58]
  ])

  assert.equal(
    findActiveTocItemByViewport(toc, 60, (item) => positions.get(item.id) ?? null).id,
    'chapter-14'
  )
})
