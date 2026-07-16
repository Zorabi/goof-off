<script setup>
const props = defineProps({
  options: { type: Array, required: true },
  modelValue: { type: [String, Number], default: null },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  dataTest: { type: String, default: '' },
  variant: { type: String, default: 'inline' }
})

const emit = defineEmits(['update:modelValue'])

function select(value) {
  if (props.disabled || value === props.modelValue) return
  emit('update:modelValue', value)
}
</script>

<template>
  <div
    role="radiogroup"
    class="prefs-seg"
    :class="{ disabled, 'prefs-seg--subtab': variant === 'subtab' }"
    :aria-label="ariaLabel || undefined"
    :data-test="dataTest || undefined"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      class="prefs-seg__item"
      :class="{ active: modelValue === opt.value }"
      :aria-checked="modelValue === opt.value ? 'true' : 'false'"
      :data-test="dataTest ? `${dataTest}-${opt.value}` : undefined"
      :disabled="disabled"
      @click="select(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
