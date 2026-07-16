import { watch } from 'vue'
import { useAppState } from './useAppState.js'
import { useTransparency } from './useTransparency.js'
import { initialState } from './appStateReducer.js'
import { resolveFramePolicy } from '../../../shared/framePolicy.js'
import { resolveEffectiveOpacity } from '../../../shared/transparencyPrefs.js'

function statesEqual(a, b) {
  return (
    a.content === b.content &&
    a.fileKind === b.fileKind &&
    a.form === b.form &&
    a.hidden === b.hidden
  )
}

export function useAppStateEffects(api) {
  const { state, dispatch } = api ?? useAppState()
  const transparency = useTransparency()
  const { prefs } = transparency

  // hydrate skips when state has already diverged from initial — avoids clobbering early nav
  window.api
    .appStateGet({ purpose: 'startup-hydrate' })
    .then((persisted) => {
      if (!persisted) return
      if (!statesEqual(state, initialState())) return
      dispatch({ type: 'HYDRATE', payload: persisted })
    })
    .catch((e) => console.error('[appState] hydrate failed:', e))

  window.api.onBossHidden(() => dispatch({ type: 'BOSS_HIDE' }))
  window.api.onBossRestored(() => dispatch({ type: 'BOSS_RESTORE' }))

  watch(
    () => ({ content: state.content, fileKind: state.fileKind, form: state.form }),
    (snapshot) => {
      window.api
        .appStatePersist(snapshot)
        .catch((e) => console.error('[appState] persist failed:', e))
      if (snapshot.content === 'home' || snapshot.content === 'history') {
        const clearResult = window.api.startupRestoreClear?.()
        clearResult?.catch?.((e) => {
          console.warn('[appStateEffects] startupRestoreClear failed:', e)
        })
      }
    },
    { deep: false }
  )

  watch(
    () => {
      if (transparency.ready && !transparency.ready.value) return null
      const effective = resolveEffectiveOpacity(prefs.value)
      return resolveFramePolicy({
        shellBackgroundHidden: effective.shellBackgroundHidden,
        interfaceOpacity: effective.interfaceOpacity ?? effective.contentOpacity ?? 1
      })
    },
    (framePolicy) => {
      if (!framePolicy) return
      window.api.setShadowPolicy(framePolicy.shouldHideShadow)
      document.documentElement.style.setProperty('--frame-alpha', String(framePolicy.frameAlpha))
    },
    { immediate: true }
  )

  watch(
    () => ({ content: state.content, form: state.form }),
    ({ content, form }) => {
      const shouldShow = content === 'web' && form !== 'mini'
      window.api.browserSetVisible(shouldShow).catch((err) => {
        console.warn('[appStateEffects] browserSetVisible failed:', err)
      })
    },
    { immediate: true }
  )

  watch(
    () => state.form,
    (form) => {
      window.api.windowSetForm(form).catch((err) => {
        console.warn('[appStateEffects] windowSetForm failed:', err)
      })
    },
    { immediate: true }
  )
}
