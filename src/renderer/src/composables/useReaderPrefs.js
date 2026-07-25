import { ref } from 'vue'

export const DEFAULT_TXT_RUNTIME_PREFS = Object.freeze({
  fontSize: 16,
  lineHeight: 1.7,
  bgColor: null,
  autoTurnSec: 30,
  defaultEncoding: null,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
})

export const DEFAULT_EPUB_RUNTIME_PREFS = Object.freeze({
  defaultMode: 'scroll',
  fontSize: 16,
  lineHeight: 1.7,
  autoTurnSec: 30,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
})

export const DEFAULT_PDF_RUNTIME_PREFS = Object.freeze({
  defaultZoom: 'fit-width',
  pageDisplay: 'page',
  invertColors: false
})

const txtPrefs = ref({
  ...DEFAULT_TXT_RUNTIME_PREFS,
  pageKeys: { ...DEFAULT_TXT_RUNTIME_PREFS.pageKeys }
})
const epubPrefs = ref({
  ...DEFAULT_EPUB_RUNTIME_PREFS,
  pageKeys: { ...DEFAULT_EPUB_RUNTIME_PREFS.pageKeys }
})
const pdfPrefs = ref({ ...DEFAULT_PDF_RUNTIME_PREFS })

let bootstrapPromise = null
let listenersRegistered = false
let pdfChangeRevision = 0
let pdfWriteGeneration = 0
let pendingPdfPatch = null
let failedPdfPatch = null
let authoritativePdfPrefs = { ...DEFAULT_PDF_RUNTIME_PREFS }

function mergeTxtPrefs(value) {
  txtPrefs.value = {
    ...DEFAULT_TXT_RUNTIME_PREFS,
    ...(value || {}),
    pageKeys: { ...DEFAULT_TXT_RUNTIME_PREFS.pageKeys, ...(value?.pageKeys || {}) }
  }
}

function mergeEpubPrefs(value) {
  epubPrefs.value = {
    ...DEFAULT_EPUB_RUNTIME_PREFS,
    ...(value || {}),
    pageKeys: { ...DEFAULT_EPUB_RUNTIME_PREFS.pageKeys, ...(value?.pageKeys || {}) }
  }
}

function composePdfPrefs() {
  pdfPrefs.value = {
    ...authoritativePdfPrefs,
    ...(failedPdfPatch || {}),
    ...(pendingPdfPatch || {})
  }
}

function mergePdfPrefs(value) {
  authoritativePdfPrefs = { ...DEFAULT_PDF_RUNTIME_PREFS, ...(value || {}) }
  composePdfPrefs()
}

function reconcileFailedPdfPatch(value) {
  if (!failedPdfPatch || !value || typeof value !== 'object' || Array.isArray(value)) return

  for (const [key, failedValue] of Object.entries(failedPdfPatch)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const fieldChanged = !Object.is(value[key], authoritativePdfPrefs[key])
    const fieldConfirmed = Object.is(value[key], failedValue)
    if (fieldChanged || fieldConfirmed) delete failedPdfPatch[key]
  }
  if (Object.keys(failedPdfPatch).length === 0) failedPdfPatch = null
}

function applyPdfPrefsChange(value, options = {}) {
  pdfChangeRevision += 1
  if (options?.replaceRuntime === true) failedPdfPatch = null
  else reconcileFailedPdfPatch(value)
  mergePdfPrefs(value)
}

function registerListeners() {
  if (listenersRegistered) return
  listenersRegistered = true
  window.api?.onTxtPrefsChange?.(mergeTxtPrefs)
  window.api?.onEpubPrefsChange?.(mergeEpubPrefs)
  window.api?.onPdfPrefsChange?.(applyPdfPrefsChange)
}

function readPrefs(read, merge) {
  return Promise.resolve(read?.())
    .then(merge)
    .catch(() => {})
}

function readPdfPrefs() {
  const startedAtRevision = pdfChangeRevision
  return Promise.resolve(window.api?.pdfGetPrefs?.())
    .then((value) => {
      if (pdfChangeRevision === startedAtRevision) mergePdfPrefs(value)
    })
    .catch(() => {})
}

async function setPdfPrefs(patch) {
  const generation = ++pdfWriteGeneration
  const startedAtRevision = pdfChangeRevision
  if (failedPdfPatch && patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of Object.keys(patch)) delete failedPdfPatch[key]
    if (Object.keys(failedPdfPatch).length === 0) failedPdfPatch = null
  }
  pendingPdfPatch = { ...(pendingPdfPatch || {}), ...(patch || {}) }
  composePdfPrefs()

  try {
    if (typeof window.api?.pdfSetPrefs !== 'function') throw new Error('PDF 偏好接口不可用')
    const next = await window.api.pdfSetPrefs(patch)
    if (generation === pdfWriteGeneration) {
      pendingPdfPatch = null
      if (pdfChangeRevision === startedAtRevision) applyPdfPrefsChange(next)
      else composePdfPrefs()
    }
    return next
  } catch (error) {
    if (generation === pdfWriteGeneration) {
      pendingPdfPatch = null
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        failedPdfPatch = { ...(failedPdfPatch || {}), ...patch }
      }
      composePdfPrefs()
    }
    throw error
  }
}

export function bootstrapReaderPrefs() {
  registerListeners()
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = Promise.all([
    readPrefs(window.api?.txtGetPrefs, mergeTxtPrefs),
    readPrefs(window.api?.epubGetPrefs, mergeEpubPrefs),
    readPdfPrefs()
  ])
  return bootstrapPromise
}

export function useReaderPrefs() {
  bootstrapReaderPrefs()
  return { txtPrefs, epubPrefs, pdfPrefs, setPdfPrefs }
}
