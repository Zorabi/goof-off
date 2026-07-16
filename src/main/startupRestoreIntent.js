import path from 'node:path'

const FILE_EXT_BY_KIND = Object.freeze({
  txt: '.txt',
  epub: '.epub',
  pdf: '.pdf'
})

const FILE_KINDS = new Set(Object.keys(FILE_EXT_BY_KIND))

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeStartupRestoreIntent(raw) {
  if (!isPlainObject(raw)) return null

  if (raw.type === 'web') {
    if (typeof raw.url !== 'string' || !raw.url.trim()) return null
    try {
      const url = new URL(raw.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
      url.protocol = url.protocol.toLowerCase()
      url.hostname = url.hostname.toLowerCase()
      if (
        (url.protocol === 'http:' && url.port === '80') ||
        (url.protocol === 'https:' && url.port === '443')
      ) {
        url.port = ''
      }
      if (!url.pathname) url.pathname = '/'
      return { type: 'web', url: url.toString() }
    } catch {
      return null
    }
  }

  if (raw.type === 'file') {
    const fileKind = raw.fileKind
    if (!FILE_KINDS.has(fileKind)) return null
    if (typeof raw.path !== 'string' || !raw.path.trim()) return null
    if (!path.isAbsolute(raw.path)) return null
    const resolvedPath = path.resolve(raw.path)
    if (path.extname(resolvedPath).toLowerCase() !== FILE_EXT_BY_KIND[fileKind]) return null
    return { type: 'file', fileKind, path: resolvedPath }
  }

  return null
}

export function sanitizeStartupRestoreIntentPayload(payload) {
  return normalizeStartupRestoreIntent(payload)
}

export const STARTUP_RESTORE_FILE_EXT_BY_KIND = FILE_EXT_BY_KIND
