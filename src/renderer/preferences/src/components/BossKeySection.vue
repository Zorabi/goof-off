<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { formatAccelerator } from '../../../../shared/platformPolicy.js'

const keys = ref({ hide: '', kill: '' })
const listening = ref(null)
const error = ref({ which: null, text: '' })
const platformPolicy = window.api?.platformPolicy
let unlisten = null

onMounted(async () => {
  keys.value = await window.api.bossKeyGet()
  unlisten = window.api.onBossKeyChange?.((next) => {
    keys.value = next
  })
})

onBeforeUnmount(() => {
  if (listening.value) stopListening()
  unlisten?.()
})

function startListening(which) {
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
  const ok = await window.api.bossKeySet(which, accel)
  if (ok) {
    keys.value = { ...keys.value, [which]: accel }
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
  if (listening.value) stopListening()
  error.value = { which: null, text: '' }
  const result = await window.api.bossKeyReset()
  if (!result?.ok) return
  keys.value = result.keys
  if (result.failures?.length) {
    error.value = { which: result.failures[0], text: '默认键位被占用，保留原键位' }
  }
}
</script>

<template>
  <section class="prefs-sect">
    <div class="prefs-secthead">老板键</div>
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
        @click="startListening('kill')"
      >
        {{ listening === 'kill' ? '按下按键组合…' : display(keys.kill) }}
      </button>
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">键位设置</span>
      <button type="button" class="prefs-action" data-test="boss-reset" @click="resetKeys">
        恢复默认
      </button>
    </div>
  </section>
</template>
