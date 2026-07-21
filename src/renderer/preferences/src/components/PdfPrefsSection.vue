<script setup>
import { computed } from 'vue'
import { usePreferenceSection } from '../composables/usePreferenceSection.js'
import PrefsSegmented from './base/PrefsSegmented.vue'
import PrefsSelect from './base/PrefsSelect.vue'
import PrefsStepper from './base/PrefsStepper.vue'

const ZOOM_KIND_OPTIONS = [
  { value: 'fit-width', label: '适合宽度' },
  { value: 'custom', label: '百分比' }
]

const PAGE_DISPLAY_OPTIONS = [
  { value: 'page', label: '页码' },
  { value: 'percent', label: '百分比' },
  { value: 'both', label: '页码 + 百分比' }
]

const defaults = { defaultZoom: 'fit-width', pageDisplay: 'page' }

const { prefs, status, readiness, writable, revision, savePatch } = usePreferenceSection({
  defaults,
  get: window.api.pdfGetPrefs,
  set: window.api.pdfSetPrefs,
  listen: window.api.onPdfPrefsChange
})

const zoomKind = computed(() => (prefs.value.defaultZoom === 'fit-width' ? 'fit-width' : 'custom'))
const zoomPercent = computed(() =>
  typeof prefs.value.defaultZoom === 'number' ? prefs.value.defaultZoom : 100
)

function setZoomKind(value) {
  if (value === 'fit-width') savePatch({ defaultZoom: 'fit-width' })
  else if (prefs.value.defaultZoom === 'fit-width') savePatch({ defaultZoom: 100 })
}
</script>

<template>
  <section
    class="prefs-sect"
    :class="{ 'is-loading': readiness === 'loading' }"
    data-test="pdf-section"
    :aria-busy="readiness === 'loading' ? 'true' : undefined"
  >
    <div class="prefs-line">
      <span class="prefs-line__label">默认缩放类型</span>
      <PrefsSegmented
        :options="ZOOM_KIND_OPTIONS"
        :model-value="zoomKind"
        :disabled="!writable"
        aria-label="PDF 默认缩放类型"
        data-test="pdf-zoom-kind"
        @update:model-value="setZoomKind"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">默认缩放百分比</span>
      <PrefsStepper
        :model-value="zoomPercent"
        :min="50"
        :max="300"
        :step="5"
        :sync-key="revision"
        suffix="%"
        :disabled="!writable || zoomKind === 'fit-width'"
        data-test="pdf-default-zoom"
        @update:model-value="savePatch({ defaultZoom: $event })"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">页码显示</span>
      <PrefsSelect
        :options="PAGE_DISPLAY_OPTIONS"
        :model-value="prefs.pageDisplay"
        :disabled="!writable"
        aria-label="PDF 页码显示"
        data-test="pdf-page-display"
        @update:model-value="savePatch({ pageDisplay: $event })"
      />
    </div>
    <div v-if="status.text" class="prefs-line__hint is-danger">{{ status.text }}</div>
  </section>
</template>
