import { computed, ref, shallowRef, provide, inject } from 'vue'
import { pushStatus } from './usePageMessages.js'
import { shouldDiscardMaintenanceProgress } from './useMaintenanceReset.js'
import { buildPdfOutlineTree, hasPdfOutlineEntries } from './pdfOutlineModel.js'

let pdfjsReady = null
function ensurePdfjs() {
  if (!pdfjsReady) pdfjsReady = import('pdfjs-dist')
  return pdfjsReady
}

let workerReady = null
async function ensureWorker(pdfjsLib) {
  if (workerReady) return workerReady
  workerReady = (async () => {
    const PdfWorker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')).default
    const worker = new PdfWorker()
    pdfjsLib.GlobalWorkerOptions.workerPort = worker
  })()
  return workerReady
}

const PDFJS_BASE = new URL('pdfjs/', document.baseURI).href
const PDF_KEY = Symbol('pdf')

export function createPdf() {
  const fileId = ref('')
  const displayName = ref('')
  const pageCount = ref(0)
  const doc = shallowRef(null) // 使用 shallowRef 避免 Vue 深度响应式包装 pdfjs 对象
  const loading = ref(false)
  const zoom = ref({ mode: 'fit-width', value: 1 })
  const currentPage = ref(1)
  const progressPercent = ref(0)
  const initialInPageRatio = ref(0)
  const pendingInitialProgress = ref(null)
  const outlineItems = ref([])
  const outlineLoading = ref(false)
  const outlineError = ref('')
  const outlineAvailable = computed(() => hasPdfOutlineEntries(outlineItems.value))
  const outlineOpen = ref(false)
  const showOutline = computed({
    get: () => outlineOpen.value && outlineAvailable.value && !outlineLoading.value,
    set: (value) => {
      outlineOpen.value = Boolean(value) && outlineAvailable.value && !outlineLoading.value
    }
  })

  let loadSeq = 0
  let progressCollector = null

  function computeInitialProgressPercent(page, inPageRatio, totalPages) {
    if (!totalPages) return 0
    const safePage = Math.max(1, Math.min(page || 1, totalPages))
    const safeRatio = Math.max(0, Math.min(1, inPageRatio || 0))
    return Math.max(0, Math.min(100, Math.round(((safePage - 1 + safeRatio) / totalPages) * 100)))
  }

  function outlineRequestIsCurrent(seq, currentFileId, currentDoc) {
    return loadSeq === seq && fileId.value === currentFileId && doc.value === currentDoc
  }

  function resetOutlineState() {
    outlineOpen.value = false
    outlineItems.value = []
    outlineLoading.value = false
    outlineError.value = ''
  }

  function destroyAcceptedDoc() {
    if (!doc.value) return
    doc.value.destroy()
    doc.value = null
  }

  function resetAcceptedState() {
    fileId.value = ''
    displayName.value = ''
    pageCount.value = 0
    currentPage.value = 1
    progressPercent.value = 0
    initialInPageRatio.value = 0
    pendingInitialProgress.value = null
  }

  function clearCurrentPdfSession() {
    destroyAcceptedDoc()
    resetAcceptedState()
    resetOutlineState()
  }

  async function loadOutline(seq, currentFileId, currentDoc) {
    if (!currentDoc || typeof currentDoc.getOutline !== 'function') {
      outlineItems.value = []
      outlineLoading.value = false
      outlineError.value = ''
      return
    }

    outlineLoading.value = true
    outlineError.value = ''

    try {
      const rawOutline = await currentDoc.getOutline()
      if (!outlineRequestIsCurrent(seq, currentFileId, currentDoc)) return

      const items = await buildPdfOutlineTree(
        rawOutline || [],
        currentDoc,
        currentDoc.numPages || 0
      )
      if (!outlineRequestIsCurrent(seq, currentFileId, currentDoc)) return

      outlineItems.value = items
      if (!hasPdfOutlineEntries(items)) showOutline.value = false
    } catch {
      if (!outlineRequestIsCurrent(seq, currentFileId, currentDoc)) return
      outlineItems.value = []
      outlineError.value = '目录加载失败'
      showOutline.value = false
    } finally {
      if (outlineRequestIsCurrent(seq, currentFileId, currentDoc)) {
        outlineLoading.value = false
      }
    }
  }

  function closeOutline() {
    showOutline.value = false
  }

  function toggleOutline() {
    if (outlineLoading.value || !outlineAvailable.value) return
    showOutline.value = !showOutline.value
  }

  async function load(newFileId, openData, opts = {}) {
    loading.value = true
    const mySeq = ++loadSeq
    clearCurrentPdfSession()
    const { displayName: name, savedProgress } = openData

    const nextCurrentPage = 1
    const nextInitialInPageRatio = 0
    const nextZoom = { mode: 'fit-width', value: 1 }
    let resolvedCurrentPage = nextCurrentPage
    let resolvedInitialInPageRatio = nextInitialInPageRatio
    let resolvedZoom = nextZoom

    let newDoc
    try {
      const pdfjsLib = await ensurePdfjs()
      await ensureWorker(pdfjsLib)
      newDoc = await pdfjsLib.getDocument({
        url: `goof-off-pdf://${newFileId}`,
        cMapUrl: `${PDFJS_BASE}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
        wasmUrl: `${PDFJS_BASE}wasm/`
      }).promise
    } catch (err) {
      console.error('[usePdf] PDF 加载失败:', err)
      loading.value = false
      window.api.pdfClose(newFileId)
      const msg = classifyError(err)
      if (!opts.silent) pushStatus(msg)
      return { ok: false, reason: 'load-failed', message: msg }
    }

    if (loadSeq !== mySeq) {
      newDoc.destroy()
      window.api.pdfClose(newFileId)
      return { ok: false, reason: 'stale' }
    }

    if (savedProgress) {
      pendingInitialProgress.value = savedProgress
      resolvedCurrentPage = savedProgress.page || 1
      resolvedInitialInPageRatio = savedProgress.inPageRatio || 0
      if (savedProgress.zoom) resolvedZoom = savedProgress.zoom
    } else {
      const prefs = await window.api.pdfGetPrefs()

      if (loadSeq !== mySeq) {
        newDoc.destroy()
        window.api.pdfClose(newFileId)
        return { ok: false, reason: 'stale' }
      }

      if (prefs?.defaultZoom && prefs.defaultZoom !== 'fit-width') {
        resolvedZoom = { mode: 'fixed', value: prefs.defaultZoom }
      } else {
        resolvedZoom = { mode: 'fit-width', value: 1 }
      }
    }

    doc.value = newDoc
    fileId.value = newFileId
    displayName.value = name
    pageCount.value = newDoc.numPages
    currentPage.value = resolvedCurrentPage
    initialInPageRatio.value = resolvedInitialInPageRatio
    zoom.value = resolvedZoom
    progressPercent.value = computeInitialProgressPercent(
      resolvedCurrentPage,
      resolvedInitialInPageRatio,
      newDoc.numPages
    )
    resetOutlineState()
    void loadOutline(mySeq, newFileId, newDoc)

    loading.value = false
    return { ok: true, savedProgress }
  }

  function registerProgressCollector(fn) {
    progressCollector = fn
    return () => {
      if (progressCollector === fn) progressCollector = null
    }
  }

  function consumePendingInitialProgress() {
    const progress = pendingInitialProgress.value
    pendingInitialProgress.value = null
    return progress
  }

  async function flushCurrentProgress() {
    if (shouldDiscardMaintenanceProgress() || !fileId.value || !progressCollector) return
    await window.api.pdfFlushProgress(fileId.value, progressCollector())
  }

  function closeFile() {
    loadSeq++
    clearCurrentPdfSession()
  }

  return {
    fileId,
    displayName,
    pageCount,
    doc,
    loading,
    zoom,
    currentPage,
    progressPercent,
    initialInPageRatio,
    outlineItems,
    outlineLoading,
    outlineError,
    showOutline,
    outlineAvailable,
    load,
    closeFile,
    registerProgressCollector,
    consumePendingInitialProgress,
    flushCurrentProgress,
    toggleOutline,
    closeOutline
  }
}

function classifyError(err) {
  const msg = err?.message || ''
  if (msg.includes('password') || msg.includes('encrypted')) return '文件已加密，无法打开'
  if (msg.includes('Invalid PDF') || msg.includes('corrupt')) return '文件无法解析'
  if (msg.includes('worker')) return 'PDF 引擎初始化失败'
  return '文件加载失败'
}

export function providePdf(pdf) {
  provide(PDF_KEY, pdf)
  return pdf
}

export function injectPdf() {
  return inject(PDF_KEY)
}
