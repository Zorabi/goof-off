import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dialog } from 'electron'
import { fileAccessFailure } from './fileAccessFailure.js'
import { normalizeEpubPrefs, sanitizeEpubPrefsPatch } from './preferencesModel.js'

const MAX_SIZE = 100 * 1024 * 1024
const LRU_MAX = 200
const DEBOUNCE_MS = 500

export function createEpubService(store, persist = null) {
  const persistFn = persist || ((key, value) => store.set(key, value))
  let debounceTimer = null
  let pendingProgress = null
  let maintenanceGeneration = 0

  function isMaintenanceStale(generation) {
    return generation !== maintenanceGeneration
  }

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

  function debouncedPersist(key, value) {
    pendingProgress = { key, value }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      persistFn(key, value)
      debounceTimer = null
      pendingProgress = null
    }, DEBOUNCE_MS)
  }

  async function open(filePath, generation = maintenanceGeneration) {
    const absPath = path.resolve(filePath)
    if (path.extname(absPath).toLowerCase() !== '.epub') {
      return { ok: false, reason: 'invalid-type', message: '仅支持 .epub 文件' }
    }

    let stat
    try {
      stat = await fsp.stat(absPath)
    } catch (error) {
      return fileAccessFailure(error)
    }
    if (isMaintenanceStale(generation)) return maintenanceResetOpenResult()
    if (!stat.isFile()) {
      return { ok: false, reason: 'not-file', message: '请拖入单个文件' }
    }

    if (stat.size > MAX_SIZE) {
      return { ok: false, error: '文件超过 100MB 限制' }
    }

    let buffer
    try {
      buffer = await fsp.readFile(absPath)
    } catch (error) {
      return fileAccessFailure(error)
    }
    if (isMaintenanceStale(generation)) return maintenanceResetOpenResult()

    const fileId = computeFileId(absPath, stat)
    const displayName = path.basename(absPath, path.extname(absPath))
    const allProgress = store.get('epubProgress') || {}
    const savedProgress = allProgress[fileId] || null

    return {
      ok: true,
      path: absPath,
      data: {
        arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        fileId,
        displayName,
        savedProgress
      }
    }
  }

  async function openDialog() {
    const generation = maintenanceGeneration
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
      properties: ['openFile']
    })
    if (isMaintenanceStale(generation)) return maintenanceResetOpenResult()
    if (canceled || !filePaths.length) return { ok: false, error: 'canceled' }
    return open(filePaths[0], generation)
  }

  function getProgress(fileId) {
    const all = store.get('epubProgress') || {}
    return all[fileId] || null
  }

  function saveProgress(fileId, patch) {
    const all = { ...(store.get('epubProgress') || {}), ...(pendingProgress?.value || {}) }
    all[fileId] = { ...all[fileId], ...patch, lastOpenedAt: Date.now() }

    if (Object.keys(all).length > LRU_MAX) {
      const sorted = Object.entries(all).sort((a, b) => a[1].lastOpenedAt - b[1].lastOpenedAt)
      const toRemove = sorted.slice(0, sorted.length - LRU_MAX)
      for (const [key] of toRemove) delete all[key]
    }

    debouncedPersist('epubProgress', all)
  }

  function getPrefs() {
    return normalizeEpubPrefs(store.get('epubPrefs'))
  }

  function setPrefs(patch) {
    const current = getPrefs()
    const clean = sanitizeEpubPrefsPatch(patch, current)
    const merged = normalizeEpubPrefs({ ...current, ...clean })
    store.set('epubPrefs', merged)
    return merged
  }

  function flushPending() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
      if (pendingProgress) {
        persistFn(pendingProgress.key, pendingProgress.value)
        pendingProgress = null
      }
    }
  }

  function discardPendingProgress() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
    pendingProgress = null
  }

  function resetForMaintenance() {
    maintenanceGeneration += 1
    discardPendingProgress()
    return { ok: true }
  }

  return {
    open,
    openDialog,
    getProgress,
    saveProgress,
    flushPending,
    getPrefs,
    setPrefs,
    resetForMaintenance
  }
}
