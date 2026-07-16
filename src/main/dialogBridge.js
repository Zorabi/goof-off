const DIALOG_TIMEOUT_MS = 30_000

let pendingId = 0
const pending = new Map() // id -> { event, timer, kind, onTimeout }

export function defaultReturnFor(kind) {
  return kind === 'confirm' ? false : null
}

export function createPendingEntry({ kind, event, onTimeout, timeoutMs = DIALOG_TIMEOUT_MS }) {
  const id = ++pendingId
  const timer = setTimeout(() => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    entry.event.returnValue = defaultReturnFor(kind)
    if (onTimeout) onTimeout(id)
  }, timeoutMs)
  pending.set(id, { event, timer, kind, onTimeout })
  return id
}

export function resolvePending(id, result) {
  const entry = pending.get(id)
  if (!entry) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.event.returnValue = result
  return true
}

export function getPendingCount() {
  return pending.size
}

export function _resetForTest() {
  for (const { timer } of pending.values()) clearTimeout(timer)
  pending.clear()
  pendingId = 0
}
