<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { displayKeyDescriptor, eventToPageKeyDescriptor } from '../utils/keyDescriptor.js'

const props = defineProps({
  value: { type: String, required: true },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['record', 'reject'])
const listening = ref(false)
const platformPolicy = computed(() => window.api?.platformPolicy)

const label = computed(() =>
  listening.value ? '按下按键组合…' : displayKeyDescriptor(props.value, platformPolicy.value)
)

function stopListening() {
  listening.value = false
  window.removeEventListener('keydown', onKeydown)
}

function startListening() {
  if (props.disabled) return
  if (listening.value) stopListening()
  listening.value = true
  window.addEventListener('keydown', onKeydown)
}

function onKeydown(event) {
  event.preventDefault()
  if (event.key === 'Escape') {
    stopListening()
    return
  }
  const result = eventToPageKeyDescriptor(event, platformPolicy.value)
  if (!result) return
  stopListening()
  if (!result.ok) emit('reject', result.reason)
  else emit('record', result.value)
}

onBeforeUnmount(() => {
  if (listening.value) stopListening()
})
</script>

<template>
  <button
    type="button"
    class="prefs-keybtn"
    :class="{ 'is-listening': listening }"
    :disabled="props.disabled"
    data-test="key-capture"
    @click="startListening"
  >
    {{ label }}
  </button>
</template>
