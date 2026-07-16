import { onMounted, onUnmounted, ref } from 'vue'

export function usePreferenceSection({ defaults, get, set, listen }) {
  const prefs = ref({ ...defaults })
  const status = ref({ kind: '', text: '' })
  const revision = ref(0)
  let unlisten = null

  function apply(next) {
    prefs.value = { ...defaults, ...(next || {}) }
    revision.value += 1
  }

  async function load() {
    try {
      apply(await get())
      status.value = { kind: '', text: '' }
    } catch (err) {
      status.value = { kind: 'error', text: err?.message || '读取失败' }
    }
  }

  async function savePatch(patch) {
    try {
      const next = await set(patch)
      apply(next)
      status.value = { kind: '', text: '' }
      return next
    } catch (err) {
      status.value = { kind: 'error', text: err?.message || '保存失败' }
      return prefs.value
    }
  }

  onMounted(() => {
    load()
    unlisten = listen?.(apply) || null
  })

  onUnmounted(() => {
    unlisten?.()
  })

  return { prefs, status, revision, apply, load, savePatch }
}
