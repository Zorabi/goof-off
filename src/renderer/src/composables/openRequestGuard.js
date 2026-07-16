let requestSeq = 0
let activeRequest = { id: 0, kind: null }

export function beginOpenRequest(kind = 'unknown') {
  const id = ++requestSeq
  activeRequest = { id, kind }
  return id
}

export function isCurrentOpenRequest(id) {
  return id === activeRequest.id
}

export function getActiveOpenKind() {
  return activeRequest.kind
}

export function hasActiveOpenRequest() {
  return activeRequest.kind !== null
}

export function hasPendingNonWebOpen() {
  return activeRequest.kind === 'file'
}

export function cancelOpenRequest() {
  const id = ++requestSeq
  activeRequest = { id, kind: null }
  return id
}

export function clearOpenRequest(id) {
  if (id === activeRequest.id) activeRequest = { id: 0, kind: null }
}

export function resetOpenRequestGuardForTest() {
  requestSeq = 0
  activeRequest = { id: 0, kind: null }
}
