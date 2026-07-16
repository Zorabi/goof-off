import { getMainWindow } from './windowManager.js'

export function sendPageMessage(payload) {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !win.webContents) return
  win.webContents.send('page:message', payload)
}
