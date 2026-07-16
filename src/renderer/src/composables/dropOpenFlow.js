export async function openDroppedFile(decision, { api }) {
  if (decision.reason === 'not-file') {
    return {
      kind: decision.kind,
      requestId: decision.requestId,
      result: { ok: false, reason: 'not-file', message: '请拖入单个文件' }
    }
  }

  if (decision.kind === 'txt') {
    return {
      kind: 'txt',
      requestId: decision.requestId,
      result: await api.openDroppedTxt(decision.file)
    }
  }
  if (decision.kind === 'epub') {
    return {
      kind: 'epub',
      requestId: decision.requestId,
      result: await api.openDroppedEpub(decision.file)
    }
  }
  if (decision.kind === 'pdf') {
    return {
      kind: 'pdf',
      requestId: decision.requestId,
      result: await api.openDroppedPdf(decision.file)
    }
  }

  return {
    kind: decision.kind,
    requestId: decision.requestId,
    result: { ok: false, reason: 'unsupported', message: '不支持的文件格式' }
  }
}

export function createDropResultDispatcher({
  handleTxtOpenResult,
  handleEpubOpenResult,
  handlePdfOpenResult,
  pushStatus
}) {
  return function dispatchDropOpenResult({ kind, requestId, result }) {
    if (result?.reason === 'not-file') {
      pushStatus('请拖入单个文件')
      return
    }
    if (kind === 'txt') handleTxtOpenResult(result)
    if (kind === 'epub') handleEpubOpenResult(result, requestId)
    if (kind === 'pdf') handlePdfOpenResult(result, requestId)
  }
}
