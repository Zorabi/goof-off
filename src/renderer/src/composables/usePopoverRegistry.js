import { ref } from 'vue'
import { injectChromeLockRegistry } from './useChromeLockRegistry.js'

const reservedPopoverId = ref(null)

function ownerIdFor(id) {
  return `bottom.popover.${id}`
}

export function usePopoverRegistry() {
  const registry = injectChromeLockRegistry()

  function register(id, closeFn, options = {}) {
    const kind = options.kind || 'popover'
    registry.registerLock({
      ownerId: ownerIdFor(id),
      kind,
      scope: 'bottom',
      priority: options.priority ?? 30,
      mutexGroup: 'bottom.popover',
      appliesTo: options.appliesTo,
      focusRestore: options.triggerEl
        ? { mode: 'trigger', target: options.triggerEl }
        : { mode: 'none' },
      onEscape: closeFn,
      diagnostic: { ownerId: ownerIdFor(id), kind, scope: 'bottom' }
    })
  }

  function updateKind(id, kind) {
    registry.updateLock(ownerIdFor(id), { kind })
  }

  function unregister(id, options = {}) {
    registry.releaseLock(ownerIdFor(id), {
      restoreFocus: options.restoreFocus === true,
      reason: options.reason || 'release'
    })
  }

  function getReservedPopoverId() {
    return reservedPopoverId.value
  }

  function setReservedPopoverId(id) {
    reservedPopoverId.value = id
  }

  return { register, unregister, updateKind, getReservedPopoverId, setReservedPopoverId }
}

export function _resetPopoverRegistryForTest() {
  reservedPopoverId.value = null
}
