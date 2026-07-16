import { ipcMain } from 'electron'
import { createPendingEntry, defaultReturnFor, resolvePending } from './dialogBridge.js'
import { sendPageMessage } from './pageMessage.js'

let currentMainWindow = null
let bridgeRegistered = false

function getCurrentMainWindow() {
  if (!currentMainWindow || currentMainWindow.isDestroyed?.()) return null
  return currentMainWindow
}

export function setupDialogBridge(mainWindow) {
  currentMainWindow = mainWindow || null
  if (bridgeRegistered) return
  bridgeRegistered = true

  ipcMain.on('page:dialog', (_e, payload) => {
    if (payload?.kind === 'alert') {
      sendPageMessage({ kind: 'alert', msg: String(payload.msg ?? '') })
    }
  })

  ipcMain.on('page:dialog-sync', (event, payload) => {
    const targetWindow = getCurrentMainWindow()
    if (!targetWindow) {
      event.returnValue = defaultReturnFor(payload?.kind)
      return
    }
    const id = createPendingEntry({
      kind: payload.kind,
      event,
      onTimeout: () => sendPageMessage({ kind: 'load-error', description: '页面无响应' })
    })
    targetWindow.webContents.send('page:dialog-request', {
      id,
      kind: payload.kind,
      msg: String(payload.msg ?? ''),
      defaultVal: payload.defaultVal != null ? String(payload.defaultVal) : ''
    })
  })

  ipcMain.on('page:dialog-respond', (_e, payload) => {
    resolvePending(payload.id, payload.result)
  })
}

export async function attachCDPFallback(view) {
  try {
    if (!view?.webContents?.debugger) return
    view.webContents.debugger.attach('1.3')
    await view.webContents.debugger.sendCommand('Page.enable')
    view.webContents.debugger.on('message', (_e, method) => {
      if (method === 'Page.javascriptDialogOpening') {
        view.webContents.debugger
          .sendCommand('Page.handleJavaScriptDialog', { accept: false })
          .catch(() => {})
      }
    })
  } catch (e) {
    console.warn('[dialogBridgeSetup] CDP attach failed:', e?.message)
  }
}
