export function isAllowedProtocol(url) {
  try {
    const u = new URL(String(url ?? ''))
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
