import { computed, inject, nextTick, onBeforeUnmount, provide, ref, unref, watch } from 'vue'

export const CHROME_LOCK_REGISTRY_TEST_KEY = Symbol.for('chromeLockRegistryTestProbe')

const CHROME_LOCK_REGISTRY_KEY = Symbol('chromeLockRegistry')

const DEFAULT_PRIORITY = Object.freeze({
  'reserved-area': 10,
  popover: 30,
  'native-popover': 30,
  panel: 50,
  input: 60,
  menu: 70,
  dialog: 80
})

const VALID_SCOPES = new Set(['top', 'bottom', 'content', 'global'])
const CONTENT_FOCUS_SELECTOR =
  '[data-chrome-focus-target="content"], .epub-view-container, .txt-reader, .pdf-scroll-container, .content-main'

let fallbackRegistry = null

function normalizeArray(value) {
  if (value == null) return null
  return Array.isArray(value) ? value : [value]
}

function matchesAppliesTo(appliesTo, context) {
  if (!appliesTo) return true
  for (const key of ['content', 'fileKind', 'form']) {
    const allowed = normalizeArray(appliesTo[key])
    if (allowed && !allowed.includes(context?.[key] ?? null)) return false
  }
  return true
}

function resolveElement(target) {
  const value = unref(target)
  if (!value) return null
  if (value instanceof HTMLElement) return value
  if (value.$el instanceof HTMLElement) return value.$el
  return null
}

function resolveContentElement(target) {
  return resolveElement(target) || document.querySelector(CONTENT_FOCUS_SELECTOR)
}

function focusElementWhenLive(target) {
  if (!target || !document.contains(target)) return
  nextTick(() => {
    if (!document.contains(target)) return
    if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
      target.setAttribute('tabindex', '-1')
    }
    target.focus?.({ preventScroll: true })
  })
}

function summarizeLock(lock) {
  return {
    ownerId: lock.ownerId,
    kind: lock.kind,
    scope: lock.scope
  }
}

function comparePriority(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority
  return b.createdAt - a.createdAt
}

function replacementKey(lock) {
  return lock.mutexGroup || `${lock.scope}:${lock.kind}`
}

function normalizeLock(lock, createdAt) {
  if (!lock?.ownerId) throw new Error('chrome lock ownerId is required')
  const kind = lock.kind || 'reserved-area'
  const scope = VALID_SCOPES.has(lock.scope) ? lock.scope : 'bottom'
  return {
    ...lock,
    ownerId: String(lock.ownerId),
    kind,
    scope,
    priority: Number.isFinite(lock.priority) ? lock.priority : DEFAULT_PRIORITY[kind] || 10,
    transient: lock.transient !== false,
    mutexGroup: lock.mutexGroup || `${scope}:${kind}`,
    createdAt,
    diagnostic: lock.diagnostic || { ownerId: String(lock.ownerId), kind, scope }
  }
}

