<script setup>
import { computed } from 'vue'
import { FONT_FAMILY_OPTIONS } from '../constants/fontFamilyOptions.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import Stepper from './base/Stepper.vue'
import SegmentedControl from './base/SegmentedControl.vue'

const { epubPrefs, setEpubPrefs } = useReaderPrefs()
const epubCtrl = injectEpubCtrl()

const fontOptions = computed(() =>
  FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label
  }))
)

const modeOptions = [
  { value: 'scroll', label: '滚动' },
  { value: 'paginate', label: '翻页' }
]

function setFontSize(value) {
  setEpubPrefs({ fontSize: value })
}

function setLineHeight(value) {
  setEpubPrefs({ lineHeight: value })
}

function setFontFamily(value) {
  setEpubPrefs({ fontFamily: value })
}

function setMode(value) {
  epubCtrl.mode.value = value
  setEpubPrefs({ defaultMode: value })
}
</script>

<template>
  <div class="epub-typography-panel" data-gesture-inert>
    <Stepper
      label="字号"
      :model-value="epubPrefs.fontSize"
      :min="12"
      :max="24"
      :step="1"
      :format="(value) => `${value}px`"
      @update:model-value="setFontSize"
    />
    <Stepper
      label="行距"
      :model-value="epubPrefs.lineHeight"
      :min="1.4"
      :max="2"
      :step="0.1"
      :format="(value) => value.toFixed(1)"
      @update:model-value="setLineHeight"
    />
    <SegmentedControl
      label="字体"
      :model-value="epubPrefs.fontFamily"
      :options="fontOptions"
      @update:model-value="setFontFamily"
    />
    <SegmentedControl
      label="阅读模式"
      :model-value="epubCtrl.mode.value"
      :options="modeOptions"
      @update:model-value="setMode"
    />
  </div>
</template>

<style scoped>
.epub-typography-panel {
  display: grid;
  gap: var(--space-md);
  width: min(172px, calc(100vw - 32px));
  color: var(--color-text-primary);
}
</style>
