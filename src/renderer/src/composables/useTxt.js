import { ref, provide, inject } from 'vue'
import { shouldDiscardMaintenanceProgress } from './useMaintenanceReset.js'

const TXT_KEY = Symbol('txt')

export function useTxt() {
  const fileId = ref(null)
  const displayName = ref('')
  const text = ref('')
  const chapters = ref([])
  const encoding = ref('UTF-8')
  const confidence = ref(0)
  const sizeBytes = ref(0)
  const offset = ref(0)
  const intraBlockRatio = ref(0)
  const removedChapterIds = ref([])
  const sourceChapters = ref([])
  const loading = ref(false)

  function buildProgressPatch() {
    return {
      offset: offset.value,
      intraBlockRatio: intraBlockRatio.value,
      removedChapterIds: [...removedChapterIds.value]
    }
  }

  function load(data) {
    fileId.value = data.fileId
    displayName.value = data.displayName
    text.value = data.text
    encoding.value = data.encoding
    confidence.value = data.confidence
    sizeBytes.value = data.sizeBytes
    offset.value = 0
    intraBlockRatio.value = 0
    removedChapterIds.value = []
    sourceChapters.value = data.chapters
    chapters.value = [...sourceChapters.value]
  }

  async function restoreProgress() {
    const id = fileId.value
    if (!id) return
    const progress = await window.api.txtGetProgress(id)
    if (!progress || fileId.value !== id) return
    offset.value = progress.offset || 0
    intraBlockRatio.value = progress.intraBlockRatio || 0
    if (progress.removedChapterIds && fileId.value === id) {
      removedChapterIds.value = progress.removedChapterIds
      chapters.value = sourceChapters.value.filter(
        (c) => !progress.removedChapterIds.includes(c.id)
      )
    }
  }

  function savePosition() {
    if (shouldDiscardMaintenanceProgress() || !fileId.value) return
    window.api.txtSaveProgress(fileId.value, buildProgressPatch())
  }

  function saveEncoding(enc) {
    if (shouldDiscardMaintenanceProgress() || !fileId.value) return
    window.api.txtSaveProgress(fileId.value, { encoding: enc })
  }

  function removeChapter(chapterId) {
    chapters.value = chapters.value.filter((c) => c.id !== chapterId)
    removedChapterIds.value = [...removedChapterIds.value, chapterId]
    savePosition()
  }

  function resetChapters() {
    if (!fileId.value) return
    removedChapterIds.value = []
    chapters.value = [...sourceChapters.value]
    savePosition()
  }

  async function reDecode(newEncoding) {
    if (!fileId.value) return { ok: false, reason: 'not-found' }
    loading.value = true
    const result = await window.api.txtReDecode(fileId.value, newEncoding)
    loading.value = false
    if (result.ok) {
      text.value = result.data.text
      encoding.value = result.data.encoding
      confidence.value = result.data.confidence
      sourceChapters.value = result.data.chapters
      chapters.value = sourceChapters.value.filter((c) => !removedChapterIds.value.includes(c.id))
      offset.value = 0
      intraBlockRatio.value = 0
      saveEncoding(result.data.encoding)
    }
    return result
  }

  function closeFile(options = {}) {
    if (!options.discardProgress && !shouldDiscardMaintenanceProgress()) savePosition()
    fileId.value = null
    displayName.value = ''
    text.value = ''
    chapters.value = []
    sourceChapters.value = []
    encoding.value = 'UTF-8'
    confidence.value = 0
    sizeBytes.value = 0
    offset.value = 0
    intraBlockRatio.value = 0
    removedChapterIds.value = []
  }

  async function flushCurrentProgress() {
    if (shouldDiscardMaintenanceProgress() || !fileId.value) return
    await window.api.txtFlushProgress(fileId.value, buildProgressPatch())
  }

  return {
    fileId,
    displayName,
    text,
    chapters,
    encoding,
    confidence,
    sizeBytes,
    offset,
    intraBlockRatio,
    removedChapterIds,
    loading,
    load,
    restoreProgress,
    savePosition,
    saveEncoding,
    removeChapter,
    resetChapters,
    reDecode,
    closeFile,
    flushCurrentProgress
  }
}

export function provideTxt() {
  const txt = useTxt()
  provide(TXT_KEY, txt)
  return txt
}

export function injectTxt() {
  return inject(TXT_KEY)
}
