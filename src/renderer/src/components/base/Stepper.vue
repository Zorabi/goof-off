<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: { type: Number, default: 1 },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  format: { type: Function, default: null }
})

const emit = defineEmits(['update:modelValue'])

const displayValue = computed(() => {
  return props.format ? props.format(props.modelValue) : String(props.modelValue)
})
const canDecrease = computed(() => !props.disabled && props.modelValue > props.min)
const canIncrease = computed(() => !props.disabled && props.modelValue < props.max)

function clamp(value) {
  return Math.min(props.max, Math.max(props.min, value))
}

function update(delta) {
  if (props.disabled) return
  const next = clamp(Number((props.modelValue + delta).toFixed(2)))
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function onKeydown(event) {
  if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
    event.preventDefault()
    update(props.step)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
    event.preventDefault()
    update(-props.step)
  }
}
</script>

<template>
  <div
    class="stepper"
    :class="{ 'is-disabled': disabled }"
    role="group"
    :aria-label="label"
    tabindex="0"
    @keydown="onKeydown"
  >
    <span class="stepper-label">{{ label }}</span>
    <div class="stepper-control">
      <button
        type="button"
        class="stepper-button"
        aria-label="减少"
        :disabled="!canDecrease"
        @click="update(-step)"
      >
        -
      </button>
      <span class="stepper-value" aria-live="polite">{{ displayValue }}</span>
      <button
        type="button"
        class="stepper-button"
        aria-label="增加"
        :disabled="!canIncrease"
        @click="update(step)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.stepper {
  display: grid;
  grid-template-columns: minmax(48px, 1fr) auto;
  align-items: center;
  gap: var(--space-md);
  min-height: var(--hit-min);
  color: var(--color-text-primary);
  outline: none;
}

.stepper:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.stepper.is-disabled {
  opacity: var(--opacity-disabled);
}

.stepper-label {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
}

.stepper-control {
  display: inline-grid;
  grid-template-columns: var(--hit-min) minmax(42px, auto) var(--hit-min);
  align-items: center;
  min-height: var(--hit-min);
  overflow: hidden;
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-button);
  background: var(--color-surface-panel);
}

.stepper-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--text-section-size);
  line-height: 1;
  transition:
    background var(--motion-micro) ease,
    color var(--motion-micro) ease;
}

.stepper-button:not(:disabled):hover {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
}

.stepper-button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.stepper-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}

.stepper-value {
  min-width: 42px;
  padding: 0 var(--space-sm);
  color: var(--color-text-primary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .stepper-button {
    transition: none;
  }
}
</style>
