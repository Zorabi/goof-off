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
  pageDisplay: 'page'
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

function mergePdfPrefs(value) {
  pdfPrefs.value = { ...DEFAULT_PDF_RUNTIME_PREFS, ...(value || {}) }
}

function registerListeners() {
  if (listenersRegistered) return
  listenersRegistered = true
  window.api?.onTxtPrefsChange?.(mergeTxtPrefs)
  window.api?.onEpubPrefsChange?.(mergeEpubPrefs)
  window.api?.onPdfPrefsChange?.(mergePdfPrefs)
}

function readPrefs(read, merge) {
  return Promise.resolve(read?.())
    .then(merge)
    .catch(() => {})
}

export function bootstrapReaderPrefs() {
  registerListeners()
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = Promise.all([
    readPrefs(window.api?.txtGetPrefs, mergeTxtPrefs),
    readPrefs(window.api?.epubGetPrefs, mergeEpubPrefs),
    readPrefs(window.api?.pdfGetPrefs, mergePdfPrefs)
  ])
  return bootstrapPromise
}

export function useReaderPrefs() {
  bootstrapReaderPrefs()
  return { txtPrefs, epubPrefs, pdfPrefs }
}
