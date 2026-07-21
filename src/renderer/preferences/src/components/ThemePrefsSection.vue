<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import PrefsSegmented from './base/PrefsSegmented.vue'

const MODES = [
  { value: 'auto', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const prefs = ref({ mode: 'auto' })
const readiness = ref('loading')
const status = ref('')
let unlisten = null
let changeRevision = 0
let writeGeneration = 0
let disposed = true

function applyPrefs(value) {
  if (value?.mode === 'light' || value?.mode === 'dark' || value?.mode === 'auto') {
    prefs.value = { mode: value.mode }
  }
}

async function setMode(mode) {
  if (disposed || readiness.value !== 'ready') return
  const generation = ++writeGeneration
  const startedAtRevision = changeRevision
  const previous = { ...prefs.value }
  try {
    const next = await window.api.themePrefsSet({ mode })
    if (disposed || generation !== writeGeneration) return
    if (changeRevision === startedAtRevision) applyPrefs(next)
    status.value = ''
  } catch (error) {
    if (disposed || generation !== writeGeneration) return
    if (changeRevision === startedAtRevision) prefs.value = previous
    status.value = error?.message || '保存失败'
  }
}

onMounted(() => {
  disposed = false
  const startedAtRevision = changeRevision
  try {
    unlisten =
      window.api.onThemePrefsChange?.((next) => {
        if (disposed) return
        changeRevision += 1
        applyPrefs(next)
      }) || null
  } catch (error) {
    unlisten = null
    readiness.value = 'failed'
    status.value = error?.message || '读取失败'
  }

  let request
  try {
    request = window.api.themePrefsGet()
  } catch (error) {
    readiness.value = 'failed'
    status.value = error?.message || '读取失败'
    return
  }
  void Promise.resolve(request)
    .then((next) => {
      if (disposed) return
      if (changeRevision === startedAtRevision) applyPrefs(next)
      if (readiness.value !== 'failed') {
        readiness.value = 'ready'
        status.value = ''
      }
    })
    .catch((error) => {
      if (disposed) return
      readiness.value = 'failed'
      status.value = error?.message || '读取失败'
    })
})

onUnmounted(() => {
  disposed = true
  unlisten?.()
  unlisten = null
})
</script>

<template>
  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
    <div class="prefs-secthead">应用主题</div>
    <div v-if="status" class="prefs-line__hint is-danger">{{ status }}</div>
    <div class="prefs-line">
      <span class="prefs-line__label">外观</span>
      <PrefsSegmented
        :options="MODES"
        :model-value="prefs.mode"
        :disabled="readiness !== 'ready'"
        aria-label="应用主题"
        data-test="theme-mode"
        @update:model-value="setMode"
      />
    </div>
  </section>
</template>
