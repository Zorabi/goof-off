<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import PrefsSegmented from './base/PrefsSegmented.vue'

const MODES = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const prefs = ref({ mode: 'auto' })
let unlisten = null

function applyPrefs(value) {
  if (value?.mode === 'light' || value?.mode === 'dark' || value?.mode === 'auto') {
    prefs.value = { mode: value.mode }
  }
}

async function setMode(mode) {
  const previous = prefs.value
  try {
    const next = await window.api.themePrefsSet({ mode })
    applyPrefs(next)
  } catch {
    prefs.value = previous
  }
}

onMounted(async () => {
  applyPrefs(await window.api.themePrefsGet())
  unlisten = window.api.onThemePrefsChange?.(applyPrefs) || null
})

onUnmounted(() => {
  unlisten?.()
})
</script>

<template>
  <section class="prefs-sect">
    <div class="prefs-secthead">应用主题</div>
    <div class="prefs-line">
      <span class="prefs-line__label">外观</span>
      <PrefsSegmented
        :options="MODES"
        :model-value="prefs.mode"
        aria-label="应用主题"
        data-test="theme-mode"
        @update:model-value="setMode"
      />
    </div>
  </section>
</template>
