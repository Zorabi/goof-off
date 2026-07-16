<script setup>
import { computed } from 'vue'
import SegmentedControl from './base/SegmentedControl.vue'
import Stepper from './base/Stepper.vue'

const props = defineProps({
  zoom: { type: Object, required: true }
})

const emit = defineEmits(['set-preset', 'set-percent'])

const fitPresetOptions = [
  { label: '适宽', value: 'fit-width' },
  { label: '适页', value: 'fit-page' }
]

const fitPresetValue = computed(() => {
  if (props.zoom.mode === 'fit-width' || props.zoom.mode === 'fit-page') return props.zoom.mode
  return 'fixed'
})

const fixedPercent = computed(() => {
  if (props.zoom.mode === 'fixed' || props.zoom.mode === 'percent') {
    return Math.max(25, Math.min(400, Math.round(props.zoom.value)))
  }
  return 100
})

function formatPercent(value) {
  return `${Math.round(value)}%`
}
</script>

<template>
  <div class="pdf-fit-panel">
    <SegmentedControl
      :model-value="fitPresetValue"
      :options="fitPresetOptions"
      label="PDF 适配预设"
      @update:model-value="emit('set-preset', $event)"
    />
    <Stepper
      :model-value="fixedPercent"
      :min="25"
      :max="400"
      :step="25"
      label="比例"
      :format="formatPercent"
      @update:model-value="emit('set-percent', $event)"
    />
  </div>
</template>

<style scoped>
.pdf-fit-panel {
  display: grid;
  gap: var(--space-md);
  width: 172px;
}

.pdf-fit-panel :deep(.segmented-control) {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
}

.pdf-fit-panel :deep(.segmented-option) {
  width: 100%;
}
</style>
