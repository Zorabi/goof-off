const GLOBAL_NOISE_QUERY_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid'
])
const BING_NOISE_QUERY_PARAMS = new Set(['rdr', 'rdrig'])

function isBingHost(hostname) {
  return hostname === 'bing.com' || hostname.endsWith('.bing.com')
}

function isNoiseQueryParam(name, hostname) {
  const key = String(name || '').toLowerCase()
  if (!key) return false
  if (key.startsWith('utm_')) return true
  if (GLOBAL_NOISE_QUERY_PARAMS.has(key)) return true
  return isBingHost(hostname) && BING_NOISE_QUERY_PARAMS.has(key)
}

function decodeQueryParamName(rawName) {
  try {
    return decodeURIComponent(String(rawName || '').replace(/\+/g, ' '))
  } catch {
    return rawName
  }
}

function getRawQueryParamName(part) {
  const separatorIndex = part.indexOf('=')
  return separatorIndex >= 0 ? part.slice(0, separatorIndex) : part
}

function stripNoiseQueryParams(url) {
  if (!url.search) return
  const parts = url.search.slice(1).split('&')
  const filtered = parts.filter(
    (part) => !isNoiseQueryParam(decodeQueryParamName(getRawQueryParamName(part)), url.hostname)
  )
  if (filtered.length === parts.length) return
  url.search = filtered.length > 0 ? `?${filtered.join('&')}` : ''
}

function stripTrailingPathSlash(canonicalUrl) {
  try {
    const url = new URL(canonicalUrl)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
    }
    return url.toString()
  } catch {
    return canonicalUrl
  }
}

export function canonicalizeWebUrl(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = ''
    }
    url.hash = ''
    stripNoiseQueryParams(url)
    if (!url.pathname) url.pathname = '/'
    return url.toString()
  } catch {
    return null
  }
}

export function webUrlsMatch(a, b) {
  const left = canonicalizeWebUrl(a)
  const right = canonicalizeWebUrl(b)
  if (!left || !right) return false
  if (left === right) return true
  return stripTrailingPathSlash(left) === stripTrailingPathSlash(right)
}
