<script setup>
import { FONT_FAMILY_OPTIONS } from '@renderer/constants/fontFamilyOptions.js'
import { logDiagnostic, logDiagnosticError } from '@renderer/composables/useDiagnosticLog.js'
import { usePreferenceSection } from '../composables/usePreferenceSection.js'
import PrefsSelect from './base/PrefsSelect.vue'
import PrefsStepper from './base/PrefsStepper.vue'

const defaults = {
  fontSize: 16,
  lineHeight: 1.7,
  bgColor: null,
  autoTurnSec: 30,
  defaultEncoding: null,
  fontFamily: 'default'
}

const encodingOptions = [
  { value: '', label: '自动' },
  { value: 'UTF-8', label: 'UTF-8' },
  { value: 'GBK', label: 'GBK' },
  { value: 'GB2312', label: 'GB2312' }
]
const { prefs, status, readiness, writable, revision, isDisposed, apply, savePatch } =
  usePreferenceSection({
    defaults,
    get: window.api.txtGetPrefs,
    set: window.api.txtSetPrefs,
    listen: window.api.onTxtPrefsChange
  })

function setNumber(field, value) {
  savePatch({ [field]: value })
}

function setEncoding(value) {
  savePatch({ defaultEncoding: value || null })
}

async function saveFontFamily(value) {
  if (!writable.value || isDisposed()) return prefs.value
  try {
    const next = await window.api.txtSetPrefs({ fontFamily: value })
    if (isDisposed()) return prefs.value
    apply(next)
    status.value = { kind: '', text: '' }
    logDiagnostic('reader.font_family_change', {
      kind: 'txt',
      fontFamily: value,
      source: 'preferences',
      ok: true
    })
    return next
  } catch (error) {
    if (isDisposed()) return prefs.value
    status.value = { kind: 'error', text: error?.message || '保存失败' }
    logDiagnosticError('reader.font_family_change', error, {
      kind: 'txt',
      fontFamily: value,
      source: 'preferences',
      ok: false
    })
    return prefs.value
  }
}
</script>

<template>
  <section
    class="prefs-sect"
    :class="{ 'is-loading': readiness === 'loading' }"
    data-test="txt-section"
    :aria-busy="readiness === 'loading' ? 'true' : undefined"
  >
    <div class="prefs-line">
      <span class="prefs-line__label">字号</span>
      <PrefsStepper
        :model-value="prefs.fontSize"
        :min="12"
        :max="24"
        :step="1"
        :sync-key="revision"
        :disabled="!writable"
        data-test="txt-font-size"
        @update:model-value="setNumber('fontSize', $event)"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">字体</span>
      <PrefsSelect
        :options="FONT_FAMILY_OPTIONS"
        :model-value="prefs.fontFamily || defaults.fontFamily"
        :disabled="!writable"
        aria-label="TXT 字体"
        data-test="txt-font-family"
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
        data-test="txt-line-height"
        @update:model-value="setNumber('lineHeight', $event)"
      />
    </div>
    <div class="prefs-line">
      <span class="prefs-line__label">默认编码</span>
      <PrefsSelect
        :options="encodingOptions"
        :model-value="prefs.defaultEncoding || ''"
        :disabled="!writable"
        aria-label="TXT 默认编码"
        data-test="txt-default-encoding"
        @update:model-value="setEncoding"
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
        data-test="txt-auto-turn-sec"
        @update:model-value="setNumber('autoTurnSec', $event)"
      />
    </div>
    <div v-if="status.text" class="prefs-line__hint is-danger">{{ status.text }}</div>
  </section>
</template>
