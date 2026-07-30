import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_PDF_PREFS, normalizePdfPrefs } from './preferencesModel.js'

export const PDF_PREFS_STORE_SCHEMA = Object.freeze({
  type: 'object',
  default: { ...DEFAULT_PDF_PREFS },
  properties: {
    defaultZoom: { anyOf: [{ type: 'string' }, { type: 'number' }] },
    pageDisplay: { type: 'string', enum: ['page', 'percent', 'both'] },
    invertColors: { type: 'boolean' },
    // Stored colors must reach normalization before schema validation can reject them.
    backgroundColor: {},
    textColor: {}
  }
})

export function normalizeStoredPdfPrefs(store) {
  const stored = store.get('pdfPrefs')
  const normalized = normalizePdfPrefs(stored)
  if (!isDeepStrictEqual(stored, normalized)) store.set('pdfPrefs', normalized)
  return normalized
}
