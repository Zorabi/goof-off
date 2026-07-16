import { ref } from 'vue'
import { normalizeTransparencyPrefs } from '../../../shared/transparencyPrefs.js'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'

const initialPrefs = globalThis.window?.api?.initialTransparencyPrefs
const prefs = ref(normalizeTransparencyPrefs(initialPrefs))
const ready = ref(Boolean(initialPrefs))

let bootstrapped = false
let unlisten = null

function applyPrefs(nextPrefs) {
  prefs.value = normalizeTransparencyPrefs(nextPrefs)
  ready.value = true
}

async function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  applyPrefs(await window.api.transparencyPrefsGet())
  if (!unlisten) {
    unlisten = window.api.onTransparencyPrefsChange?.(applyPrefs) || null
  }
}

export function useTransparency() {
  bootstrap().catch((e) => {
    console.error('[useTransparency] bootstrap failed:', e)
    ready.value = false
    bootstrapped = false
  })

  async function setToggle(kind, value) {
    try {
      const next = await window.api.transparencyPrefsSet({
        toggle: { kind, value }
      })
      if (next) applyPrefs(next)
      logDiagnostic('transparency.toggle', { kind, value, ok: true })
      return next
    } catch (error) {
      logDiagnosticError('transparency.toggle', error, { kind, value, ok: false })
      throw error
    }
  }

  async function setPatch(patch) {
    const next = await window.api.transparencyPrefsSet({ patch })
    if (next) applyPrefs(next)
  }

  return { prefs, ready, setToggle, setPatch }
}
