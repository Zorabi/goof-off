const NORMAL_KEY = 'goof-search'
const CURRENT_KEY = 'goof-search-current'
const FALLBACK_HIT_BG = 'rgba(245, 158, 11, 0.42)'
const FALLBACK_HIT_CURRENT_BG = 'rgba(217, 119, 6, 0.62)'

function resolveHostSearchToken(name, fallback) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export function injectSearchHighlightStyle(contents) {
  const doc = contents?.document
  if (!doc?.head) return
  let style = doc.head.querySelector('style[data-goof-off-search-highlight="true"]')
  if (!style) {
    style = doc.createElement('style')
    style.dataset.goofOffSearchHighlight = 'true'
    doc.head.appendChild(style)
  }
  const hitBg = resolveHostSearchToken('--color-search-hit-bg', FALLBACK_HIT_BG)
  const currentBg = resolveHostSearchToken('--color-search-hit-current-bg', FALLBACK_HIT_CURRENT_BG)
  style.textContent = `
::highlight(goof-search) {
  background-color: ${hitBg};
  color: inherit;
}
::highlight(goof-search-current) {
  background-color: ${currentBg};
  color: inherit;
}
`
}

export function clearSearchHighlights(contentsList = []) {
  for (const contents of contentsList) {
    const api = contents?.window?.CSS?.highlights
    api?.delete?.(NORMAL_KEY)
    api?.delete?.(CURRENT_KEY)
  }
}

export function applySearchHighlights(contentsList = [], { active, results, currentHitIndex }) {
  for (const contents of contentsList) {
    injectSearchHighlightStyle(contents)
    const win = contents?.window
    const api = win?.CSS?.highlights
    if (!api || typeof win.Highlight !== 'function') continue
    if (!active) {
      api.delete(NORMAL_KEY)
      api.delete(CURRENT_KEY)
      continue
    }
    const normal = new win.Highlight()
    const current = new win.Highlight()
    results.forEach((hit, index) => {
      if (hit.spineIndex !== contents.sectionIndex) return
      try {
        const range = contents.range(hit.cfi)
        if (!range) return
        if (index === currentHitIndex) current.add(range)
        else normal.add(range)
      } catch {
        /* skip invalid CFI for this rendered document */
      }
    })
    api.set(NORMAL_KEY, normal)
    api.set(CURRENT_KEY, current)
  }
}
