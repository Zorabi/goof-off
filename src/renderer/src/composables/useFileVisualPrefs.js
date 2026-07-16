import { computed, readonly, ref } from 'vue'
import {
  DEFAULT_FILE_VISUAL_PREFS,
  buildFileVisualState,
  normalizeFileVisualPrefs
} from '../../../shared/fileVisualPrefs.js'

const prefs = ref({ ...DEFAULT_FILE_VISUAL_PREFS })
let bootstrapped = false

export function useFileVisualPrefs() {
  if (!bootstrapped) {
    bootstrapped = true
    const api = window.api || {}
    const getPrefs = api.fileVisualPrefsGet
    if (typeof getPrefs === 'function') {
      getPrefs()
        .then((value) => {
          prefs.value = normalizeFileVisualPrefs(value)
        })
        .catch(() => {
          prefs.value = { ...DEFAULT_FILE_VISUAL_PREFS }
        })
    } else {
      prefs.value = { ...DEFAULT_FILE_VISUAL_PREFS }
    }
    api.onFileVisualPrefsChange?.((value) => {
      prefs.value = normalizeFileVisualPrefs(value)
    })
  }

  const fileVisualState = computed(() => buildFileVisualState(prefs.value))

  return {
    prefs: readonly(prefs),
    fileVisualState,
    gradientCss: computed(() => fileVisualState.value.gradientCss),
    hasCustomGradient: computed(() => fileVisualState.value.hasCustomGradient),
    effectiveTextColor: computed(() => fileVisualState.value.effectiveTextColor),
    selectionCssVars: computed(() => fileVisualState.value.selectionCssVars)
  }
}
