<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: { type: Number, default: 1 },
  suffix: { type: String, default: '' },
  scale: { type: Number, default: 1 },
  syncKey: { type: [String, Number], default: 0 },
  disabled: { type: Boolean, default: false },
  dataTest: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])
const focused = ref(false)
let pendingDisplayValue = null
let pendingSettleTimer = null

function round2(value) {
  return Math.round(value * 100) / 100
}

function toDisplay(modelValue) {
  return round2(modelValue * props.scale)
}

const draftDisplayValue = ref(toDisplay(props.modelValue))
watch([() => props.modelValue, () => props.scale, () => props.syncKey], ([modelValue]) => {
  const next = toDisplay(modelValue)
  if (pendingDisplayValue != null) {
    if (Object.is(next, pendingDisplayValue)) {
      pendingDisplayValue = null
      if (pendingSettleTimer != null) clearTimeout(pendingSettleTimer)
      pendingSettleTimer = null
      draftDisplayValue.value = next
    }
    return
  }
  draftDisplayValue.value = next
})

const displayValue = computed(() => draftDisplayValue.value)
const displayMin = computed(() => round2(props.min * props.scale))
const displayMax = computed(() => round2(props.max * props.scale))
const displayStep = computed(() => round2(props.step * props.scale))

const inputWidth = computed(() => `calc(${Math.max(String(displayValue.value).length, 2)}ch + 2px)`)

function clampDisplay(value) {
  return Math.min(displayMax.value, Math.max(displayMin.value, value))
}

function commitDisplay(value) {
  const next = clampDisplay(round2(value))
  draftDisplayValue.value = next
  pendingDisplayValue = next
  emit('update:modelValue', props.scale === 1 ? next : round2(next / props.scale))
  if (pendingSettleTimer != null) clearTimeout(pendingSettleTimer)
  pendingSettleTimer = setTimeout(() => {
    pendingSettleTimer = null
    if (pendingDisplayValue !== next) return
    pendingDisplayValue = null
    draftDisplayValue.value = toDisplay(props.modelValue)
  }, 1200)
  return next
}

onBeforeUnmount(() => {
  if (pendingSettleTimer != null) clearTimeout(pendingSettleTimer)
})

function bump(direction) {
  if (props.disabled) return
  commitDisplay(displayValue.value + direction * displayStep.value)
}

function onInputCommit(event) {
  const raw = Number(event.target.value)
  if (Number.isNaN(raw)) {
    event.target.value = String(displayValue.value)
    return
  }
  event.target.value = String(commitDisplay(raw))
}
</script>

<template>
  <span class="prefs-stepper" :class="{ disabled, 'is-focused': focused }">
    <button
      type="button"
      class="prefs-stepper__btn prefs-stepper__btn--minus"
      :disabled="disabled || displayValue <= displayMin"
      aria-label="减少"
      @click="bump(-1)"
    >
      −
    </button>
    <input
      class="prefs-stepper__input"
      type="number"
      :data-test="dataTest || undefined"
      :min="displayMin"
      :max="displayMax"
      :step="displayStep"
      :value="displayValue"
      :disabled="disabled"
      :style="{ width: inputWidth }"
      @focus="focused = true"
      @blur="focused = false"
      @change="onInputCommit"
    />
    <span v-if="suffix" class="prefs-stepper__suffix">{{ suffix }}</span>
    <button
      type="button"
      class="prefs-stepper__btn prefs-stepper__btn--plus"
      :disabled="disabled || displayValue >= displayMax"
      aria-label="增加"
      @click="bump(1)"
    >
      +
    </button>
  </span>
</template>
