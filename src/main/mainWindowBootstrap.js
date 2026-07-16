export function createMainWindowBootstrap(deps) {
  const pendingBootstrapByWindow = new WeakMap()

  function revealReadyWindow(win) {
    if (win.isMinimized?.()) win.restore()
    if (!win.isVisible?.()) win.show()
    win.setOpacity?.(1)
    win.focus?.()
  }

  async function waitForPendingBootstrap(win, options = {}) {
    const pending = pendingBootstrapByWindow.get(win)
    if (!pending) return win
    if (options.showWhenReady) pending.showWhenReady = true
    await pending.ready
    return win
  }

  function createAndBootstrapMainWindow(options = {}) {
    const { showWhenReady = false } = options
    const win = deps.createWindow()
    const pending = { showWhenReady, ready: null }
    pending.ready = new Promise((resolve, reject) => {
      win.once('ready-to-show', async () => {
        try {
          deps.setupDialogBridge(win)
          deps.webviewManager.init(win)
          deps.pdfService.bindMainWindow(win)
          await deps.applySystemVisibilityPrefs?.(deps.getSystemPrefs?.(), { win })
          if (pending.showWhenReady) revealReadyWindow(win)
          resolve(win)
        } catch (error) {
          reject(error)
        } finally {
          pendingBootstrapByWindow.delete(win)
        }
      })
    })
    pending.ready.catch(() => {})
    pendingBootstrapByWindow.set(win, pending)
    return win
  }

  async function openMainWindow() {
    const existing = deps.getMainWindow?.()
    if (!existing || existing.isDestroyed?.()) {
      const created = createAndBootstrapMainWindow({ showWhenReady: true })
      await waitForPendingBootstrap(created)
      return created
    }
    if (pendingBootstrapByWindow.has(existing)) {
      await waitForPendingBootstrap(existing, { showWhenReady: true })
      return existing
    }
    revealReadyWindow(existing)
    return existing
  }

  return { createAndBootstrapMainWindow, openMainWindow }
}
