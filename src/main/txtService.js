import { statSync } from 'fs'
import { resolve, extname, join } from 'path'
import { Worker } from 'worker_threads'
import { dialog } from 'electron'
import { loadFileSync, makeFileId, MAX_SIZE } from './txtLoader.js'
import store, { persistDebounced, flushPending as flushStorePending } from './store.js'
import { getMainWindow } from './windowManager.js'
import { fileAccessFailure } from './fileAccessFailure.js'
import { normalizeTxtPrefs, sanitizeTxtPrefsPatch } from './preferencesModel.js'

const LRU_MAX = 200
const WORKER_THRESHOLD = 256 * 1024

const sessionCache = new Map()
let worker = null
let requestIdCounter = 0
let latestRequestId = 0
let maintenanceOpenGeneration = 0

function maintenanceResetOpenResult() {
  return {
    ok: false,
    reason: 'maintenance-reset',
    message: '维护操作已取消文件打开'
  }
}

function getWorker() {
  if (!worker) {
    const workerPath = join(__dirname, 'txtWorker.js')
    worker = new Worker(workerPath)
    worker.on('error', () => {
      worker = null
    })
    worker.on('exit', () => {
      worker = null
    })
  }
  return worker
}

function loadAsync(filePath, opts, opId) {
  return new Promise((resolveFn) => {
    const w = getWorker()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      w.off('message', onMsg)
      w.off('error', onErr)
      w.off('exit', onExit)
      resolveFn(result)
    }
    const onMsg = (msg) => {
      if (msg.requestId !== opId) return
      finish(msg.result)
    }
    const onErr = (err) => {
      finish({ ok: false, reason: 'worker-error', message: err?.message || 'worker 异常' })
    }
    const onExit = (code) => {
      finish({ ok: false, reason: 'worker-error', message: `worker 退出 (code=${code})` })
    }
    w.on('message', onMsg)
    w.on('error', onErr)
    w.on('exit', onExit)
    w.postMessage({
      requestId: opId,
      path: filePath,
      encodingOverride: opts.encodingOverride,
      defaultEncoding: opts.defaultEncoding
    })
  })
}

function resolveEncodingOpts(fileId) {
  const progress = (store.get('txtProgress') || {})[fileId]
  const prefs = store.get('txtPrefs') || {}
  const opts = {}
  if (progress?.encoding) opts.encodingOverride = progress.encoding
  else if (prefs.defaultEncoding) opts.defaultEncoding = prefs.defaultEncoding
  return opts
}

export async function openFile(filePath) {
  const opId = ++requestIdCounter
  latestRequestId = opId

  const absPath = resolve(filePath)
  const ext = extname(absPath).toLowerCase()
  if (ext !== '.txt') {
    return { ok: false, reason: 'invalid-type', message: '仅支持 .txt 文件' }
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

  if (stat.size > MAX_SIZE) {
    return { ok: false, reason: 'too-large', message: '文件过大（>30MB），暂不支持' }
  }

  // 编码优先级：progress.encoding > BOM > defaultEncoding > auto > UTF-8
  const fileId = makeFileId(absPath, stat.size, stat.mtimeMs)
  const opts = resolveEncodingOpts(fileId)

  const result =
    stat.size > WORKER_THRESHOLD
      ? await loadAsync(absPath, opts, opId)
      : loadFileSync(absPath, opts)

  // latest-wins：同步 / worker 路径统一判断
  if (opId !== latestRequestId) {
    return { ok: false, reason: 'stale' }
  }

  if (result.ok) {
    sessionCache.set(result.data.fileId, { path: absPath, size: stat.size, mtime: stat.mtimeMs })
    return { ...result, path: absPath }
  }

  return result
}

export async function reDecode(fileId, encoding) {
  const cached = sessionCache.get(fileId)
  if (!cached) {
    return { ok: false, reason: 'not-found', message: '文件会话已过期，请重新打开' }
  }

  let stat
  try {
    stat = statSync(cached.path)
  } catch {
    return { ok: false, reason: 'not-found', message: '文件已移动或删除' }
  }

  if (stat.size !== cached.size || stat.mtimeMs !== cached.mtime) {
    return { ok: false, reason: 'stat-mismatch', message: '文件已变更，请重新打开' }
  }

  const opId = ++requestIdCounter
  latestRequestId = opId

  const opts = { encodingOverride: encoding }
  const result =
    cached.size > WORKER_THRESHOLD
      ? await loadAsync(cached.path, opts, opId)
      : loadFileSync(cached.path, opts)

  if (opId !== latestRequestId) {
    return { ok: false, reason: 'stale' }
  }

  return result
}

export function getProgress(fileId) {
  const all = store.get('txtProgress') || {}
  return all[fileId] || null
}

export function saveProgress(fileId, patch) {
  const all = { ...(store.get('txtProgress') || {}) }
  all[fileId] = { ...(all[fileId] || {}), ...patch, lastOpenedAt: Date.now() }

  const keys = Object.keys(all)
  if (keys.length > LRU_MAX) {
    const sorted = keys.sort((a, b) => (all[a].lastOpenedAt || 0) - (all[b].lastOpenedAt || 0))
    const toRemove = sorted.slice(0, keys.length - LRU_MAX)
    for (const k of toRemove) delete all[k]
  }

  persistDebounced('txtProgress', all)
}

export function flushPending() {
  flushStorePending()
}

export function getPrefs() {
  return normalizeTxtPrefs(store.get('txtPrefs'))
}

export function setPrefs(patch) {
  const current = getPrefs()
  const clean = sanitizeTxtPrefsPatch(patch, current)
  const merged = normalizeTxtPrefs({ ...current, ...clean })
  persistDebounced('txtPrefs', merged)
  return merged
}

export async function openDialog() {
  const generation = maintenanceOpenGeneration
  const win = getMainWindow()
  const result = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    properties: ['openFile']
  })

  if (generation !== maintenanceOpenGeneration) return maintenanceResetOpenResult()

  if (result.canceled || !result.filePaths.length) {
    return { ok: false, reason: 'cancelled' }
  }

  return openFile(result.filePaths[0])
}

export function getSessionCache(fileId) {
  return sessionCache.get(fileId)
}

export function resetForMaintenance() {
  sessionCache.clear()
  latestRequestId = ++requestIdCounter
  maintenanceOpenGeneration += 1
  return { ok: true }
}

export function resetForTest() {
  sessionCache.clear()
  requestIdCounter = 0
  latestRequestId = 0
  maintenanceOpenGeneration = 0
  if (worker) {
    worker.terminate()
    worker = null
  }
}
