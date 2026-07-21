import { computed, ref } from 'vue'

const contentMode = ref('home')
const fileKind = ref(null)
let listenerRegistered = false
let appStateChangeRevision = 0
let appStateRequestGeneration = 0

function applyState(state) {
  contentMode.value = state?.content || 'home'
  fileKind.value = state?.content === 'file' ? state.fileKind || null : null
}

function ensureAppStateListener() {
  if (listenerRegistered) return
  try {
    const result = window.api.onAppStateChange?.((state) => {
      appStateChangeRevision += 1
      applyState(state)
    })
    if (result && typeof result.then === 'function') result.catch(() => {})
    listenerRegistered = true
  } catch (error) {
    listenerRegistered = false
    throw error
  }
}

async function bootstrap() {
  const requestGeneration = ++appStateRequestGeneration
  const startedAtRevision = appStateChangeRevision
  try {
    ensureAppStateListener()
    const state = await window.api.appStateGet()
    if (
      requestGeneration === appStateRequestGeneration &&
      appStateChangeRevision === startedAtRevision
    ) {
      applyState(state)
    }
    return state
  } catch {
    if (
      requestGeneration === appStateRequestGeneration &&
      appStateChangeRevision === startedAtRevision
    ) {
      applyState(null)
    }
    return null
  }
}

export function usePrefsContext() {
  void bootstrap().catch(() => {})
  const recommendedMode = computed(() => {
    if (contentMode.value === 'web') return 'web'
    if (contentMode.value === 'file' && ['txt', 'epub', 'pdf'].includes(fileKind.value)) {
      return fileKind.value
    }
    return 'web'
  })
  return { contentMode, fileKind, recommendedMode }
}
