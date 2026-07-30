import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { canonicalizeWebUrl } from '../shared/webUrlCanonical.js'
import { normalizeHistoryPrefs } from './preferencesModel.js'

const HISTORY_LIMIT = 100
const PENDING_FILE_TTL_MS = 5 * 60 * 1000
const VALID_FILE_KINDS = new Set(['txt', 'epub', 'pdf'])
const EXT_BY_KIND = { txt: '.txt', epub: '.epub', pdf: '.pdf' }

export function createHistoryService(store, opts = {}) {
  const now = opts.now || (() => Date.now())
  const id = opts.id || (() => randomUUID())
  // 仅网页标题落盘走防抖：page-title-updated 在聊天/视频站会高频触发。
  // 新增、删除等结构变更直写，避免多个应用实例延迟写回旧快照而丢失历史。
  const persist =
    opts.persist ||
    ((key, value, resolveValue) => {
      store.set(key, resolveValue ? resolveValue(store.get(key)) : value)
    })
  const pendingWeb = new Map()
  const pendingFiles = new Map()
  const pendingFileTimers = new Map()
  const legacyWebIds = new Map()
  const legacyFileIds = new Map()

  function getHistoryPrefs() {
    return normalizeHistoryPrefs(store.get('historyPrefs'))
  }

  function normalizeRecoverableWebUrl(input) {
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
      if (!url.pathname) url.pathname = '/'
      return url.toString()
    } catch {
      return null
    }
  }

  function getWebHistoryRaw() {
    const list = store.get('webHistory')
    return Array.isArray(list) ? list : []
  }

  function getFileHistoryRaw() {
    const list = store.get('fileHistory')
    return Array.isArray(list) ? list : []
  }

  function getLegacyId(cache, key) {
    const cached = cache.get(key)
    if (cached) return cached
    const nextId = id()
    cache.set(key, nextId)
    return nextId
  }

  function sanitizeWebItem(item) {
    if (!item || typeof item !== 'object') return null
    const key = canonicalizeWebUrl(item.key || item.url)
    const urlKey = canonicalizeWebUrl(item.url)
    const recoverableUrl = normalizeRecoverableWebUrl(item.url)
    if (!key || !urlKey || key !== urlKey) return null
    return {
      id: typeof item.id === 'string' && item.id ? item.id : getLegacyId(legacyWebIds, key),
      key,
      url: recoverableUrl || key,
      title: typeof item.title === 'string' && item.title.trim() ? item.title : null,
      lastOpenedAt: Number.isFinite(item.lastOpenedAt) ? item.lastOpenedAt : 0
    }
  }

  function sanitizeFileItem(item) {
    if (!item || typeof item !== 'object') return null
    if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) return null
    const filePath = path.resolve(item.path)
    const kind = item.kind
    if (!VALID_FILE_KINDS.has(kind)) return null
    if (path.extname(filePath).toLowerCase() !== EXT_BY_KIND[kind]) return null
    return {
      id:
        typeof item.id === 'string' && item.id
          ? item.id
          : getLegacyId(legacyFileIds, `${kind}:${filePath}`),
      path: filePath,
      name: path.basename(filePath),
      kind,
      lastOpenedAt: Number.isFinite(item.lastOpenedAt) ? item.lastOpenedAt : 0
    }
  }

  function trimAndSort(items) {
    return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, HISTORY_LIMIT)
  }

  function dedupeWebItems(items) {
    const sorted = items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    const seen = new Set()
    const deduped = []
    for (const item of sorted) {
      if (seen.has(item.key)) continue
      seen.add(item.key)
      deduped.push(item)
    }
    return deduped.slice(0, HISTORY_LIMIT)
  }

  function list() {
    return {
      web: dedupeWebItems(getWebHistoryRaw().map(sanitizeWebItem).filter(Boolean)),
      files: trimAndSort(getFileHistoryRaw().map(sanitizeFileItem).filter(Boolean))
    }
  }

  function saveWeb(items) {
    store.set('webHistory', dedupeWebItems(items))
  }

  function saveWebTitle(items, updatedItem) {
    persist('webHistory', dedupeWebItems(items), (latest) => {
      const current = dedupeWebItems(
        (Array.isArray(latest) ? latest : []).map(sanitizeWebItem).filter(Boolean)
      )
      const target = current.find(
        (item) => item.key === updatedItem.key && item.id === updatedItem.id
      )
      if (target) target.title = updatedItem.title
      return current
    })
  }

  function saveFiles(items) {
    store.set('fileHistory', trimAndSort(items))
  }

  function upsertWeb({ url, title }) {
    if (!getHistoryPrefs().recordWeb) return { ok: true }
    const key = canonicalizeWebUrl(url)
    const recoverableUrl = normalizeRecoverableWebUrl(url)
    if (!key) return { ok: false, reason: 'invalid-url' }
    const items = list().web.filter((item) => item.key !== key)
    const item = {
      id: id(),
      key,
      url: recoverableUrl || key,
      title: typeof title === 'string' && title.trim() ? title : null,
      lastOpenedAt: now()
    }
    saveWeb([item, ...items])
    return { ok: true, item }
  }

  function createPendingWeb(url) {
    const key = canonicalizeWebUrl(url)
    if (!key) return null
    const pendingKey = id()
    pendingWeb.set(pendingKey, {
      requestedKey: key,
      requestedUrl: String(url),
      noRecord: !getHistoryPrefs().recordWeb
    })
    return pendingKey
  }

  function commitPendingWeb({ pendingKey, finalUrl, title }) {
    const pending = pendingWeb.get(pendingKey)
    pendingWeb.delete(pendingKey)
    if (!pending) {
      if (!getHistoryPrefs().recordWeb) return { ok: true }
      return { ok: false, reason: 'invalid-token' }
    }
    if (pending?.noRecord || !getHistoryPrefs().recordWeb) return { ok: true }
    const finalKey = canonicalizeWebUrl(finalUrl)
    if (!finalKey) return { ok: false, reason: 'invalid-url' }
    if (pending.requestedKey !== finalKey) {
      saveWeb(list().web.filter((item) => item.key !== pending.requestedKey))
    }
    return upsertWeb({ url: finalUrl, title })
  }

  function updateCurrentWebTitle({ url, title }) {
    if (!getHistoryPrefs().recordWeb) return { ok: true }
    const key = canonicalizeWebUrl(url)
    if (!key) return { ok: false, reason: 'invalid-url' }
    const items = list().web
    const target = items.find((item) => item.key === key)
    if (!target) return { ok: false, reason: 'not-found' }
    target.title = typeof title === 'string' && title.trim() ? title : target.title
    saveWebTitle(items, target)
    return { ok: true }
  }

  function clearWeb() {
    store.set('webHistory', [])
    return { ok: true }
  }

  function clearFiles() {
    store.set('fileHistory', [])
    return { ok: true }
  }

  function removeWeb(itemId) {
    const current = list().web
    const next = current.filter((item) => item.id !== itemId)
    if (next.length !== current.length) saveWeb(next)
    return { ok: true }
  }

  function removeFile(itemId) {
    const current = list().files
    const next = current.filter((item) => item.id !== itemId)
    if (next.length !== current.length) saveFiles(next)
    return { ok: true }
  }

  function isValidFileKindPath(filePath, kind) {
    if (!VALID_FILE_KINDS.has(kind)) return false
    if (typeof filePath !== 'string' || !filePath.trim()) return false
    if (!path.isAbsolute(filePath)) return false
    return path.extname(filePath).toLowerCase() === EXT_BY_KIND[kind]
  }

  function upsertFile({ path: filePath, kind }) {
    if (!isValidFileKindPath(filePath, kind)) return { ok: false, reason: 'invalid-file' }
    if (!getHistoryPrefs().recordFiles) return { ok: true }
    const absPath = path.resolve(filePath)
    const items = list().files.filter((item) => item.path !== absPath)
    const item = {
      id: id(),
      path: absPath,
      name: path.basename(absPath),
      kind,
      lastOpenedAt: now()
    }
    saveFiles([item, ...items])
    return { ok: true, item }
  }

  function commitTxtFile({ path: filePath, kind }) {
    if (kind !== 'txt') return { ok: false, reason: 'invalid-kind' }
    return upsertFile({ path: filePath, kind })
  }

  function beginPendingFile({ path: filePath, kind }) {
    if (!isValidFileKindPath(filePath, kind)) return { ok: false, reason: 'invalid-file' }
    const absPath = path.resolve(filePath)
    const token = id()
    pendingFiles.set(token, {
      path: absPath,
      kind,
      createdAt: now(),
      noRecord: !getHistoryPrefs().recordFiles
    })
    const timer = setTimeout(() => {
      pendingFiles.delete(token)
      pendingFileTimers.delete(token)
    }, PENDING_FILE_TTL_MS)
    timer.unref?.()
    pendingFileTimers.set(token, timer)
    return { ok: true, token }
  }

  function deletePendingFile(token) {
    pendingFiles.delete(token)
    const timer = pendingFileTimers.get(token)
    if (timer) clearTimeout(timer)
    pendingFileTimers.delete(token)
  }

  function consumePendingFile(token) {
    const pending = pendingFiles.get(token)
    if (!pending) return null
    deletePendingFile(token)
    if (now() - pending.createdAt > PENDING_FILE_TTL_MS) return null
    return pending
  }

  function commitPendingFile(token) {
    const pending = consumePendingFile(token)
    if (!pending) return { ok: false, reason: 'invalid-token', message: '历史提交已过期' }
    if (pending.noRecord || !getHistoryPrefs().recordFiles) return { ok: true }
    const result = upsertFile({ path: pending.path, kind: pending.kind })
    if (!result.ok) return result
    return { ok: true }
  }

  function validateHistoryFile({ path: filePath, kind }) {
    if (!isValidFileKindPath(filePath, kind)) {
      return { ok: false, reason: 'invalid-file', message: '文件不可用' }
    }
    const absPath = path.resolve(filePath)
    const found = list().files.find((item) => item.path === absPath && item.kind === kind)
    if (!found) return { ok: false, reason: 'not-in-history', message: '文件不可用' }
    return { ok: true, path: absPath, kind }
  }

  function discardPendingFile(token) {
    deletePendingFile(token)
    return { ok: true }
  }

  function clearPending() {
    pendingWeb.clear()
    pendingFiles.clear()
    for (const timer of pendingFileTimers.values()) clearTimeout(timer)
    pendingFileTimers.clear()
    return { ok: true }
  }

  return {
    canonicalizeWebUrl,
    list,
    upsertWeb,
    createPendingWeb,
    commitPendingWeb,
    updateCurrentWebTitle,
    clearWeb,
    clearFiles,
    removeWeb,
    removeFile,
    beginPendingFile,
    commitPendingFile,
    discardPendingFile,
    clearPending,
    commitTxtFile,
    validateHistoryFile,
    _pendingFiles: pendingFiles,
    _constants: { PENDING_FILE_TTL_MS, EXT_BY_KIND }
  }
}
