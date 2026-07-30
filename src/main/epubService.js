import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { dialog } from 'electron'
import { fileAccessFailure } from './fileAccessFailure.js'
import { normalizeEpubPrefs, sanitizeEpubPrefsPatch } from './preferencesModel.js'

const MAX_SIZE = 100 * 1024 * 1024
const LRU_MAX = 200
const DEBOUNCE_MS = 500
// locations 索引缓存（epub.js locations.save() 的 JSON 串）：fileId 已含 path|size|mtime 哈希，
// 文件变动自动失效；存独立文件而非 electron-store，避免撑大配置文件。
const LOCATIONS_FILE_ID_RE = /^[a-f0-9]{40}$/
const LOCATIONS_MAX_BYTES = 5 * 1024 * 1024
const LOCATIONS_MAX_FILES = LRU_MAX

export function createEpubService(store, persist = null, opts = {}) {
  const persistFn = persist || ((key, value) => store.set(key, value))
  const locationsDir = typeof opts.locationsDir === 'string' ? opts.locationsDir : null
  // 同一 fileId 的并发 open 各自持有 token，避免迟到注册覆盖已开始加载的会话。
  const openSessions = new Map()
  const inFlightLocationTasks = new Set()
  // 会话代数：close 请求经渲染进程往返，可能晚于同一 fileId 的重新 open 到达；
  // 带过期 token 的 close 不得释放重新注册的新会话（快速重复打开同一本书的竞态）。
  let sessionSeq = 0
  let debounceTimer = null
  let pendingProgress = null
  let maintenanceGeneration = 0
  let locationsResetPromise = null
  // 本代数内 open 过的 fileId：locations 回存必然发生在同一次 open 之后，
  // 而回存请求经渲染进程 requestIdleCallback（最长 2s）+ 独立 IPC 队列往返，
  // 可能晚于维护重置落地。维护重置清空本集合，使迟到的回存无处归属而被拒，
  // 否则它会重建刚被删掉的缓存目录（saveLocations 内有 mkdir recursive）。
  let generationFileIds = new Set()

  function locationsFilePath(fileId) {
    if (!locationsDir || !LOCATIONS_FILE_ID_RE.test(String(fileId || ''))) return null
    return path.join(locationsDir, `${fileId}.json`)
  }

  async function getLocations(fileId) {
    const filePath = locationsFilePath(fileId)
    if (!filePath) return null
    try {
      const json = await fsp.readFile(filePath, 'utf8')
      return json.length <= LOCATIONS_MAX_BYTES ? json : null
    } catch {
      return null
    }
  }

  function trackLocationTask(task) {
    inFlightLocationTasks.add(task)
    task.then(
      () => inFlightLocationTasks.delete(task),
      () => inFlightLocationTasks.delete(task)
    )
    return task
  }

  async function waitForLocationTasks() {
    while (inFlightLocationTasks.size > 0) {
      await Promise.allSettled([...inFlightLocationTasks])
    }
  }

  async function saveLocations(fileId, locations) {
    const filePath = locationsFilePath(fileId)
    if (!filePath) return { ok: false, reason: 'invalid-file-id' }
    if (
      typeof locations !== 'string' ||
      locations.length === 0 ||
      locations.length > LOCATIONS_MAX_BYTES
    ) {
      return { ok: false, reason: 'invalid-locations' }
    }
    if (locationsResetPromise) return { ok: false, reason: 'maintenance-reset' }
    // 维护重置之后到达的迟到回存：locationsResetPromise 已被清回 null，
    // 只能靠 fileId 是否属于本代数来识别。
    if (!generationFileIds.has(fileId)) return { ok: false, reason: 'maintenance-reset' }

    const saveTask = trackLocationTask(
      (async () => {
        try {
          await fsp.mkdir(locationsDir, { recursive: true })
          await fsp.writeFile(filePath, locations, 'utf8')
        } catch {
          return { ok: false, reason: 'write-failed' }
        }
        return { ok: true }
      })()
    )
    const result = await saveTask
    if (result.ok && !locationsResetPromise) {
      trackLocationTask(pruneLocations().catch(() => {}))
    }
    return result
  }

  async function pruneLocations() {
    const entries = (await fsp.readdir(locationsDir)).filter((name) => name.endsWith('.json'))
    if (entries.length <= LOCATIONS_MAX_FILES) return
    const stats = await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(locationsDir, name)
        try {
          return { filePath, mtimeMs: (await fsp.stat(filePath)).mtimeMs }
        } catch {
          return null
        }
      })
    )
    const sorted = stats.filter(Boolean).sort((a, b) => a.mtimeMs - b.mtimeMs)
    const excess = sorted.slice(0, Math.max(0, sorted.length - LOCATIONS_MAX_FILES))
    await Promise.all(excess.map(({ filePath }) => fsp.unlink(filePath).catch(() => {})))
  }

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

    // fsp.access 探不到 Windows 共享锁与部分 ACL 拒绝：实际打开读句柄验证可读性，
    // 否则要到渲染进程流式拉取阶段才失败，被误报成「文件无法解析」。
    let probeHandle
    try {
      probeHandle = await fsp.open(absPath, 'r')
    } catch (error) {
      return fileAccessFailure(error)
    }
    await probeHandle.close().catch(() => {})
    if (isMaintenanceStale(generation)) return maintenanceResetOpenResult()

    const fileId = computeFileId(absPath, stat)
    const displayName = path.basename(absPath, path.extname(absPath))
    const allProgress = store.get('epubProgress') || {}
    const savedProgress = allProgress[fileId] || null

    // 不再整本读入 + 复制 + IPC 传输：登记会话后由 goof-off-epub 协议流式供给渲染进程。
    const sessionToken = ++sessionSeq
    generationFileIds.add(fileId)
    let sessions = openSessions.get(fileId)
    if (!sessions) {
      sessions = new Map()
      openSessions.set(fileId, sessions)
    }
    sessions.set(sessionToken, { path: absPath, sizeBytes: stat.size, token: sessionToken })

    return {
      ok: true,
      path: absPath,
      data: {
        fileId,
        displayName,
        sizeBytes: stat.size,
        sessionToken,
        savedProgress
      }
    }
  }

  function resolveSession(fileId, sessionToken) {
    const sessions = openSessions.get(fileId)
    if (!sessions) return null
    if (sessionToken !== undefined) return sessions.get(sessionToken) || null

    let latest = null
    for (const session of sessions.values()) latest = session
    return latest
  }

  function releaseSession(fileId, sessionToken) {
    const sessions = openSessions.get(fileId)
    if (!sessions) return
    if (sessionToken === undefined) {
      openSessions.delete(fileId)
      return
    }
    sessions.delete(sessionToken)
    if (sessions.size === 0) openSessions.delete(fileId)
  }

  function clearSessions() {
    openSessions.clear()
  }

  function serve(session) {
    const webStream = Readable.toWeb(createReadStream(session.path))
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/epub+zip',
        'Content-Length': String(session.sizeBytes)
      }
    })
  }

  function bindMainWindow(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.on('render-process-gone', () => clearSessions())
    mainWindow.webContents.on('destroyed', () => clearSessions())
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
    // 排版滑块每 tick 调一次，落盘走防抖（persistFn 默认即 persistDebounced）。
    persistFn('epubPrefs', merged)
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

  async function resetForMaintenance() {
    maintenanceGeneration += 1
    generationFileIds = new Set()
    discardPendingProgress()
    clearSessions()
    if (!locationsDir) return { ok: true }
    if (locationsResetPromise) return locationsResetPromise

    locationsResetPromise = (async () => {
      await waitForLocationTasks()
      try {
        await fsp.rm(locationsDir, { recursive: true, force: true })
      } catch {
        return { ok: false, reason: 'locations-cache-clear-failed' }
      }
      return { ok: true }
    })()
    try {
      return await locationsResetPromise
    } finally {
      locationsResetPromise = null
    }
  }

  return {
    open,
    openDialog,
    getProgress,
    saveProgress,
    flushPending,
    getPrefs,
    setPrefs,
    getLocations,
    saveLocations,
    resolveSession,
    releaseSession,
    clearSessions,
    serve,
    bindMainWindow,
    resetForMaintenance
  }
}
