<script setup>
import { computed } from 'vue'
import BaseSwitch from './base/Switch.vue'

const props = defineProps({
  merged: { type: Boolean, required: true },
  windowEnabled: { type: Boolean, required: true },
  contentEnabled: { type: Boolean, required: true },
  contentToggleDisabled: { type: Boolean, default: false },
  contentToggleDisabledReason: { type: String, default: '' },
  contentLevel: { type: Number, required: true },
  zoom: { type: Number, required: true },
  wheelSpeed: { type: Number, required: true },
  plainView: { type: Boolean, required: true },
  hideMedia: { type: Boolean, required: true },
  webControlsVisible: { type: Boolean, default: true },
  embedded: { type: Boolean, default: false }
})

const emit = defineEmits([
  'toggle-transparency',
  'update:contentLevel',
  'update:zoom',
  'update:wheelSpeed',
  'update:plainView',
  'update:hideMedia'
])

const plainViewVisible = computed(
  () => !props.merged && props.webControlsVisible && props.windowEnabled
)
const contentLevelPercent = computed(() => `${Math.round(props.contentLevel * 100)}%`)
const contentToggleTitle = computed(() => {
  if (!props.contentToggleDisabled) return ''
  return '需先开启背景隐去'
})
</script>

<template>
  <div class="visual-control-panel" :class="{ embedded: props.embedded }">
    <template v-if="props.merged">
      <BaseSwitch
        label="隐身阅读"
        :model-value="props.windowEnabled"
        @update:model-value="emit('toggle-transparency', { kind: 'unified', value: $event })"
      />
    </template>
    <template v-else>
      <BaseSwitch
        label="背景隐去"
        :model-value="props.windowEnabled"
        @update:model-value="emit('toggle-transparency', { kind: 'window', value: $event })"
      />
      <BaseSwitch
        label="界面淡化"
        :model-value="props.contentEnabled"
        :disabled="props.contentToggleDisabled"
        :title="contentToggleTitle"
        @update:model-value="emit('toggle-transparency', { kind: 'content', value: $event })"
      />
    </template>
    <div class="slider-group content-level-group">
      <label class="slider-label">
        <span>界面淡化强度</span>
        <span class="slider-value">{{ contentLevelPercent }}</span>
      </label>
      <input
        aria-label="界面淡化强度"
        type="range"
        min="0"
        max="0.95"
        step="0.01"
        :value="props.contentLevel"
        @input="emit('update:contentLevel', parseFloat($event.target.value))"
      />
    </div>
    <template v-if="props.webControlsVisible">
      <div class="divider"></div>
      <div class="slider-group">
        <label class="slider-label">
          <span>页面缩放</span>
          <span class="slider-value">{{ props.zoom.toFixed(1) }}x</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          :value="props.zoom"
          @input="emit('update:zoom', parseFloat($event.target.value))"
        />
      </div>
      <div class="slider-group">
        <label class="slider-label">
          <span>滚轮速度</span>
          <span class="slider-value">{{ props.wheelSpeed.toFixed(1) }}x</span>
        </label>
        <input
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          :value="props.wheelSpeed"
          @input="emit('update:wheelSpeed', parseFloat($event.target.value))"
        />
      </div>
      <BaseSwitch
        label="隐藏媒体"
        :model-value="props.hideMedia"
        @update:model-value="emit('update:hideMedia', $event)"
      />
    </template>
    <template v-if="plainViewVisible">
      <div class="divider"></div>
      <BaseSwitch
        label="网页素览"
        :model-value="props.plainView"
        @update:model-value="emit('update:plainView', $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.visual-control-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  padding: 12px 16px;
  background: var(--panel-bg);
  backdrop-filter: blur(16px);
  border-radius: 8px;
  border: 1px solid var(--toolbar-border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  width: 220px;
  z-index: 100;
}

.visual-control-panel.embedded {
  position: static;
  inset: auto;
  margin: 0;
  padding: 0;
  background: transparent;
  backdrop-filter: none;
  border: none;
  box-shadow: none;
  width: 220px;
  z-index: auto;
}

.slider-group {
  margin-bottom: 12px;
}

.slider-group:last-child {
  margin-bottom: 0;
}

.content-level-group {
  margin-top: var(--space-lg);
  margin-bottom: 0;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-control-size);
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.slider-value {
  font-variant-numeric: tabular-nums;
}

input[type='range'] {
  width: 100%;
}

input[type='range']:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.divider {
  height: 1px;
  background: var(--toolbar-border);
  margin: 12px 0;
}

.visual-control-panel :deep(.switch-field) {
  min-height: 0;
}

.visual-control-panel :deep(.switch-field + .switch-field) {
  margin-top: var(--space-md);
}

.visual-control-panel :deep(.switch-label) {
  font-size: var(--text-control-size);
}
</style>
