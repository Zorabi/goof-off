import { ref, markRaw, provide, inject } from 'vue'
import { pushStatus } from './usePageMessages.js'
import { shouldDiscardMaintenanceProgress } from './useMaintenanceReset.js'

const EPUB_KEY = Symbol('epub')

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

  let renditionCleanup = null
  let progressCollector = null
  let loadSeq = 0

  function registerRenditionCleanup(fn) {
    renditionCleanup = fn
  }

  function unregisterRenditionCleanup() {
    renditionCleanup = null
  }

  function closeFile(options = {}) {
    const discard = options.discardProgress || shouldDiscardMaintenanceProgress()
    if (renditionCleanup) {
      renditionCleanup({ discardProgress: discard })
      renditionCleanup = null
    }
    if (book.value) {
      book.value.destroy()
    }
    fileId.value = ''
    displayName.value = ''
    book.value = null
    toc.value = []
    percentage.value = 0
    locationsReady.value = false
    loadSeq++
  }

  async function load(data) {
    loading.value = true
    const { arrayBuffer, fileId: newFileId, displayName: newName, savedProgress } = data

    const mySeq = ++loadSeq

    let newBook
    try {
      const { default: ePub } = await import('epubjs')
      newBook = ePub(arrayBuffer)
      await newBook.opened
    } catch {
      if (newBook) newBook.destroy()
      loading.value = false
      return { ok: false, error: '文件无法解析' }
    }

    if (loadSeq !== mySeq) {
      newBook.destroy()
      loading.value = false
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
    newBook.locations
      .generate(1600)
      .then(() => {
        if (loadSeq === currentSeq) locationsReady.value = true
      })
      .catch(() => {
        if (loadSeq === currentSeq) {
          locationsReady.value = false
          pushStatus('位置索引生成失败，部分进度定位不可用')
        }
      })

    loading.value = false
    return { ok: true, savedProgress }
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
    load,
    closeFile,
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
