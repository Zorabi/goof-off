import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { displayAddressText, resolveAddressSubmit } from './addressInputModel.js'
import { injectChromeLockRegistry } from './useChromeLockRegistry.js'
import { logDiagnostic } from './useDiagnosticLog.js'

const ADDRESS_LOCK_ID = 'top.address-input'
const DEFAULT_SUGGESTION_DEBOUNCE_MS = 100

function diagnosticAddressUrl(rawUrl) {
  if (!rawUrl) return undefined
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

export function useAddressInput(options = {}) {
  const mode = options.mode || 'home'
  const currentUrl = options.currentUrl || ref('')
  const chromeLocks = options.chromeLocks || injectChromeLockRegistry()
  const appState = options.appState || null
  const onCommit = options.onCommit
  const onEmptySubmit = options.onEmptySubmit
  const suggestionDebounceMs = Number.isFinite(options.suggestionDebounceMs)
    ? Math.max(0, options.suggestionDebounceMs)
    : DEFAULT_SUGGESTION_DEBOUNCE_MS

  const editing = ref(false)
  const inputValue = ref('')
  const suggestions = ref([])
  const activeIndex = ref(-1)
  const loading = ref(false)
  const suggestionSeq = ref(0)
  let blurTimer = null

  const displayValue = computed(() =>
    editing.value ? inputValue.value : displayAddressText(unref(currentUrl), 'idle')
  )

  function invalidateSuggestions() {
    suggestionSeq.value += 1
  }

  function clearDeferredBlur() {
    if (blurTimer) clearTimeout(blurTimer)
    blurTimer = null
  }

  function cancelDeferredBlur() {
    clearDeferredBlur()
  }

  function deferBlur(delay = 120) {
    clearDeferredBlur()
    blurTimer = setTimeout(() => {
      blurTimer = null
      blur()
    }, delay)
  }

  async function closeSuggestions() {
    cancelPendingSuggestionLoad()
    suggestions.value = []
    activeIndex.value = -1
    loading.value = false
    invalidateSuggestions()
  }

  async function cleanupTopInteraction() {
    clearDeferredBlur()
    editing.value = false
    inputValue.value = ''
    chromeLocks.releaseLock(ADDRESS_LOCK_ID)
    await closeSuggestions()
  }

  function registerLock() {
    chromeLocks.registerLock({
      ownerId: ADDRESS_LOCK_ID,
      kind: 'input',
      scope: 'top',
      priority: 60,
      mutexGroup: 'top.primary-interaction',
      appliesTo: { content: ['home', 'history', 'web'], form: ['normal'] },
      focusRestore: { mode: 'none' },
      onEscape: escape
    })
  }

  function focus() {
    editing.value = true
    inputValue.value = mode === 'web' ? String(unref(currentUrl) || '') : ''
    registerLock()
  }

  async function blur() {
    await cleanupTopInteraction()
  }

  async function loadSuggestions(query) {
    const seq = ++suggestionSeq.value
    const querySnapshot = String(query || '')
    if (!querySnapshot.trim()) {
      suggestions.value = []
      activeIndex.value = -1
      loading.value = false
      return
    }
    loading.value = true
    let result
    try {
      result = await window.api?.addressSuggestions?.({ query: querySnapshot, limit: 5 })
    } catch {
      result = { ok: false, items: [] }
    }
    if (seq !== suggestionSeq.value || !editing.value || inputValue.value !== querySnapshot) return
    loading.value = false
    suggestions.value = result?.ok && Array.isArray(result.items) ? result.items.slice(0, 5) : []
    activeIndex.value = -1
  }

  let suggestionDebounceTimer = null

  function cancelPendingSuggestionLoad() {
    if (suggestionDebounceTimer) {
      clearTimeout(suggestionDebounceTimer)
      suggestionDebounceTimer = null
    }
  }

  function setInputValue(value) {
    inputValue.value = String(value || '')
    cancelPendingSuggestionLoad()
    // 空输入立即清空联想面板；非空输入防抖，避免每个按键一次 IPC 往返
    if (!inputValue.value.trim() || suggestionDebounceMs === 0) {
      loadSuggestions(inputValue.value)
      return
    }
    suggestionDebounceTimer = setTimeout(() => {
      suggestionDebounceTimer = null
      loadSuggestions(inputValue.value)
    }, suggestionDebounceMs)
  }

  async function setSuggestionPanelHeight() {
    return undefined
  }

  function moveActive(delta) {
    if (suggestions.value.length === 0) return
    if (activeIndex.value < 0) {
      activeIndex.value = delta > 0 ? 0 : suggestions.value.length - 1
      return
    }
    activeIndex.value =
      (activeIndex.value + delta + suggestions.value.length) % suggestions.value.length
  }

  function setActiveIndex(index) {
    if (suggestions.value.length === 0) {
      activeIndex.value = -1
      return
    }
    const normalized = Number(index)
    activeIndex.value =
      Number.isInteger(normalized) && normalized >= 0 && normalized < suggestions.value.length
        ? normalized
        : -1
  }

  async function commit() {
    const selected = activeIndex.value >= 0 ? suggestions.value[activeIndex.value] : null
    if (selected) {
      await onCommit?.(selected.targetUrl, { source: selected.source })
      await logDiagnostic('address.commit', {
        source: selected.source,
        ok: true,
        reason: undefined,
        url: diagnosticAddressUrl(selected.targetUrl)
      })
      await blur()
      return
    }

    const submit = resolveAddressSubmit(inputValue.value, mode)
    if (submit.kind === 'navigate') {
      await onCommit?.(submit.url, { source: submit.source })
      await logDiagnostic('address.commit', {
        source: submit.source,
        ok: true,
        reason: undefined,
        url: diagnosticAddressUrl(submit.url)
      })
    } else {
      await onEmptySubmit?.({ kind: submit.kind })
      await logDiagnostic('address.commit', {
        source: submit.source,
        ok: true,
        reason: submit.kind,
        url: undefined
      })
    }
    await blur()
  }

  async function escape() {
    await blur()
  }

  if (appState) {
    watch(
      () => {
        const state = unref(appState)
        return [state?.hidden === true, state?.form]
      },
      ([hidden, form]) => {
        if (hidden || form === 'mini') cleanupTopInteraction()
      },
      { flush: 'sync' }
    )
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      clearDeferredBlur()
      cleanupTopInteraction()
    })
  }

  return {
    editing,
    inputValue,
    displayValue,
    suggestions,
    activeIndex,
    loading,
    focus,
    blur,
    deferBlur,
    cancelDeferredBlur,
    setInputValue,
    setSuggestionPanelHeight,
    moveActive,
    setActiveIndex,
    commit,
    escape
  }
}
