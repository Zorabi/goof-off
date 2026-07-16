let globalHandlersRegistered = false
const IGNORED_GLOBAL_ERROR_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
])

function errorMessageOf(error) {
  if (!error || typeof error !== 'object') return String(error ?? '')
  return String(error.message || '')
}

export function isIgnorableGlobalError(error) {
  return IGNORED_GLOBAL_ERROR_MESSAGES.has(errorMessageOf(error))
}

export function summarizeRendererError(error) {
  if (!error || typeof error !== 'object') {
    return { name: 'Error', message: String(error ?? '') }
  }
  return {
    name: String(error.name || 'Error'),
    message: String(error.message || ''),
    stack: error.stack ? String(error.stack) : ''
  }
}

export async function logDiagnostic(event, data = {}, level = 'info') {
  const api = globalThis.window?.api
  if (!api?.diagnosticLog) return { ok: false, reason: 'unavailable' }
  try {
    return await api.diagnosticLog(event, data, level)
  } catch {
    return { ok: false, reason: 'send-failed' }
  }
}

export function logDiagnosticError(event, error, data = {}) {
  return logDiagnostic(event, { ...data, error: summarizeRendererError(error) }, 'error')
}

export function registerGlobalDiagnosticHandlers() {
  if (globalHandlersRegistered || !globalThis.window?.addEventListener) return
  globalHandlersRegistered = true
  window.addEventListener('error', (event) => {
    const error = event.error || event.message
    if (isIgnorableGlobalError(error)) return
    logDiagnosticError('renderer.error', error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    logDiagnosticError('renderer.unhandled_rejection', event.reason)
  })
}
