import { ref } from 'vue'
import {
  applyTransparencyToggle,
  normalizeTransparencyPrefs
} from '../../../shared/transparencyPrefs.js'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'

const initialPrefs = globalThis.window?.api?.initialTransparencyPrefs
const prefs = ref(normalizeTransparencyPrefs(initialPrefs))
const ready = ref(Boolean(initialPrefs))

let bootstrapped = false
let unlisten = null
let changeRevision = 0
let writeGeneration = 0

function applyPrefs(nextPrefs, { external = false } = {}) {
  prefs.value = normalizeTransparencyPrefs(nextPrefs)
  ready.value = true
  if (external) changeRevision += 1
}

async function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  applyPrefs(await window.api.transparencyPrefsGet())
  if (!unlisten) {
    unlisten =
      window.api.onTransparencyPrefsChange?.((next) => {
        applyPrefs(next, { external: true })
      }) || null
  }
}

export function useTransparency() {
  bootstrap().catch((e) => {
    console.error('[useTransparency] bootstrap failed:', e)
    ready.value = false
    bootstrapped = false
  })

  async function setToggle(kind, value) {
    const generation = ++writeGeneration
    const startedAtRevision = changeRevision
    const previous = prefs.value
    // Reflect the user's click immediately. The authoritative response or an
    // external change event will replace this draft once the write settles.
    applyPrefs(applyTransparencyToggle(previous, { kind, value }))
    try {
      const next = await window.api.transparencyPrefsSet({
        toggle: { kind, value }
      })
      if (generation !== writeGeneration) return next
      if (next && changeRevision === startedAtRevision) applyPrefs(next)
      logDiagnostic('transparency.toggle', { kind, value, ok: true })
      return next
    } catch (error) {
      if (generation === writeGeneration && changeRevision === startedAtRevision) {
        applyPrefs(previous)
      }
      logDiagnosticError('transparency.toggle', error, { kind, value, ok: false })
      throw error
    }
  }

  async function setPatch(patch) {
    const generation = ++writeGeneration
    const startedAtRevision = changeRevision
    const next = await window.api.transparencyPrefsSet({ patch })
    if (generation !== writeGeneration) return next
    if (next && changeRevision === startedAtRevision) applyPrefs(next)
    return next
  }

  return { prefs, ready, setToggle, setPatch }
}
