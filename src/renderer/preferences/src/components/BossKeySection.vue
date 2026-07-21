<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { formatAccelerator } from '../../../../shared/platformPolicy.js'

const keys = ref({ hide: '', kill: '' })
const listening = ref(null)
const error = ref({ which: null, text: '' })
const readiness = ref('loading')
const loadError = ref('')
const platformPolicy = window.api?.platformPolicy
let unlisten = null
let disposed = true
let changeRevision = 0
let subscriptionFailed = false

function applyKeys(next) {
  if (disposed) return
  keys.value = next
}

onMounted(() => {
  disposed = false
  const startedAtRevision = changeRevision
  try {
    const cleanup = window.api.onBossKeyChange?.((next) => {
      if (disposed) return
      changeRevision += 1
      applyKeys(next)
    })
    unlisten = typeof cleanup === 'function' ? cleanup : null
  } catch (err) {
    subscriptionFailed = true
    unlisten = null
    readiness.value = 'failed'
    loadError.value = err?.message || '读取失败'
  }
  void (async () => {
    try {
      const next = await window.api.bossKeyGet()
      if (disposed) return
      if (changeRevision === startedAtRevision) applyKeys(next)
      if (!subscriptionFailed) {
        readiness.value = 'ready'
        loadError.value = ''
      }
    } catch (err) {
      if (disposed) return
      readiness.value = 'failed'
      loadError.value = err?.message || '读取失败'
    }
  })()
})

onBeforeUnmount(() => {
  disposed = true
  if (listening.value) stopListening()
  const cleanup = unlisten
  unlisten = null
  if (typeof cleanup !== 'function') return
  try {
    cleanup()
  } catch {
    // Listener teardown must not escape after the section is disposed.
  }
})

function startListening(which) {
  if (readiness.value !== 'ready') return
  if (listening.value) stopListening()
  error.value = { which: null, text: '' }
  listening.value = which
  window.addEventListener('keydown', onKey)
}

function stopListening() {
  listening.value = null
  window.removeEventListener('keydown', onKey)
}

async function onKey(event) {
  event.preventDefault()
  if (event.key === 'Escape') {
    stopListening()
    return
  }
  if (!event.key || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
  const accel = toAccelerator(event)
  const which = listening.value
  stopListening()
  let ok
  try {
    ok = await window.api.bossKeySet(which, accel)
  } catch (err) {
    if (disposed) return
    error.value = { which, text: err?.message || '保存失败' }
    return
  }
  if (disposed) return
  if (ok) {
    applyKeys({ ...keys.value, [which]: accel })
  } else {
    error.value = { which, text: `"${accel}" 被占用，保留原键位` }
  }
}

function toAccelerator(event) {
  const parts = []
  if (event.shiftKey) parts.push('Shift')
  if (event.ctrlKey) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.metaKey) parts.push('Command')
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key)
  return parts.join('+')
}

function display(accel) {
  return formatAccelerator(accel, platformPolicy)
}

async function resetKeys() {
  if (readiness.value !== 'ready') return
  if (listening.value) stopListening()
  error.value = { which: null, text: '' }
  let result
  try {
    result = await window.api.bossKeyReset()
  } catch (err) {
    if (disposed) return
    error.value = { which: null, text: err?.message || '恢复失败' }
    return
  }
  if (disposed) return
  if (!result?.ok) return
  applyKeys(result.keys)
  if (result.failures?.length) {
    error.value = { which: result.failures[0], text: '默认键位被占用，保留原键位' }
  }
}
</script>

<template>
  <section
    class="prefs-sect"
    :class="{ 'is-loading': readiness === 'loading' }"
    :aria-busy="readiness === 'loading' ? 'true' : undefined"
  >
    <div class="prefs-secthead">老板键</div>
    <div v-if="loadError" class="prefs-line__hint is-danger">{{ loadError }}</div>
    <div v-if="error.which === null && error.text" class="prefs-line__hint is-danger">
      {{ error.text }}
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">隐藏</div>
        <div v-if="error.which === 'hide'" class="prefs-line__hint is-danger">{{ error.text }}</div>
      </div>
      <button
        type="button"
        class="prefs-keybtn"
        :class="{ 'is-listening': listening === 'hide' }"
        data-test="boss-hide"
        :disabled="readiness !== 'ready'"
        @click="startListening('hide')"
      >
        {{ listening === 'hide' ? '按下按键组合…' : display(keys.hide) }}
      </button>
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">熔断</div>
        <div v-if="error.which === 'kill'" class="prefs-line__hint is-danger">{{ error.text }}</div>
      </div>
      <button
        type="button"
        class="prefs-keybtn"
        :class="{ 'is-listening': listening === 'kill' }"
        data-test="boss-kill"
        :disabled="readiness !== 'ready'"
        @click="startListening('kill')"
      >
        {{ listening === 'kill' ? '按下按键组合…' : display(keys.kill) }}
      </button>
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">键位设置</span>
      <button
        type="button"
        class="prefs-action"
        data-test="boss-reset"
        :disabled="readiness !== 'ready'"
        @click="resetKeys"
      >
        恢复默认
      </button>
    </div>
  </section>
</template>
