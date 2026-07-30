import { ref, markRaw, provide, inject } from 'vue'
import { pushStatus } from './usePageMessages.js'
import { shouldDiscardMaintenanceProgress } from './useMaintenanceReset.js'
import {
  ensureEpubjsBookLoadPatch,
  ensureEpubjsSectionDestroyPatch,
  ensureEpubjsUndeclaredImagePatch
} from './epubjsCompat.js'

const EPUB_KEY = Symbol('epub')
const LOCATIONS_SAVE_IDLE_TIMEOUT_MS = 2000

function scheduleIdleTask(task) {
  let cancelled = false
  const run = (...args) => {
    if (!cancelled) task(...args)
  }
  if (typeof window.requestIdleCallback === 'function') {
    const taskId = window.requestIdleCallback(run, { timeout: LOCATIONS_SAVE_IDLE_TIMEOUT_MS })
    return () => {
      cancelled = true
      window.cancelIdleCallback?.(taskId)
    }
  }
  const taskId = setTimeout(run, 0)
  return () => {
    cancelled = true
    clearTimeout(taskId)
  }
}

function detectEncryption(book) {
  if (book.packaging?.encryption) return true
  const files = book.archive?.zip?.files
  if (files && files['META-INF/encryption.xml']) return true
  return false
}

