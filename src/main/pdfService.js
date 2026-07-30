import { createHash } from 'node:crypto'
import { statSync, createReadStream, accessSync, constants } from 'node:fs'
import { Readable } from 'node:stream'
import { resolve, extname, basename } from 'node:path'
import { dialog } from 'electron'
import store, { persistDebounced } from './store.js'
import { getMainWindow } from './windowManager.js'
import { fileAccessFailure } from './fileAccessFailure.js'
import { normalizePdfPrefs, sanitizePdfPrefsPatch } from './preferencesModel.js'

const MAX_SIZE = 500 * 1024 * 1024
const LRU_MAX = 200

export function createPdfService() {
  const openSessions = new Map()
  // 会话代数：与 epubService 相同的竞态防线 —— 过期 token 的 close 不得释放重开后的新会话。
  let sessionSeq = 0
  let pendingProgress = null
  let maintenanceGeneration = 0

  function maintenanceResetOpenResult() {
    return {
      ok: false,
      reason: 'maintenance-reset',
      message: '维护操作已取消文件打开'
    }
  }

  function computeFileId(filePath, stat) {
    const raw = `${filePath}|${stat.size}|${stat.mtimeMs}`
    return createHash('sha1').update(raw).digest('hex')
  }

  function open(filePath) {
    const absPath = resolve(filePath)
    const ext = extname(absPath).toLowerCase()
    if (ext !== '.pdf') {
      return { ok: false, reason: 'invalid-type', message: '仅支持 .pdf 文件' }
    }

    let stat
    try {
      stat = statSync(absPath)
    } catch (error) {
      return fileAccessFailure(error)
    }

    if (!stat.isFile()) {
      return { ok: false, reason: 'not-file', message: '请拖入单个文件' }
    }

    try {
      accessSync(absPath, constants.R_OK)
    } catch (error) {
      return fileAccessFailure(error)
    }

    if (stat.size > MAX_SIZE) {
      return { ok: false, reason: 'too-large', message: '文件过大（>500MB），暂不支持' }
    }

    const fileId = computeFileId(absPath, stat)
    const displayName = basename(absPath, ext)
    const sessionToken = ++sessionSeq
    openSessions.set(fileId, { path: absPath, sizeBytes: stat.size, token: sessionToken })

    const savedProgress = getProgress(fileId)

    return {
      ok: true,
      path: absPath,
      data: { fileId, displayName, sizeBytes: stat.size, sessionToken, savedProgress }
    }
  }

  async function openDialog() {
    const generation = maintenanceGeneration
    const win = getMainWindow()
    const opts = {
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile']
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(win, opts)
    if (generation !== maintenanceGeneration) return maintenanceResetOpenResult()
    if (canceled || !filePaths.length) return { ok: false, reason: 'cancelled' }
    return open(filePaths[0])
  }

  function resolveSession(fileId) {
    return openSessions.get(fileId) || null
  }

  function releaseSession(fileId, sessionToken) {
    const session = openSessions.get(fileId)
    if (!session) return
    if (sessionToken !== undefined && session.token !== sessionToken) return
    openSessions.delete(fileId)
  }

  function clearSessions() {
    openSessions.clear()
  }

  function resetForMaintenance() {
    maintenanceGeneration += 1
    clearSessions()
    pendingProgress = null
    return { ok: true }
  }

  function saveProgress(fileId, patch) {
    const all = pendingProgress ? { ...pendingProgress } : { ...(store.get('pdfProgress') || {}) }

    all[fileId] = { ...(all[fileId] || {}), ...patch, lastOpenedAt: Date.now() }

    const keys = Object.keys(all)
    if (keys.length > LRU_MAX) {
      const sorted = keys.sort((a, b) => (all[a].lastOpenedAt || 0) - (all[b].lastOpenedAt || 0))
      sorted.slice(0, keys.length - LRU_MAX).forEach((k) => delete all[k])
    }

    pendingProgress = all
    persistDebounced('pdfProgress', all)
  }

  function getProgress(fileId) {
    if (pendingProgress && pendingProgress[fileId]) return pendingProgress[fileId]
    const all = store.get('pdfProgress') || {}
    return all[fileId] || null
  }

  function getPrefs() {
    return normalizePdfPrefs(store.get('pdfPrefs'))
  }

  function setPrefs(patch) {
    const current = getPrefs()
    const clean = sanitizePdfPrefsPatch(patch)
    const merged = normalizePdfPrefs({ ...current, ...clean })
    persistDebounced('pdfPrefs', merged)
    return merged
  }

  function flushPending() {
    if (pendingProgress) {
      store.set('pdfProgress', pendingProgress)
      pendingProgress = null
    }
  }

  function serve(session, rangeHeader) {
    const { path: filePath, sizeBytes } = session

    if (!rangeHeader) {
      const webStream = Readable.toWeb(createReadStream(filePath))
      return new Response(webStream, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(sizeBytes),
          'Accept-Ranges': 'bytes'
        }
      })
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
    if (!match) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${sizeBytes}` }
      })
    }

    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : sizeBytes - 1

    if (start >= sizeBytes || end >= sizeBytes || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${sizeBytes}` }
      })
    }

    const segLen = end - start + 1
    const webStream = Readable.toWeb(createReadStream(filePath, { start, end }))
    return new Response(webStream, {
      status: 206,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(segLen),
        'Content-Range': `bytes ${start}-${end}/${sizeBytes}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }

  function bindMainWindow(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.on('render-process-gone', () => clearSessions())
    mainWindow.webContents.on('destroyed', () => clearSessions())
  }

  return {
    open,
    openDialog,
    resolveSession,
    releaseSession,
    clearSessions,
    resetForMaintenance,
    saveProgress,
    getProgress,
    getPrefs,
    setPrefs,
    flushPending,
    serve,
    bindMainWindow
  }
}
