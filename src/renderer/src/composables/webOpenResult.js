export function normalizeWebStateUrl(input) {
  try {
    const next = new URL(String(input || ''))
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return null
    return next.toString()
  } catch {
    return null
  }
}

export function shouldEnterWebState(result) {
  return result?.ok === true || result?.reason === 'load-error' || result?.reason === 'cancelled'
}

export function resolveWebStateUrl(result, fallbackUrl) {
  return result?.url || fallbackUrl
}

export function urlsEqual(a, b) {
  if (!a || !b) return false
  try {
    return new URL(a).toString() === new URL(b).toString()
  } catch {
    return a === b
  }
}
