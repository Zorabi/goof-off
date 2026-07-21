import { computed, onMounted, onUnmounted, ref } from 'vue'

export function usePreferenceSection({ defaults, get, set, listen }) {
  const prefs = ref({ ...defaults })
  const status = ref({ kind: '', text: '' })
  const readiness = ref('loading')
  const revision = ref(0)
  const writable = computed(() => readiness.value === 'ready')
  let unlisten = null
  let disposed = true
  let changeRevision = 0
  let subscriptionFailed = false
  const isDisposed = () => disposed

  function apply(next) {
    if (disposed) return prefs.value
    prefs.value = { ...defaults, ...(next || {}) }
    revision.value += 1
    return prefs.value
  }

  function applyChange(next) {
    if (disposed) return prefs.value
    changeRevision += 1
    return apply(next)
  }

  async function load(startedAtRevision = changeRevision) {
    if (disposed) return prefs.value
    if (!subscriptionFailed) readiness.value = 'loading'
    try {
      const next = await get()
      if (disposed) return prefs.value
      if (changeRevision === startedAtRevision) apply(next)
      if (!subscriptionFailed) {
        readiness.value = 'ready'
        status.value = { kind: '', text: '' }
      }
      return prefs.value
    } catch (err) {
      if (disposed) return prefs.value
      readiness.value = 'failed'
      status.value = { kind: 'error', text: err?.message || '读取失败' }
      return prefs.value
    }
  }

  async function savePatch(patch) {
    if (!writable.value || disposed) return prefs.value
    try {
      const next = await set(patch)
      if (disposed) return prefs.value
      apply(next)
      status.value = { kind: '', text: '' }
      return next
    } catch (err) {
      if (!disposed) status.value = { kind: 'error', text: err?.message || '保存失败' }
      return prefs.value
    }
  }

  onMounted(() => {
    disposed = false
    const startedAtRevision = changeRevision
    try {
      const cleanup = listen?.(applyChange)
      unlisten = typeof cleanup === 'function' ? cleanup : null
    } catch (err) {
      subscriptionFailed = true
      unlisten = null
      readiness.value = 'failed'
      status.value = { kind: 'error', text: err?.message || '读取失败' }
    }
    void load(startedAtRevision)
  })

  onUnmounted(() => {
    disposed = true
    const cleanup = unlisten
    unlisten = null
    if (typeof cleanup !== 'function') return
    try {
      cleanup()
    } catch {
      // Listener teardown must not escape after the section is disposed.
    }
  })

  return { prefs, status, readiness, writable, revision, isDisposed, apply, load, savePatch }
}
