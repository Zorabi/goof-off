<script setup>
const props = defineProps({
  modelValue: { type: Boolean, required: true },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  title: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

function toggle() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    class="switch-field"
    :class="{ 'is-disabled': disabled }"
    role="switch"
    :aria-label="label"
    :aria-checked="String(modelValue)"
    :disabled="disabled"
    :title="title || undefined"
    @click="toggle"
  >
    <span class="switch-label">{{ label }}</span>
    <span class="switch-control" aria-hidden="true">
      <span class="switch-knob" />
    </span>
  </button>
</template>

<style scoped>
.switch-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  width: 100%;
  min-height: var(--hit-min);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  text-align: left;
}

.switch-field:disabled {
  opacity: var(--opacity-disabled);
}

.switch-label {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
}

.switch-control {
  position: relative;
  flex: 0 0 auto;
  width: var(--switch-w);
  height: var(--switch-h);
  padding: 0;
  border: 1px solid var(--color-divider);
  border-radius: 999px;
  background: var(--color-switch-track-off);
  cursor: pointer;
  transition: background var(--motion-micro) ease;
}

.switch-field:disabled .switch-control {
  cursor: default;
}

.switch-field[aria-checked='true'] .switch-control {
  background: var(--color-switch-track-on);
}

.switch-field:focus-visible {
  outline: none;
}

.switch-field:focus-visible .switch-control {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.switch-knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: var(--switch-knob);
  height: var(--switch-knob);
  border-radius: 50%;
  background: var(--color-switch-knob);
  transition: transform var(--motion-micro) ease;
}

.switch-field[aria-checked='true'] .switch-knob {
  transform: translateX(calc(var(--switch-w) - var(--switch-knob) - 4px));
}

@media (prefers-reduced-motion: reduce) {
  .switch-control,
  .switch-knob {
    transition: none;
  }
}
</style>