function normalizePercentage(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export function createEpub() {
  const fileId = ref('')
  const displayName = ref('')
  const book = ref(null)
  const toc = ref([])
  const percentage = ref(0)
  const locationsReady = ref(false)
  const loading = ref(false)
  // 每次被接受的加载自增。EpubReader 把 rendition 建在 onMounted 里，而重开同一本书时
  // fileId 不变 —— 仅靠 fileId 作 :key 无法触发重挂载，rendition 会停在 closeFile()
  // 置空后的 null。序号并入 key，保证「同文件重开」也重建实例。
  const loadInstance = ref(0)

  let renditionCleanup = null
  let progressCollector = null
  let loadSeq = 0
  let activeFetchAbort = null
  let cancelLocationsSave = null
  // 同一 fileId 可能同时存在新旧两次加载（快速重复打开同一本书）；每个 token
  // 必须独立收尾，否则旧 fetch 后结束时会令新会话错过释放。
  const inflightFetches = new Map()

  function beginInflightFetch(id, sessionToken) {
    let tokens = inflightFetches.get(id)
    if (!tokens) {
      tokens = new Set()
      inflightFetches.set(id, tokens)
    }
    tokens.add(sessionToken)
  }

  function endInflightFetch(id, sessionToken) {
    const tokens = inflightFetches.get(id)
    tokens?.delete(sessionToken)
    if (tokens?.size === 0) inflightFetches.delete(id)
    Promise.resolve(window.api?.epubClose?.(id, sessionToken)).catch(() => {})
  }

  function releaseOpenSession(id, sessionToken) {
    if (!id) return
    // 仅本次 open 的下载在途时交由 endInflightFetch 释放；同文件其它 token 不应阻塞。
    if (inflightFetches.get(id)?.has(sessionToken)) return
    Promise.resolve(window.api?.epubClose?.(id, sessionToken)).catch(() => {})
  }

  function registerRenditionCleanup(fn) {
    renditionCleanup = fn
  }

  function unregisterRenditionCleanup() {
    renditionCleanup = null
  }

  function cancelPendingLocationsSave() {
    cancelLocationsSave?.()
    cancelLocationsSave = null
  }

  function closeFile(options = {}) {
    cancelPendingLocationsSave()
    const discard = options.discardProgress || shouldDiscardMaintenanceProgress()
    if (renditionCleanup) {
      renditionCleanup({ discardProgress: discard })
      renditionCleanup = null
    }
    if (book.value) {
      book.value.destroy()
    }
    if (activeFetchAbort) {
      activeFetchAbort.abort()
      activeFetchAbort = null
    }
    fileId.value = ''
    displayName.value = ''
    book.value = null
    toc.value = []
    percentage.value = 0
    locationsReady.value = false
    loading.value = false
    loadSeq++
  }

  async function load(data) {
    loading.value = true
    const {
      arrayBuffer,
      fileId: newFileId,
      displayName: newName,
      sessionToken,
      savedProgress
    } = data

    const mySeq = ++loadSeq
    cancelPendingLocationsSave()

    let newBook
    try {
      // 主进程不再经 IPC 传整本 ArrayBuffer，由 goof-off-epub 协议流式拉取；
      // 兼容直接携带 arrayBuffer 的旧入参（测试与降级路径）。
      let bookData = arrayBuffer
      if (!bookData) {
        if (activeFetchAbort) activeFetchAbort.abort()
        const abort = new AbortController()
        activeFetchAbort = abort
        beginInflightFetch(newFileId, sessionToken)
        try {
          const response = await fetch(
            `goof-off-epub://${newFileId}?sessionToken=${encodeURIComponent(sessionToken)}`,
            { signal: abort.signal }
          )
          if (!response.ok) throw new Error(`epub fetch failed: ${response.status}`)
          bookData = await response.arrayBuffer()
        } finally {
          if (activeFetchAbort === abort) activeFetchAbort = null
          // EPUB 整本一次取完，会话仅在下载期间有效：fetch 结束（含失败/中止）即释放
          endInflightFetch(newFileId, sessionToken)
        }
      }
      if (loadSeq !== mySeq) {
        return { ok: false, error: 'stale' }
      }
      const { default: ePub, Book } = await import('epubjs')
      // 必须在 ePub() 之前打上：loadNavigation / unpack 在 opened 落定前就已执行
      ensureEpubjsBookLoadPatch(Book)
      ensureEpubjsUndeclaredImagePatch(Book)
      newBook = ePub(bookData)
      await newBook.opened
    } catch {
      if (newBook) newBook.destroy()
      // 过期加载不得触碰 loading —— 此刻 loading 属于把本次挤掉的那次新加载
      if (loadSeq !== mySeq) return { ok: false, error: 'stale' }
      loading.value = false
      return { ok: false, error: '文件无法解析' }
    }

    ensureEpubjsSectionDestroyPatch(newBook)

    if (loadSeq !== mySeq) {
      newBook.destroy()
      return { ok: false, error: 'stale' }
    }

    if (newBook.spine && newBook.spine.length === 0) {
      newBook.destroy()
      loading.value = false
      return { ok: false, error: '文件内容为空' }
    }

    if (detectEncryption(newBook)) {
      newBook.destroy()
      loading.value = false
      return { ok: false, error: '不支持加密 EPUB' }
    }

    if (book.value) closeFile()

    const currentSeq = loadSeq
    book.value = markRaw(newBook)
    fileId.value = newFileId
    loadInstance.value += 1
    displayName.value = newName
    percentage.value = normalizePercentage(savedProgress?.percentage)

    newBook.loaded.metadata
      .then((meta) => {
        if (loadSeq !== currentSeq) return
        if (meta?.layout === 'pre-paginated') {
          pushStatus('固定版式 EPUB，显示可能异常')
        }
      })
      .catch(() => {})

    newBook.loaded.navigation
      .then((nav) => {
        if (loadSeq === currentSeq) {
          toc.value = nav.toc || []
        }
      })
      .catch(() => {})

    locationsReady.value = false
    void setupLocations(newBook, newFileId, currentSeq)

    loading.value = false
    return { ok: true, savedProgress }
  }

  // locations.generate 会顺序解析全部 spine 章节，大书在主线程上要跑数秒，
  // 因此结果按 fileId 持久化（主进程独立文件），二次打开直接 load 跳过生成。
  async function setupLocations(newBook, newFileId, currentSeq) {
    try {
      const cached = await window.api?.epubGetLocations?.(newFileId)
      if (loadSeq !== currentSeq) return
      if (typeof cached === 'string' && cached) {
        newBook.locations.load(cached)
        if ((newBook.locations.length?.() || 0) > 0) {
          locationsReady.value = true
          return
        }
      }
    } catch {
      // 缓存缺失或损坏，退回现场生成
    }
    try {
      await newBook.locations.generate(1600)
    } catch {
      if (loadSeq === currentSeq) {
        locationsReady.value = false
        pushStatus('位置索引生成失败，部分进度定位不可用')
      }
      return
    }
    if (loadSeq !== currentSeq) return
    locationsReady.value = true
    cancelPendingLocationsSave()
    cancelLocationsSave = scheduleIdleTask(() => {
      cancelLocationsSave = null
      if (loadSeq !== currentSeq || book.value !== newBook) return
      try {
        const json = newBook.locations.save?.()
        if (typeof json === 'string' && json) {
          Promise.resolve(window.api?.epubSaveLocations?.(newFileId, json)).catch(() => {})
        }
      } catch {
        // 回存失败只影响下次打开的缓存命中，不影响本次会话
      }
    })
  }

  function registerProgressCollector(fn) {
    progressCollector = fn
    return () => {
      if (progressCollector === fn) progressCollector = null
    }
  }

  async function flushCurrentProgress() {
    if (shouldDiscardMaintenanceProgress() || !fileId.value || !progressCollector) return
    await window.api.epubFlushProgress(fileId.value, progressCollector())
  }

  function savePosition(patch) {
    if (shouldDiscardMaintenanceProgress() || !fileId.value) return
    window.api.epubSaveProgress(fileId.value, patch)
  }

  return {
    fileId,
    displayName,
    book,
    toc,
    percentage,
    locationsReady,
    loading,
    loadInstance,
    load,
    closeFile,
    releaseOpenSession,
    savePosition,
    registerProgressCollector,
    flushCurrentProgress,
    registerRenditionCleanup,
    unregisterRenditionCleanup
  }
}

export function provideEpub(epub) {
  provide(EPUB_KEY, epub)
  return epub
}

export function injectEpub() {
  return inject(EPUB_KEY)
}
