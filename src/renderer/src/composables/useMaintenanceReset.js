import { nextTick, ref } from 'vue'

export const maintenanceDiscardProgress = ref(false)

export function shouldDiscardMaintenanceProgress() {
  return maintenanceDiscardProgress.value
}

export function createMaintenanceResetHandler(deps = {}) {
  return async function handleMaintenanceReset(payload = {}) {
    const requestId = payload.requestId
    maintenanceDiscardProgress.value = payload.discardProgress !== false
    try {
      deps.stopAutoTurn?.()
      await deps.restoreStealthInteraction?.('maintenance-reset')
      deps.resetStealthAutoHideRuntime?.('maintenance-reset')
      deps.fileCoordinator?.cancelCurrentOpenRequest?.('maintenance-reset')
      await deps.txtSearch?.reset?.({ clearWorkerText: true })
      deps.epubCtrl?.closeToc?.()
      deps.epubCtrl?.closeSearch?.()
      await deps.epubSearch?.reset?.({ clearLastQuery: true })
      deps.txt?.closeFile?.({ discardProgress: true })
      deps.epub?.closeFile?.({ discardProgress: true })
      deps.pdf?.closeFile?.({ discardProgress: true })
      deps.appState?.dispatch?.({
        type: 'MAINTENANCE_RESET_HOME',
        meta: { trusted: true }
      })
      await nextTick()
      await nextTick()
      await deps.api?.maintenanceResetComplete?.(requestId, { ok: true })
    } catch (error) {
      await deps.api?.maintenanceResetComplete?.(requestId, {
        ok: false,
        reason: 'renderer-error',
        message: error?.message || 'maintenance reset failed'
      })
    } finally {
      maintenanceDiscardProgress.value = false
    }
  }
}
