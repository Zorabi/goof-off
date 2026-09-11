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
let txtChangeRevision = 0
let txtWriteGeneration = 0
let pendingTxtPatch = null
let failedTxtPatch = null
let authoritativeTxtPrefs = {
  ...DEFAULT_TXT_RUNTIME_PREFS,
  pageKeys: { ...DEFAULT_TXT_RUNTIME_PREFS.pageKeys }
}
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

function assertPatchApplied(next, patch) {
  if (!next || typeof next !== 'object' || next.ok === false) {
    throw new Error(next?.message || '阅读偏好写入未生效')
  }
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === 'pageKeys') {
      for (const [direction, keyValue] of Object.entries(value || {})) {
        if (!Object.is(next.pageKeys?.[direction], keyValue)) {
          throw new Error('阅读偏好写入未生效')
        }
      }
    } else if (!Object.is(next[key], value)) {
      throw new Error('阅读偏好写入未生效')
    }
  }
}

function mergeTxtPrefs(value) {
  authoritativeTxtPrefs = {
    ...DEFAULT_TXT_RUNTIME_PREFS,
    ...(value || {}),
    pageKeys: { ...DEFAULT_TXT_RUNTIME_PREFS.pageKeys, ...(value?.pageKeys || {}) }
  }
  composeTxtPrefs()
}

function composeTxtPrefs() {
  const combined = {
    ...authoritativeTxtPrefs,
    ...(failedTxtPatch || {}),
    ...(pendingTxtPatch || {})
  }
  txtPrefs.value = {
    ...DEFAULT_TXT_RUNTIME_PREFS,
    ...combined,
    pageKeys: { ...DEFAULT_TXT_RUNTIME_PREFS.pageKeys, ...(combined.pageKeys || {}) }
  }
}

function reconcileFailedTxtPatch(value) {
  if (!failedTxtPatch || !value || typeof value !== 'object' || Array.isArray(value)) return

  for (const [key, failedValue] of Object.entries(failedTxtPatch)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const fieldChanged = !Object.is(value[key], authoritativeTxtPrefs[key])
    const fieldConfirmed = Object.is(value[key], failedValue)
    if (fieldChanged || fieldConfirmed) delete failedTxtPatch[key]
  }
  if (Object.keys(failedTxtPatch).length === 0) failedTxtPatch = null
}

function applyTxtPrefsChange(value, options = {}) {
  txtChangeRevision += 1
  if (options?.replaceRuntime === true) failedTxtPatch = null
  else reconcileFailedTxtPatch(value)
  mergeTxtPrefs(value)
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
  window.api?.onTxtPrefsChange?.(applyTxtPrefsChange)
  window.api?.onEpubPrefsChange?.(applyEpubPrefsChange)
  window.api?.onPdfPrefsChange?.(applyPdfPrefsChange)
}

function readPdfPrefs() {
  const startedAtRevision = pdfChangeRevision
  return Promise.resolve(window.api?.pdfGetPrefs?.())
    .then((value) => {
      if (pdfChangeRevision === startedAtRevision) mergePdfPrefs(value)
    })
    .catch(() => {})
}

function readTxtPrefs() {
  const startedAtRevision = txtChangeRevision
  return Promise.resolve(window.api?.txtGetPrefs?.())
    .then((value) => {
      if (txtChangeRevision === startedAtRevision) mergeTxtPrefs(value)
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
    assertPatchApplied(next, patch)
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

async function setTxtPrefs(patch) {
  const generation = ++txtWriteGeneration
  const startedAtRevision = txtChangeRevision
  if (failedTxtPatch && patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of Object.keys(patch)) delete failedTxtPatch[key]
    if (Object.keys(failedTxtPatch).length === 0) failedTxtPatch = null
  }
  pendingTxtPatch = { ...(pendingTxtPatch || {}), ...(patch || {}) }
  composeTxtPrefs()

  try {
    if (typeof window.api?.txtSetPrefs !== 'function') throw new Error('TXT 偏好接口不可用')
    const next = await window.api.txtSetPrefs(patch)
    assertPatchApplied(next, patch)
    if (generation === txtWriteGeneration) {
      pendingTxtPatch = null
      if (txtChangeRevision === startedAtRevision) applyTxtPrefsChange(next)
      else composeTxtPrefs()
    }
    return next
  } catch (error) {
    if (generation === txtWriteGeneration) {
      pendingTxtPatch = null
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        failedTxtPatch = { ...(failedTxtPatch || {}), ...patch }
      }
      composeTxtPrefs()
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
    assertPatchApplied(next, patch)
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
  bootstrapPromise = Promise.all([readTxtPrefs(), readEpubPrefs(), readPdfPrefs()])
  return bootstrapPromise
}

export function useReaderPrefs() {
  bootstrapReaderPrefs()
  return { txtPrefs, epubPrefs, pdfPrefs, setTxtPrefs, setEpubPrefs, setPdfPrefs }
}
