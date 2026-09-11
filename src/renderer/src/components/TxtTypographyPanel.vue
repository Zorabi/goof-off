<script setup>
import { computed } from 'vue'
import { FONT_FAMILY_OPTIONS } from '../constants/fontFamilyOptions.js'
import { injectTxt } from '../composables/useTxt.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import { pushStatus } from '../composables/usePageMessages.js'
import Stepper from './base/Stepper.vue'
import SegmentedControl from './base/SegmentedControl.vue'

const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'Big5']

const txt = injectTxt()
const { txtPrefs, setTxtPrefs } = useReaderPrefs()

const fontOptions = computed(() =>
  FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label
  }))
)
const encodingOptions = computed(() =>
  ENCODINGS.map((encoding) => ({
    value: encoding,
    label: encoding
  }))
)
const lowConfidence = computed(() => (txt?.confidence.value ?? 1) < 0.5)

function setFontSize(value) {
  setTxtPrefs({ fontSize: value })
}

function setLineHeight(value) {
  setTxtPrefs({ lineHeight: value })
}

function setFontFamily(value) {
  setTxtPrefs({ fontFamily: value })
}

async function setEncoding(value) {
  if (!txt || value === txt.encoding.value) return
  const result = await txt.reDecode(value)
  if (result.ok) {
    pushStatus(`已切换编码为 ${result.data?.encoding || value}`)
  } else if (result.reason !== 'cancelled' && result.reason !== 'stale') {
    pushStatus(result.message || '切换编码失败')
  }
}
</script>

<template>
  <div class="txt-typography-panel" data-gesture-inert>
    <Stepper
      label="字号"
      :model-value="txtPrefs.fontSize"
      :min="12"
      :max="24"
      :step="1"
      :format="(value) => `${value}px`"
      @update:model-value="setFontSize"
    />
    <Stepper
      label="行距"
      :model-value="txtPrefs.lineHeight"
      :min="1.4"
      :max="2"
      :step="0.1"
      :format="(value) => value.toFixed(1)"
      @update:model-value="setLineHeight"
    />
    <SegmentedControl
      label="字体"
      :model-value="txtPrefs.fontFamily"
      :options="fontOptions"
      @update:model-value="setFontFamily"
    />
    <div class="encoding-row">
      <div class="encoding-header">
        <span class="encoding-title">编码</span>
        <span v-if="lowConfidence" class="encoding-warning">⚠ 编码置信度偏低</span>
      </div>
      <SegmentedControl
        label="编码"
        hide-label
        :model-value="txt?.encoding.value || 'UTF-8'"
        :options="encodingOptions"
        @update:model-value="setEncoding"
      />
    </div>
  </div>
</template>

<style scoped>
.txt-typography-panel {
  display: grid;
  gap: var(--space-md);
  width: min(172px, calc(100vw - 32px));
  color: var(--color-text-primary);
  background: transparent;
}

.encoding-row {
  display: grid;
  gap: var(--space-sm);
}

.encoding-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-md);
  min-width: 0;
}

.encoding-title {
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
}

.encoding-warning {
  min-width: 0;
  color: var(--color-danger);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
