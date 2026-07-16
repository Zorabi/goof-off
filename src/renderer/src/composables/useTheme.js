import { ref, onMounted } from 'vue'

export function useTheme() {
  const isDark = ref(false)

  const applyTheme = (dark) => {
    document.documentElement.classList.toggle('dark', dark)
    isDark.value = dark
  }

  onMounted(async () => {
    const dark = await window.api.getTheme()
    applyTheme(dark)
    window.api.onThemeChange(applyTheme)
  })

  return { isDark }
}
