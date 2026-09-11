<script setup>
import { FONT_FAMILY_OPTIONS } from '@renderer/constants/fontFamilyOptions.js'
import { usePreferenceSection } from '../composables/usePreferenceSection.js'
import PrefsSegmented from './base/PrefsSegmented.vue'
import PrefsSelect from './base/PrefsSelect.vue'
import PrefsStepper from './base/PrefsStepper.vue'

const MODE_OPTIONS = [
  { value: 'scroll', label: '滚动' },
  { value: 'paginate', label: '翻页' }
]

const defaults = {
  defaultMode: 'scroll',
  fontSize: 16,
  lineHeight: 1.7,
  autoTurnSec: 30,
  fontFamily: 'default'
}

const { prefs, status, readiness, writable, revision, savePatch } = usePreferenceSection({
  defaults,
  get: window.api.epubGetPrefs,
  set: window.api.epubSetPrefs,
  listen: window.api.onEpubPrefsChange
})

function setNumber(field, value) {
  return savePatch({ [field]: value })
}

function saveFontFamily(value) {
  return savePatch({ fontFamily: value })
}
</script>

<template>
  <section
    class="prefs-sect"
    :class="{ 'is-loading': readiness === 'loading' }"
    data-test="epub-section"
    :aria-busy="readiness === 'loading' ? 'true' : undefined"
  >
    <div class="prefs-line">
      <span class="prefs-line__label">默认模式</span>
      <PrefsSegmented
        :options="MODE_OPTIONS"
        :model-value="prefs.defaultMode"
        :disabled="!writable"
        aria-label="EPUB 默认模式"
        data-test="epub-default-mode"
        @update:model-value="savePatch({ defaultMode: $event })"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">字号</span>
      <PrefsStepper
        :model-value="prefs.fontSize"
        :min="12"
        :max="24"
        :step="1"
        :sync-key="revision"
        :disabled="!writable"
        data-test="epub-font-size"
        @update:model-value="setNumber('fontSize', $event)"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">字体</span>
      <PrefsSelect
        :options="FONT_FAMILY_OPTIONS"
        :model-value="prefs.fontFamily || defaults.fontFamily"
        :disabled="!writable"
        aria-label="EPUB 字体"
        data-test="epub-font-family"
        @update:model-value="saveFontFamily"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">行距</span>
      <PrefsStepper
        :model-value="prefs.lineHeight"
        :min="1.4"
        :max="2"
        :step="0.1"
        :sync-key="revision"
        :disabled="!writable"
        data-test="epub-line-height"
        @update:model-value="setNumber('lineHeight', $event)"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">自动翻页秒数</span>
      <PrefsStepper
        :model-value="prefs.autoTurnSec"
        :min="5"
        :max="180"
        :step="1"
        :sync-key="revision"
        :disabled="!writable"
        data-test="epub-auto-turn-sec"
        @update:model-value="setNumber('autoTurnSec', $event)"
      />
    </div>
    <div v-if="status.text" class="prefs-line__hint is-danger">{{ status.text }}</div>
  </section>
</template>
