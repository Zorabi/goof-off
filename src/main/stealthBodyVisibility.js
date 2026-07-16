import * as webviewManager from './webviewManager.js'
import { getMainWindow } from './windowManager.js'

export const STEALTH_BODY_VISIBILITY_RESTORE_CHANNEL = 'stealth:auto-hide-restore-body-visibility'

export function restoreStealthBodyVisibility(reason = 'runtime-recovery') {
  void webviewManager.applyStealthContentOpacityMultiplier(1)

  const mainWindow = getMainWindow?.()
  if (mainWindow && !mainWindow.isDestroyed?.()) {
    mainWindow.webContents?.send?.(STEALTH_BODY_VISIBILITY_RESTORE_CHANNEL, {
      reason
    })
  }

  return { ok: true, reason }
}
