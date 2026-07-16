import { ref, onMounted } from 'vue'

export function useWindowControls() {
  const alwaysOnTop = ref(false)

  onMounted(async () => {
    alwaysOnTop.value = (await window.api?.getConfig?.('alwaysOnTop')) ?? false
  })

  const toggleAlwaysOnTop = () => {
    alwaysOnTop.value = !alwaysOnTop.value
    window.api?.setAlwaysOnTop?.(alwaysOnTop.value)
  }

  const minimize = () => window.api?.minimizeWindow?.()
  const close = () => window.api?.closeWindow?.()

  return { alwaysOnTop, toggleAlwaysOnTop, minimize, close }
}
