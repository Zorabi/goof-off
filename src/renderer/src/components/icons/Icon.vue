<script setup>
import { computed } from 'vue'
import { iconPaths } from './iconPaths.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: String, default: 'var(--icon-size)' },
  strokeWidth: { type: [String, Number], default: '1.6' },
  title: { type: String, default: '' },
  ariaLabel: { type: String, default: '' }
})

const definition = computed(() => iconPaths[props.name])
const paths = computed(() => (Array.isArray(definition.value) ? definition.value : []))
const isGlyph = computed(() => definition.value?.kind === 'glyph')
const label = computed(() => props.ariaLabel || props.title || '')
const sizeStyle = computed(() => ({ width: props.size, height: props.size }))
</script>

<template>
  <span
    v-if="isGlyph"
    class="icon-glyph"
    :style="sizeStyle"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    {{ definition.text }}
  </span>
  <svg
    v-else
    :style="sizeStyle"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  >
    <title v-if="title">{{ title }}</title>
    <path v-for="path in paths" :key="path.d" :d="path.d" v-bind="path.attrs || {}" />
  </svg>
</template>

<style scoped>
.icon-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  font-family: var(--font-ui);
  font-size: 0.82em;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
}
</style>
