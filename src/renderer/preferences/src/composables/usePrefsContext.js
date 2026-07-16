import { computed, ref } from 'vue'

const contentMode = ref('home')
const fileKind = ref(null)
let bootstrapPromise = null
let listenerRegistered = false

function applyState(state) {
  contentMode.value = state?.content || 'home'
  fileKind.value = state?.content === 'file' ? state.fileKind || null : null
}

function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    try {
      applyState(await window.api.appStateGet())
    } catch (e) {
      console.error('[usePrefsContext] bootstrap failed, will retry on next call:', e)
      bootstrapPromise = null
      throw e
    }
    if (!listenerRegistered) {
      listenerRegistered = true
      window.api.onAppStateChange?.(applyState)
    }
  })()
  return bootstrapPromise
}

export function usePrefsContext() {
  bootstrap().catch(() => {})
  const recommendedMode = computed(() => {
    if (contentMode.value === 'web') return 'web'
    if (contentMode.value === 'file' && ['txt', 'epub', 'pdf'].includes(fileKind.value)) {
      return fileKind.value
    }
    return 'web'
  })
  return { contentMode, fileKind, recommendedMode }
}
