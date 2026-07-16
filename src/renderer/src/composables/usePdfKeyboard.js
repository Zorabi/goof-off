import { onMounted, onUnmounted } from 'vue'

export function usePdfKeyboard(stepZoom, resetZoom) {
  function handleKeydown(e) {
    if (!e.metaKey && !e.ctrlKey) return
    if (e.key === '=' || e.key === '+') {
      e.preventDefault()
      stepZoom(1)
    } else if (e.key === '-') {
      e.preventDefault()
      stepZoom(-1)
    } else if (e.key === '0') {
      e.preventDefault()
      resetZoom()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return { handleKeydown }
}
