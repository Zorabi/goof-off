const DOMAIN_LIKE_RE = /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i

export function normalizeAddressInput(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (!/\s/.test(s) && DOMAIN_LIKE_RE.test(s)) return `https://${s}`
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`
}

export function resolveAddressSubmit(input, mode = 'home') {
  const raw = String(input || '').trim()
  if (!raw) {
    return {
      kind: mode === 'web' ? 'empty-web' : 'empty-home',
      url: null,
      source: 'empty-home'
    }
  }
  const url = normalizeAddressInput(raw)
  return {
    kind: 'navigate',
    url,
    source: /\s/.test(raw) || url.includes('bing.com/search?') ? 'search' : 'typed'
  }
}

export function extractAddressDomain(input) {
  const s = String(input ?? '')
  try {
    const u = new URL(s)
    return u.host.replace(/^www\./, '')
  } catch {
    return s.slice(0, 30)
  }
}

export function displayAddressText(input, mode = 'idle') {
  if (mode === 'edit') return String(input || '')
  return extractAddressDomain(input)
}

export function displaySuggestionUrl(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    const host = url.host.replace(/^www\./, '')
    return `${host}${url.pathname || '/'}`
  } catch {
    return ''
  }
}
