<script setup>
import { ref, watch } from 'vue'
import PrefsSegmented from './base/PrefsSegmented.vue'
import WebPrefsSection from './WebPrefsSection.vue'
import TxtPrefsSection from './TxtPrefsSection.vue'
import EpubPrefsSection from './EpubPrefsSection.vue'
import PdfPrefsSection from './PdfPrefsSection.vue'

const props = defineProps({
  initialMode: { type: String, default: 'web' },
  contentMode: { type: String, default: 'home' }
})

const modes = [
  { value: 'web', label: '网页' },
  { value: 'txt', label: 'TXT' },
  { value: 'epub', label: 'EPUB' },
  { value: 'pdf', label: 'PDF' }
]

const activeMode = ref(props.initialMode)

watch(
  () => props.initialMode,
  (next) => {
    if (modes.some((mode) => mode.value === next)) activeMode.value = next
  }
)
</script>

<template>
  <section class="prefs-sect" data-test="mode-section">
    <PrefsSegmented
      v-model="activeMode"
      :options="modes"
      variant="subtab"
      aria-label="模式偏好"
      data-test="mode-tab"
    />

    <WebPrefsSection v-if="activeMode === 'web'" :content-mode="props.contentMode" />
    <TxtPrefsSection v-else-if="activeMode === 'txt'" />
    <EpubPrefsSection v-else-if="activeMode === 'epub'" />
    <PdfPrefsSection v-else />
  </section>
</template>
