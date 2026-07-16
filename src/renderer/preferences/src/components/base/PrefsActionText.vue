<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  confirmLabel: { type: String, default: '' },
  confirmHint: { type: String, default: '再点一次确认，3 秒后取消' },
  danger: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  dataTest: { type: String, default: '' },
  confirming: { type: Boolean, default: undefined }
})

const emit = defineEmits(['confirm', 'update:confirming'])

const internalConfirming = ref(false)
const isConfirming = computed(() =>
  props.confirming === undefined ? internalConfirming.value : props.confirming
)

let timer = null

function setConfirming(value) {
  internalConfirming.value = value
  emit('update:confirming', value)
  if (value) {
    window.addEventListener('keydown', onEsc)
    timer = setTimeout(() => setConfirming(false), 3000)
  } else {
    window.removeEventListener('keydown', onEsc)
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}

function onEsc(event) {
  if (event.key === 'Escape') setConfirming(false)
}

watch(
  () => props.confirming,
  (next) => {
    if (next === false && internalConfirming.value) setConfirming(false)
  }
)

function onClick() {
  if (props.disabled) return
  if (!props.confirmLabel) {
    emit('confirm')
    return
  }
  if (isConfirming.value) {
    setConfirming(false)
    emit('confirm')
  } else {
    setConfirming(true)
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEsc)
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <button
    type="button"
    class="prefs-action"
    :class="{ 'is-confirming': isConfirming, danger }"
    :data-test="dataTest || undefined"
    :disabled="disabled"
    @click="onClick"
  >
    {{ isConfirming ? confirmLabel : label }}
  </button>
</template>
