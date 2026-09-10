<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BaseSwitch from './base/Switch.vue'
import { MIN_INTERFACE_OPACITY } from '../../../shared/transparencyPrefs.js'

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
  'update:hideMedia',
  'range-commit'
])

const contentLevelDraft = ref(props.contentLevel)
const zoomDraft = ref(props.zoom)
const wheelSpeedDraft = ref(props.wheelSpeed)
const activeRange = ref(null)
const pendingRangeEmits = new Map()
let rangeFrame = null

function syncDraft(field, value) {
  if (activeRange.value === field) return
  if (field === 'content-level') contentLevelDraft.value = value
  else if (field === 'zoom') zoomDraft.value = value
  else if (field === 'wheel-speed') wheelSpeedDraft.value = value
}

watch(
  () => props.contentLevel,
  (value) => syncDraft('content-level', value)
)
watch(
  () => props.zoom,
  (value) => syncDraft('zoom', value)
)
watch(
  () => props.wheelSpeed,
  (value) => syncDraft('wheel-speed', value)
)

function flushRangeEmits() {
  if (rangeFrame != null) cancelAnimationFrame(rangeFrame)
  rangeFrame = null
  for (const [eventName, value] of pendingRangeEmits) emit(eventName, value)
  pendingRangeEmits.clear()
}

function scheduleRangeEmit(eventName, value) {
  pendingRangeEmits.set(eventName, value)
  if (rangeFrame != null) return
  rangeFrame = requestAnimationFrame(flushRangeEmits)
}

function setRangeDraft(field, value) {
  if (field === 'content-level') contentLevelDraft.value = value
  else if (field === 'zoom') zoomDraft.value = value
  else wheelSpeedDraft.value = value
}

function onRangeInput(field, eventName, event) {
  const value = Number.parseFloat(event.target.value)
  if (!Number.isFinite(value)) return
  activeRange.value = field
  setRangeDraft(field, value)
  scheduleRangeEmit(eventName, value)
}

function commitRange(field, eventName, event) {
  onRangeInput(field, eventName, event)
  flushRangeEmits()
  activeRange.value = null
  emit('range-commit', field)
}

onBeforeUnmount(flushRangeEmits)

const plainViewVisible = computed(
  () => !props.merged && props.webControlsVisible && props.windowEnabled
)
const contentLevelPercent = computed(() => `${Math.round(contentLevelDraft.value * 100)}%`)
const contentLevelDisabled = computed(
  () => props.contentToggleDisabled || props.contentEnabled !== true
)
const contentLevelTitle = computed(() => {
  if (props.contentToggleDisabled) return '需先开启背景隐去'
  if (!props.contentEnabled) return '需先开启界面淡化'
  return ''
})
const contentToggleTitle = computed(() => {
  if (!props.contentToggleDisabled) return ''
  return '需先开启背景隐去'
})
</script>

<template>
  <div
    class="visual-control-panel"
    :class="{ embedded: props.embedded, 'is-range-adjusting': activeRange !== null }"
  >
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
        :min="MIN_INTERFACE_OPACITY"
        max="0.95"
        step="0.01"
        :value="contentLevelDraft"
        :disabled="contentLevelDisabled"
        :title="contentLevelTitle"
        @input="onRangeInput('content-level', 'update:contentLevel', $event)"
        @change="commitRange('content-level', 'update:contentLevel', $event)"
        @pointercancel="commitRange('content-level', 'update:contentLevel', $event)"
      />
    </div>
    <template v-if="props.webControlsVisible">
      <div class="divider"></div>
      <div class="slider-group">
        <label class="slider-label">
          <span>页面缩放</span>
          <span class="slider-value">{{ zoomDraft.toFixed(1) }}x</span>
        </label>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          :value="zoomDraft"
          @input="onRangeInput('zoom', 'update:zoom', $event)"
          @change="commitRange('zoom', 'update:zoom', $event)"
          @pointercancel="commitRange('zoom', 'update:zoom', $event)"
        />
      </div>
      <div class="slider-group">
        <label class="slider-label">
          <span>滚轮速度</span>
          <span class="slider-value">{{ wheelSpeedDraft.toFixed(1) }}x</span>
        </label>
        <input
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          :value="wheelSpeedDraft"
          @input="onRangeInput('wheel-speed', 'update:wheelSpeed', $event)"
          @change="commitRange('wheel-speed', 'update:wheelSpeed', $event)"
          @pointercancel="commitRange('wheel-speed', 'update:wheelSpeed', $event)"
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
  height: 26px;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: var(--toolbar-border);
}

input[type='range']::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
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
