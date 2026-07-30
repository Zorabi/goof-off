import { inject, provide } from 'vue'
import {
  beginOpenRequest as beginGuardOpenRequest,
  cancelOpenRequest as cancelGuardOpenRequest,
  clearOpenRequest,
  isCurrentOpenRequest
} from './openRequestGuard.js'
import {
  normalizeWebStateUrl,
  resolveWebStateUrl,
  shouldEnterWebState,
  urlsEqual
} from './webOpenResult.js'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'

const KEY = Symbol('file-open-coordinator')

export function createFileOpenCoordinator({
  api,
  browser,
  appState,
  txt,
  epub,
  pdf,
  flushActiveReader,
  stopAutoTurn,
  pushStatus
}) {
  async function flushBeforeOpen() {
    try {
      await flushActiveReader()
      return true
    } catch {
      pushStatus('保存当前进度失败')
      return false
    }
  }

  async function writeWebIntent(finalUrl) {
    if (!finalUrl) return
    await api.startupRestoreSet?.({ type: 'web', url: finalUrl })
  }

  async function writeFileIntent(kind, result) {
    if (!result?.path) return
    await api.startupRestoreSet?.({ type: 'file', fileKind: kind, path: result.path })
  }

  async function cleanupStaleResult(kind, result) {
    if (kind === 'pdf' && result?.ok && result.data?.fileId) {
      api.pdfClose(result.data.fileId, result.data.sessionToken)
    }
    if (kind === 'epub' && result?.ok && result.data?.fileId) {
      epub.releaseOpenSession?.(result.data.fileId, result.data.sessionToken)
    }
    if (result?.historyToken) await api.historyDiscardFile(result.historyToken)
    logDiagnostic('file.open.stale_cleanup', {
      kind,
      ok: Boolean(result?.ok),
      hasHistoryToken: Boolean(result?.historyToken)
    })
  }

  function shouldShowWebOpenFailure(result) {
    return result?.reason === 'invalid-url' || result?.reason === 'not-ready'
  }

  function logOpenRequest(source, kind, extra = {}) {
    logDiagnostic('file.open.request', {
      source,
      kind,
      ...extra
    })
  }

  function logOpenResult(source, kind, result) {
    logDiagnostic('file.open.result', {
      source,
      kind,
      ok: Boolean(result?.ok),
      reason: result?.reason || result?.error
    })
  }

  function buildReaderFailureResult(loadResult, fallbackMessage = '文件加载失败') {
    return {
      ok: false,
      reason: loadResult?.reason || 'load-failed',
      message: loadResult?.message || loadResult?.error || fallbackMessage
    }
  }

  function logReaderLoadFailure(source, kind, loadResult) {
    logDiagnostic('file.reader_load_failed', {
      source,
      kind,
      error: loadResult?.message || loadResult?.error || loadResult?.reason || 'load-failed'
    })
  }

  async function handleTxtOpenResult(result, requestId) {
    if (!result) return undefined
    if (requestId !== undefined && !isCurrentOpenRequest(requestId)) return undefined
    if (result.ok) {
      stopAutoTurn()
      txt.savePosition()
      appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'txt' } })
      txt.load(result.data)
      await writeFileIntent('txt', result)
      return result
    }
    if (result.reason === 'cancelled' || result.reason === 'stale') return
    if (result.reason === 'not-file') pushStatus('请拖入单个文件')
    else pushStatus(result.message || result.error || '操作失败')
    return result
  }

  async function handleEpubOpenResult(result, requestId, source = 'unknown') {
    if (!result) return undefined
    if (!isCurrentOpenRequest(requestId)) {
      if (result.ok && result.data?.fileId) {
        epub.releaseOpenSession?.(result.data.fileId, result.data.sessionToken)
      }
      if (result.historyToken) await api.historyDiscardFile(result.historyToken)
      return undefined
    }
    if (result.ok) {
      stopAutoTurn()
      txt.savePosition()
      const loadResult = await epub.load(result.data)
      if (!isCurrentOpenRequest(requestId)) {
        if (result.historyToken) await api.historyDiscardFile(result.historyToken)
        return undefined
      }
      if (loadResult.ok) {
        appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'epub' } })
        if (result.historyToken) {
          const commit = await api.historyCommitFile(result.historyToken)
          if (commit && commit.ok === false) pushStatus(commit.message || '历史记录保存失败')
        }
        await writeFileIntent('epub', result)
        return result
      } else {
        if (result.historyToken) await api.historyDiscardFile(result.historyToken)
        if (loadResult.error && loadResult.error !== 'stale') pushStatus(loadResult.error)
        if (loadResult.error !== 'stale') logReaderLoadFailure(source, 'epub', loadResult)
        return buildReaderFailureResult(loadResult)
      }
    }
    if (result.reason === 'not-file') pushStatus('请拖入单个文件')
    else if (result.error && result.error !== 'canceled' && result.error !== 'stale')
      pushStatus(result.error)
    else if (result.message && result.reason !== 'cancelled' && result.reason !== 'stale') {
      pushStatus(result.message)
    }
    return result
  }

  async function handlePdfOpenResult(result, requestId, source = 'unknown') {
    if (!result) return undefined
    if (!isCurrentOpenRequest(requestId)) {
      if (result.ok) api.pdfClose(result.data.fileId, result.data.sessionToken)
      if (result.historyToken) await api.historyDiscardFile(result.historyToken)
      return undefined
    }
    if (result.ok) {
      stopAutoTurn()
      txt.savePosition()
      const replacingActivePdf =
        appState.state.content === 'file' && appState.state.fileKind === 'pdf'
      const loadResult = await pdf.load(result.data.fileId, result.data)
      if (!isCurrentOpenRequest(requestId)) {
        api.pdfClose(result.data.fileId, result.data.sessionToken)
        if (result.historyToken) await api.historyDiscardFile(result.historyToken)
        return undefined
      }
      if (loadResult.ok) {
        appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'pdf' } })
        if (result.historyToken) {
          const commit = await api.historyCommitFile(result.historyToken)
          if (commit && commit.ok === false) pushStatus(commit.message || '历史记录保存失败')
        }
        await writeFileIntent('pdf', result)
        return result
      } else {
        api.pdfClose(result.data.fileId, result.data.sessionToken)
        if (result.historyToken) await api.historyDiscardFile(result.historyToken)
        if (loadResult.reason && loadResult.reason !== 'stale') {
          if (replacingActivePdf) appState.dispatch({ type: 'NAVIGATE_HOME' })
          pushStatus(loadResult.message || '文件加载失败')
        }
        if (loadResult.reason !== 'stale') logReaderLoadFailure(source, 'pdf', loadResult)
        return buildReaderFailureResult(loadResult)
      }
    }
    if (result.reason === 'not-file') pushStatus('请拖入单个文件')
    else if (result.reason && result.reason !== 'cancelled' && result.reason !== 'stale') {
      pushStatus(result.message || '操作失败')
    }
    return result
  }

  function beginOpenRequest(kind = 'file') {
    return beginGuardOpenRequest(kind)
  }

  function cancelCurrentOpenRequest() {
    cancelGuardOpenRequest()
  }

  async function openWebByUrl(url) {
    const requestId = beginOpenRequest('web')
    const source = 'direct-url'
    const kind = 'web'
    logOpenRequest(source, kind, { url })
    try {
      if (!(await flushBeforeOpen())) return
      if (!isCurrentOpenRequest(requestId)) {
        const staleResult = { ok: false, reason: 'stale' }
        logOpenResult(source, kind, staleResult)
        return staleResult
      }
      const requestedUrl = normalizeWebStateUrl(url)
      let openSettled = false
      let enteredRequestedState = false
      const openResult = Promise.resolve(browser.openSite(url)).then((result) => {
        openSettled = true
        return result
      })
      if (requestedUrl) {
        await Promise.resolve()
        if (!openSettled && isCurrentOpenRequest(requestId)) {
          appState.dispatch({ type: 'LOAD_URL', payload: { url: requestedUrl } })
          enteredRequestedState = true
        }
      }
      const result = await openResult
      if (!isCurrentOpenRequest(requestId)) {
        const staleResult = { ok: false, reason: 'stale' }
        logOpenResult(source, kind, staleResult)
        return staleResult
      }
      if (shouldEnterWebState(result)) {
        const stateUrl = resolveWebStateUrl(result, url)
        if (
          !enteredRequestedState ||
          (requestedUrl && result?.ok && !urlsEqual(stateUrl, requestedUrl))
        ) {
          appState.dispatch({ type: 'LOAD_URL', payload: { url: stateUrl } })
        }
        if (!result?.ok) {
          logOpenResult(source, kind, result)
          return result
        }
        await writeWebIntent(result.url)
        logOpenResult(source, kind, result)
        return result
      }
      if (shouldShowWebOpenFailure(result)) pushStatus(result?.message || '网页加载失败')
      logOpenResult(source, kind, result)
      return result
    } finally {
      clearOpenRequest(requestId)
    }
  }

  async function openFileByPath(kind, path) {
    const requestId = beginOpenRequest('file')
    const source = 'history'
    logOpenRequest(source, kind, { hasPath: Boolean(path) })
    try {
      if (!(await flushBeforeOpen())) {
        const failed = { ok: false, reason: 'flush-failed', message: '保存当前进度失败' }
        logOpenResult(source, kind, failed)
        return failed
      }
      if (!isCurrentOpenRequest(requestId) && kind !== 'pdf') {
        const stale = { ok: false, reason: 'stale' }
        logOpenResult(source, kind, stale)
        return stale
      }
      const result = await api.historyOpenFile({ kind, path })
      let finalResult
      if (!isCurrentOpenRequest(requestId)) {
        await cleanupStaleResult(kind, result)
        finalResult = { ok: false, reason: 'stale' }
      } else if (result?.ok === false && result.reason === 'not-found') {
        finalResult = result
      } else {
        finalResult = (await handleOpenResult(kind, result, requestId, source)) || result
      }
      logOpenResult(source, kind, finalResult)
      return finalResult
    } finally {
      clearOpenRequest(requestId)
    }
  }

  async function openFileFromDialog(kind, openDialog) {
    const requestId = beginOpenRequest('file')
    const source = 'dialog'
    logOpenRequest(source, kind)
    try {
      if (!(await flushBeforeOpen())) return
      if (!isCurrentOpenRequest(requestId)) return
      const result = await openDialog()
      const finalResult = (await handleOpenResult(kind, result, requestId, source)) || result
      logOpenResult(source, kind, finalResult)
    } finally {
      clearOpenRequest(requestId)
    }
  }

  async function openAnyFileFromDialog() {
    const requestId = beginOpenRequest('file')
    const source = 'dialog'
    logOpenRequest(source, 'any')
    try {
      if (!(await flushBeforeOpen())) return
      if (!isCurrentOpenRequest(requestId)) return
      const result = await api.openAnyFileDialog()
      const kind = result?.kind
      if (!isCurrentOpenRequest(requestId)) {
        await cleanupStaleResult(kind, result)
        return undefined
      }
      if (!kind) {
        if (result?.reason !== 'cancelled' && result?.reason !== 'stale') {
          pushStatus(result?.message || '文件不可用')
        }
        logOpenResult(source, 'unknown', result)
        return result
      }
      const finalResult = (await handleOpenResult(kind, result, requestId, source)) || result
      logOpenResult(source, kind, finalResult)
      return finalResult
    } finally {
      clearOpenRequest(requestId)
    }
  }

  async function openDroppedDecision(decision, openDroppedFile) {
    const requestId = beginOpenRequest('file')
    decision.requestId = requestId
    const source = 'drop'
    logOpenRequest(source, decision.kind || 'unknown', { hasPath: Boolean(decision.file) })
    try {
      if (!(await flushBeforeOpen())) return
      if (!isCurrentOpenRequest(requestId)) return
      const { kind, result } = await openDroppedFile(decision, { api })
      const finalResult = (await handleOpenResult(kind, result, requestId, source)) || result
      logOpenResult(source, kind, finalResult)
    } finally {
      clearOpenRequest(requestId)
    }
  }

  async function handleOpenResult(kind, result, requestId, source = 'unknown') {
    if (!isCurrentOpenRequest(requestId)) {
      await cleanupStaleResult(kind, result)
      return undefined
    }
    if (kind === 'txt') return handleTxtOpenResult(result, requestId)
    if (kind === 'epub') return handleEpubOpenResult(result, requestId, source)
    if (kind === 'pdf') return handlePdfOpenResult(result, requestId, source)
    return result
  }

  async function openStartupWeb({ url, requestId }) {
    const currentRequestId = requestId ?? beginOpenRequest('web')
    const ownsRequest = requestId === undefined
    const source = 'startup'
    const kind = 'web'
    logOpenRequest(source, kind, { url })
    try {
      const result = await browser.openSite(url, { silent: true })
      if (!isCurrentOpenRequest(currentRequestId)) {
        const staleResult = { ok: false, reason: 'stale' }
        logOpenResult(source, kind, staleResult)
        return staleResult
      }
      if (result?.ok) {
        appState.dispatch({ type: 'LOAD_URL', payload: { url: result.url } })
        await writeWebIntent(result.url)
        logOpenResult(source, kind, result)
        return result
      }
      const finalResult = result || { ok: false, reason: 'load-error', message: '网页加载失败' }
      logOpenResult(source, kind, finalResult)
      return finalResult
    } finally {
      if (ownsRequest) clearOpenRequest(currentRequestId)
    }
  }

  async function openStartupFile({ fileKind, path, requestId }) {
    const currentRequestId = requestId ?? beginOpenRequest('file')
    const ownsRequest = requestId === undefined
    const source = 'startup'
    logOpenRequest(source, fileKind, { hasPath: Boolean(path) })
    try {
      const result = await api.startupRestoreOpenFile({ fileKind, path })
      if (!isCurrentOpenRequest(currentRequestId)) {
        await cleanupStaleResult(fileKind, result)
        const staleResult = { ok: false, reason: 'stale' }
        logOpenResult(source, fileKind, staleResult)
        return staleResult
      }
      if (!result?.ok) {
        const finalResult = result || { ok: false, reason: 'load-failed', message: '文件加载失败' }
        logOpenResult(source, fileKind, finalResult)
        return finalResult
      }

      if (fileKind === 'txt') {
        stopAutoTurn()
        txt.savePosition()
        appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'txt' } })
        txt.load(result.data)
        await writeFileIntent('txt', result)
        const finalResult = { ok: true, kind: 'txt', path: result.path }
        logOpenResult(source, fileKind, finalResult)
        return finalResult
      }

      if (fileKind === 'epub') {
        stopAutoTurn()
        txt.savePosition()
        let loadResult
        try {
          loadResult = await epub.load(result.data)
        } catch (e) {
          await cleanupStaleResult(fileKind, result)
          if (!isCurrentOpenRequest(currentRequestId)) return { ok: false, reason: 'stale' }
          console.warn('[fileOpenCoordinator] startup EPUB load failed:', e)
          logDiagnosticError('file.reader_load_failed', e, { source, kind: fileKind })
          const finalResult = { ok: false, reason: 'load-failed', message: '文件加载失败' }
          logOpenResult(source, fileKind, finalResult)
          return finalResult
        }
        if (!isCurrentOpenRequest(currentRequestId)) {
          await cleanupStaleResult(fileKind, result)
          const staleResult = { ok: false, reason: 'stale' }
          logOpenResult(source, fileKind, staleResult)
          return staleResult
        }
        if (!loadResult.ok) {
          if (result.historyToken) await api.historyDiscardFile(result.historyToken)
          const finalResult = {
            ok: false,
            reason: 'load-failed',
            message: loadResult.error || '文件加载失败'
          }
          logOpenResult(source, fileKind, finalResult)
          return finalResult
        }
        appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'epub' } })
        if (result.historyToken) {
          const commit = await api.historyCommitFile(result.historyToken)
          if (commit && commit.ok === false) pushStatus(commit.message || '历史记录保存失败')
        }
        await writeFileIntent('epub', result)
        const finalResult = { ok: true, kind: 'epub', path: result.path }
        logOpenResult(source, fileKind, finalResult)
        return finalResult
      }

      if (fileKind === 'pdf') {
        stopAutoTurn()
        txt.savePosition()
        let loadResult
        try {
          loadResult = await pdf.load(result.data.fileId, result.data, { silent: true })
        } catch (e) {
          await cleanupStaleResult(fileKind, result)
          if (!isCurrentOpenRequest(currentRequestId)) return { ok: false, reason: 'stale' }
          console.warn('[fileOpenCoordinator] startup PDF load failed:', e)
          logDiagnosticError('file.reader_load_failed', e, { source, kind: fileKind })
          const finalResult = { ok: false, reason: 'load-failed', message: '文件加载失败' }
          logOpenResult(source, fileKind, finalResult)
          return finalResult
        }
        if (!isCurrentOpenRequest(currentRequestId)) {
          await cleanupStaleResult(fileKind, result)
          const staleResult = { ok: false, reason: 'stale' }
          logOpenResult(source, fileKind, staleResult)
          return staleResult
        }
        if (!loadResult.ok) {
          api.pdfClose(result.data.fileId, result.data.sessionToken)
          if (result.historyToken) await api.historyDiscardFile(result.historyToken)
          const finalResult = {
            ok: false,
            reason: loadResult.reason || 'load-failed',
            message: loadResult.message || '文件加载失败'
          }
          logOpenResult(source, fileKind, finalResult)
          return finalResult
        }
        appState.dispatch({ type: 'OPEN_FILE', payload: { kind: 'pdf' } })
        if (result.historyToken) {
          const commit = await api.historyCommitFile(result.historyToken)
          if (commit && commit.ok === false) pushStatus(commit.message || '历史记录保存失败')
        }
        await writeFileIntent('pdf', result)
        const finalResult = { ok: true, kind: 'pdf', path: result.path }
        logOpenResult(source, fileKind, finalResult)
        return finalResult
      }

      const finalResult = { ok: false, reason: 'invalid-kind', message: '文件不可用' }
      logOpenResult(source, fileKind, finalResult)
      return finalResult
    } finally {
      if (ownsRequest) clearOpenRequest(currentRequestId)
    }
  }

  return {
    openWebByUrl,
    openFileByPath,
    openFileFromDialog,
    openAnyFileFromDialog,
    openDroppedDecision,
    handleTxtOpenResult,
    handleEpubOpenResult,
    handlePdfOpenResult,
    beginOpenRequest,
    cancelCurrentOpenRequest,
    isCurrentOpenRequest,
    clearOpenRequest,
    openStartupWeb,
    openStartupFile
  }
}

export function provideFileOpenCoordinator(coordinator) {
  provide(KEY, coordinator)
  return coordinator
}

export function injectFileOpenCoordinator() {
  return inject(KEY)
}