export function createChromeLockRegistry({ now = Date.now } = {}) {
  const lockMap = ref(new Map())

  const activeLocks = computed(() => Array.from(lockMap.value.values()).sort(comparePriority))
  const topLocks = computed(() =>
    activeLocks.value.filter((lock) => lock.scope === 'top' || lock.scope === 'global')
  )
  const bottomLocks = computed(() =>
    activeLocks.value.filter((lock) => lock.scope === 'bottom' || lock.scope === 'global')
  )
  const contentLocks = computed(() =>
    activeLocks.value.filter((lock) => lock.scope === 'content' || lock.scope === 'global')
  )
  const hasTopLock = computed(() => topLocks.value.length > 0)
  const hasBottomLock = computed(() => bottomLocks.value.length > 0)
  const hasChromeLock = computed(() => activeLocks.value.length > 0)
  const highestPriorityLock = computed(
    () => activeLocks.value.find((lock) => lock.onEscape) || null
  )
  const diagnosticSummary = computed(() => {
    const countsByScope = { top: 0, bottom: 0, content: 0, global: 0 }
    const countsByKind = {}
    for (const lock of activeLocks.value) {
      countsByScope[lock.scope] += 1
      countsByKind[lock.kind] = (countsByKind[lock.kind] || 0) + 1
    }
    const highest = highestPriorityLock.value
    return {
      activeCount: activeLocks.value.length,
      countsByScope,
      countsByKind,
      highestPriority: highest
        ? {
            ownerId: highest.ownerId,
            kind: highest.kind,
            scope: highest.scope,
            priority: highest.priority
          }
        : null
    }
  })

  function setMap(next) {
    lockMap.value = next
  }

  function restoreFocusForLock(lock) {
    const restore = lock.focusRestore
    if (!restore || restore.mode === 'none') return
    const target =
      restore.mode === 'trigger'
        ? resolveElement(restore.target)
        : restore.mode === 'content'
          ? resolveContentElement(restore.target)
          : null
    focusElementWhenLive(target)
  }

  function releaseLock(ownerId, { restoreFocus = false, reason = 'release' } = {}) {
    const existing = lockMap.value.get(ownerId)
    if (!existing) return null
    const next = new Map(lockMap.value)
    next.delete(ownerId)
    setMap(next)
    if (restoreFocus) restoreFocusForLock(existing, reason)
    return summarizeLock(existing)
  }

  function registerLock(lock) {
    const normalized = normalizeLock(lock, now())
    const next = new Map(lockMap.value)
    for (const existing of next.values()) {
      if (
        existing.ownerId !== normalized.ownerId &&
        existing.transient &&
        normalized.transient &&
        replacementKey(existing) === replacementKey(normalized)
      ) {
        next.delete(existing.ownerId)
        existing.onEscape?.({ reason: 'replaced' })
      }
    }
    next.set(normalized.ownerId, normalized)
    setMap(next)
    return normalized
  }

  function updateLock(ownerId, patch = {}) {
    const existing = lockMap.value.get(ownerId)
    if (!existing) return null
    const nextLock = { ...existing, ...patch, ownerId, createdAt: existing.createdAt }
    const next = new Map(lockMap.value)
    next.set(ownerId, nextLock)
    setMap(next)
    return nextLock
  }

  function clearLocksWhere(predicate, reason = 'clear') {
    const removed = []
    const next = new Map(lockMap.value)
    for (const lock of lockMap.value.values()) {
      if (!predicate(lock)) continue
      next.delete(lock.ownerId)
      removed.push(summarizeLock(lock))
      lock.onEscape?.({ reason })
    }
    setMap(next)
    return { reason, removedCount: removed.length, removed }
  }

  function clearLocksByScope(scope, reason = 'scope-clear') {
    return clearLocksWhere((lock) => lock.scope === scope, reason)
  }

  function clearStaleLocks(context, reason = 'stale-clear') {
    const staleLocks = []
    const next = new Map(lockMap.value)
    for (const lock of lockMap.value.values()) {
      const applies = matchesAppliesTo(lock.appliesTo, context)
      const predicateApplies = lock.isApplicable ? lock.isApplicable(context) !== false : true
      if (applies && predicateApplies) continue
      next.delete(lock.ownerId)
      staleLocks.push(lock)
    }
    setMap(next)
    for (const lock of staleLocks) {
      lock.onEscape?.({ reason: 'stale', context })
    }
    return {
      reason,
      removedCount: staleLocks.length,
      removed: staleLocks.map(summarizeLock)
    }
  }

  function handleEscape() {
    const lock = highestPriorityLock.value
    if (!lock?.onEscape) return false
    lock.onEscape({ reason: 'escape' })
    return true
  }

  function handleOutsidePointer({ reason = 'outside-pointer', restoreFocus = true } = {}) {
    const lock = highestPriorityLock.value
    if (!lock?.onEscape) return false
    lock.onEscape({ reason, restoreFocus: restoreFocus === true })
    return true
  }

  return {
    registerLock,
    releaseLock,
    updateLock,
    clearLocksByScope,
    clearLocksWhere,
    clearStaleLocks,
    handleEscape,
    handleOutsidePointer,
    restoreFocus: (ownerId) => {
      const lock = lockMap.value.get(ownerId)
      if (lock) restoreFocusForLock(lock)
    },
    activeLocks,
    topLocks,
    bottomLocks,
    contentLocks,
    hasTopLock,
    hasBottomLock,
    hasChromeLock,
    highestPriorityLock,
    diagnosticSummary
  }
}

export function provideChromeLockRegistry(registry = createChromeLockRegistry()) {
  provide(CHROME_LOCK_REGISTRY_KEY, registry)
  provide(CHROME_LOCK_REGISTRY_TEST_KEY, registry)
  return registry
}

export function injectChromeLockRegistry() {
  if (!fallbackRegistry) fallbackRegistry = createChromeLockRegistry()
  return inject(CHROME_LOCK_REGISTRY_KEY, fallbackRegistry)
}

export function useChromeLock(source, createLock) {
  const registry = injectChromeLockRegistry()
  let ownerId = null
  watch(
    source,
    (active) => {
      const lock = createLock()
      ownerId = lock.ownerId
      if (active) registry.registerLock(lock)
      else registry.releaseLock(ownerId, { restoreFocus: true })
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    if (ownerId) registry.releaseLock(ownerId)
  })
  return registry
}

export function _resetChromeLockRegistryForTest() {
  fallbackRegistry = null
}
