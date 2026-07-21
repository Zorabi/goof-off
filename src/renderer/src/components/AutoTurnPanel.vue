<script setup>
import { computed } from 'vue'
import Stepper from './base/Stepper.vue'
import BaseSwitch from './base/Switch.vue'

const props = defineProps({
  running: { type: Boolean, required: true },
  paused: { type: Boolean, default: false },
  intervalSec: { type: Number, required: true }
})

const emit = defineEmits(['toggle', 'update:intervalSec'])

const enabled = computed(() => props.running || props.paused)
</script>

<template>
  <div class="auto-turn-panel" data-gesture-inert>
    <BaseSwitch label="自动翻页" :model-value="enabled" @update:model-value="emit('toggle')" />
    <Stepper
      label="间隔"
      :model-value="intervalSec"
      :min="5"
      :max="180"
      :step="1"
      :format="(value) => `${value}s`"
      @update:model-value="emit('update:intervalSec', $event)"
    />
  </div>
</template>

<style scoped>
.auto-turn-panel {
  display: grid;
  gap: var(--space-md);
  width: min(172px, calc(100vw - 32px));
  color: var(--color-text-primary);
}
</style>
