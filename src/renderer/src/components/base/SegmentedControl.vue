<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], required: true },
  options: { type: Array, required: true },
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false },
  hideLabel: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

const selectedIndex = computed(() => {
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  return index >= 0 ? index : 0
})

function choose(value) {
  if (props.disabled || value === props.modelValue) return
  emit('update:modelValue', value)
}

function chooseByIndex(index) {
  const option = props.options[index]
  if (option) choose(option.value)
}

function onKeydown(event) {
  if (props.disabled || props.options.length === 0) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    chooseByIndex(Math.max(0, selectedIndex.value - 1))
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    chooseByIndex(Math.min(props.options.length - 1, selectedIndex.value + 1))
  } else if (event.key === 'Home') {
    event.preventDefault()
    chooseByIndex(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    chooseByIndex(props.options.length - 1)
  }
}
</script>

<template>
  <div class="segmented-field" :class="{ 'is-disabled': disabled }">
    <span v-if="!hideLabel" class="segmented-label">{{ label }}</span>
    <div
      class="segmented-control"
      role="group"
      :aria-label="label"
      tabindex="0"
      @keydown="onKeydown"
    >
      <button
        v-for="option in options"
        :key="String(option.value)"
        type="button"
        class="segmented-option"
        :class="{ 'is-selected': option.value === modelValue }"
        :aria-pressed="String(option.value === modelValue)"
        :disabled="disabled"
        @click="choose(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.segmented-field {
  display: grid;
  gap: var(--space-sm);
  color: var(--color-text-primary);
}

.segmented-field.is-disabled {
  opacity: var(--opacity-disabled);
}

.segmented-label {
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
}

.segmented-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-height: var(--hit-min);
  padding: var(--space-xs);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-button);
  background: var(--color-surface-panel);
  outline: none;
}

.segmented-control:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.segmented-option {
  min-height: var(--hit-min);
  min-width: var(--hit-min);
  padding: 0 var(--space-sm);
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--text-meta-size);
  line-height: 1;
  transition:
    background var(--motion-micro) ease,
    color var(--motion-micro) ease;
}

.segmented-option:not(:disabled):hover {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
}

.segmented-option.is-selected {
  background: var(--color-active-icon-bg);
  color: var(--color-active-icon);
}

.segmented-option:disabled {
  cursor: not-allowed;
}

.segmented-option:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .segmented-option {
    transition: none;
  }
}
</style>
