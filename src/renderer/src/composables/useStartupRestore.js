import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'

function isQuietFailure(result) {
  return result?.reason === 'stale' || result?.reason === 'cancelled'
}

export function createStartupRestore({ api, fileCoordinator, appState, pushStatus }) {
  let started = false

  function logRestoreResult(result) {
    logDiagnostic('startup_restore.result', {
      ok: Boolean(result?.ok),
      reason: result?.reason
    })
  }

  async function runOnce() {
    if (started) return { ok: false, reason: 'already-started' }
    started = true
    logDiagnostic('startup_restore.start', {})
    const requestId = fileCoordinator.beginOpenRequest('startup-restore')

    try {
      const intent = await api.startupRestoreGet()
      logDiagnostic('startup_restore.intent', {
        type: intent?.type || null,
        fileKind: intent?.fileKind
      })
      if (!fileCoordinator.isCurrentOpenRequest(requestId)) {
        const result = { ok: false, reason: 'stale' }
        logRestoreResult(result)
        return result
      }
      if (!intent) {
        const result = { ok: true, reason: 'empty' }
        logRestoreResult(result)
        return result
      }

      let result
      if (intent.type === 'web') {
        result = await fileCoordinator.openStartupWeb({
          url: intent.url,
          requestId
        })
      } else if (intent.type === 'file') {
        result = await fileCoordinator.openStartupFile({
          fileKind: intent.fileKind,
          path: intent.path,
          requestId
        })
      } else {
        result = { ok: false, reason: 'invalid-intent' }
      }

      if (!fileCoordinator.isCurrentOpenRequest(requestId)) {
        const staleResult = { ok: false, reason: 'stale' }
        logRestoreResult(staleResult)
        return staleResult
      }
      if (result?.ok) {
        logRestoreResult(result)
        return result
      }
      if (isQuietFailure(result)) {
        logRestoreResult(result)
        return result
      }

      appState.dispatch({ type: 'NAVIGATE_HOME' })
      pushStatus('恢复失败，已回到主页')
      const finalResult = result || { ok: false, reason: 'load-failed' }
      logRestoreResult(finalResult)
      return finalResult
    } catch (e) {
      console.warn('[startupRestore] restore failed:', e)
      logDiagnosticError('startup_restore.exception', e)
      if (!fileCoordinator.isCurrentOpenRequest(requestId)) {
        const result = { ok: false, reason: 'stale' }
        logRestoreResult(result)
        return result
      }
      appState.dispatch({ type: 'NAVIGATE_HOME' })
      pushStatus('恢复失败，已回到主页')
      const result = { ok: false, reason: 'exception', message: '恢复失败' }
      logRestoreResult(result)
      return result
    } finally {
      fileCoordinator.clearOpenRequest(requestId)
    }
  }

  return { runOnce }
}
