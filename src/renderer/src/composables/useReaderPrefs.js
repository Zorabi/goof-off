import { ref } from 'vue'
import { DEFAULT_PDF_COLOR_PREFS, normalizePdfColorPrefs } from '../../../shared/pdfColorPrefs.js'

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
  hideImages: true,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
})

export const DEFAULT_PDF_RUNTIME_PREFS = Object.freeze({
  defaultZoom: 'fit-width',
  pageDisplay: 'page',
  invertColors: false,
  ...DEFAULT_PDF_COLOR_PREFS
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
let epubChangeRevision = 0
let epubWriteGeneration = 0
let pendingEpubPatch = null
let failedEpubPatch = null
let authoritativeEpubPrefs = {
  ...DEFAULT_EPUB_RUNTIME_PREFS,
  pageKeys: { ...DEFAULT_EPUB_RUNTIME_PREFS.pageKeys }
}
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

function composeEpubPrefs() {
  const combined = {
    ...authoritativeEpubPrefs,
    ...(failedEpubPatch || {}),
    ...(pendingEpubPatch || {})
  }
  epubPrefs.value = {
    ...DEFAULT_EPUB_RUNTIME_PREFS,
    ...combined,
    pageKeys: { ...DEFAULT_EPUB_RUNTIME_PREFS.pageKeys, ...(combined.pageKeys || {}) }
  }
}

function mergeEpubPrefs(value) {
  authoritativeEpubPrefs = {
    ...DEFAULT_EPUB_RUNTIME_PREFS,
    ...(value || {}),
    pageKeys: { ...DEFAULT_EPUB_RUNTIME_PREFS.pageKeys, ...(value?.pageKeys || {}) }
  }
  composeEpubPrefs()
}

function reconcileFailedEpubPatch(value) {
  if (!failedEpubPatch || !value || typeof value !== 'object' || Array.isArray(value)) return

  for (const [key, failedValue] of Object.entries(failedEpubPatch)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const fieldChanged = !Object.is(value[key], authoritativeEpubPrefs[key])
    const fieldConfirmed = Object.is(value[key], failedValue)
    if (fieldChanged || fieldConfirmed) delete failedEpubPatch[key]
  }
  if (Object.keys(failedEpubPatch).length === 0) failedEpubPatch = null
}

function applyEpubPrefsChange(value, options = {}) {
  epubChangeRevision += 1
  if (options?.replaceRuntime === true) failedEpubPatch = null
  else reconcileFailedEpubPatch(value)
  mergeEpubPrefs(value)
}

function composePdfPrefs() {
  const combined = {
    ...authoritativePdfPrefs,
    ...(failedPdfPatch || {}),
    ...(pendingPdfPatch || {})
  }
  pdfPrefs.value = { ...combined, ...normalizePdfColorPrefs(combined) }
}

function mergePdfPrefs(value) {
  const combined = { ...DEFAULT_PDF_RUNTIME_PREFS, ...(value || {}) }
  authoritativePdfPrefs = { ...combined, ...normalizePdfColorPrefs(combined) }
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
  window.api?.onEpubPrefsChange?.(applyEpubPrefsChange)
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

function readEpubPrefs() {
  const startedAtRevision = epubChangeRevision
  return Promise.resolve(window.api?.epubGetPrefs?.())
    .then((value) => {
      if (epubChangeRevision === startedAtRevision) mergeEpubPrefs(value)
    })
    .catch(() => {})
}

async function setEpubPrefs(patch) {
  const generation = ++epubWriteGeneration
  const startedAtRevision = epubChangeRevision
  if (failedEpubPatch && patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of Object.keys(patch)) delete failedEpubPatch[key]
    if (Object.keys(failedEpubPatch).length === 0) failedEpubPatch = null
  }
  pendingEpubPatch = { ...(pendingEpubPatch || {}), ...(patch || {}) }
  composeEpubPrefs()

  try {
    if (typeof window.api?.epubSetPrefs !== 'function') throw new Error('EPUB 偏好接口不可用')
    const next = await window.api.epubSetPrefs(patch)
    if (generation === epubWriteGeneration) {
      pendingEpubPatch = null
      if (epubChangeRevision === startedAtRevision) applyEpubPrefsChange(next)
      else composeEpubPrefs()
    }
    return next
  } catch (error) {
    if (generation === epubWriteGeneration) {
      pendingEpubPatch = null
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        failedEpubPatch = { ...(failedEpubPatch || {}), ...patch }
      }
      composeEpubPrefs()
    }
    throw error
  }
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
    readEpubPrefs(),
    readPdfPrefs()
  ])
  return bootstrapPromise
}

export function useReaderPrefs() {
  bootstrapReaderPrefs()
  return { txtPrefs, epubPrefs, pdfPrefs, setEpubPrefs, setPdfPrefs }
}
