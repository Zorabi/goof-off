const PAUSING_BOTTOM_LOCK_KINDS = new Set([
  'popover',
  'native-popover',
  'panel',
  'input',
  'dialog',
  'menu'
])

export function shouldPauseAutoTurnForChromeLocks(locks = []) {
  return locks.some(
    (lock) =>
      (lock.scope === 'bottom' || lock.scope === 'global') &&
      PAUSING_BOTTOM_LOCK_KINDS.has(lock.kind)
  )
}

export function createAutoTurnChromePauseController(autoTurn) {
  let pauseHeldByChrome = false

  function release() {
    if (!pauseHeldByChrome) return
    pauseHeldByChrome = false
    if (autoTurn.paused.value) autoTurn.resume()
  }

  function sync(shouldPause) {
    if (!shouldPause) {
      release()
      return
    }
    if (autoTurn.running.value) {
      autoTurn.pause()
      pauseHeldByChrome = true
    }
  }

  return { sync, release }
}
