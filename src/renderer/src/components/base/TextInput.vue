<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  modelValue: { type: String, default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  maxlength: { type: [Number, String], default: undefined },
  disabled: { type: Boolean, default: false },
  invalid: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

function onInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <input
    v-bind="$attrs"
    class="text-input"
    :class="{ 'is-invalid': invalid }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :maxlength="maxlength"
    :disabled="disabled"
    :aria-invalid="invalid ? 'true' : undefined"
    @input="onInput"
  />
</template>

<style scoped>
.text-input {
  width: 100%;
  min-width: 0;
  height: var(--hit-min);
  padding: 0 var(--space-md);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-button);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  font-family: var(--font-ui);
  font-size: var(--text-meta-size);
  outline: none;
}

.text-input::placeholder {
  color: var(--color-text-muted);
}

.text-input:focus-visible {
  outline: var(--focus-ring-input);
  outline-offset: 1px;
}

.text-input:disabled {
  opacity: var(--opacity-disabled);
}

.text-input.is-invalid {
  border-color: var(--color-danger);
}
</style>
