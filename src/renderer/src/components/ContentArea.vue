<script setup>
import { computed, ref, watch } from 'vue'
import HomePage from '../views/HomePage.vue'
import HistoryPage from '../views/HistoryPage.vue'
import BrowserPlaceholder from './BrowserPlaceholder.vue'
import TxtReader from './TxtReader.vue'
import TxtReaderVirtual from './TxtReaderVirtual.vue'
import EpubReader from './EpubReader.vue'
import PdfReader from './PdfReader.vue'
import { useBrowser } from '../composables/useBrowser.js'
import { useFileVisualPrefs } from '../composables/useFileVisualPrefs.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import { useAppState } from '../composables/useAppState.js'
import { injectTxt } from '../composables/useTxt.js'
import { injectEpub } from '../composables/useEpub.js'
import { injectPdf } from '../composables/usePdf.js'
import { normalizePdfColorPrefs } from '../../../shared/pdfColorPrefs.js'

const props = defineProps({
  opacity: { type: Number, default: 1 },
  stealthOverlay: { type: Boolean, default: false }
})

// 超过阈值走虚拟化阅读器，避免大文件全量 DOM 的首排与搜索重排开销。
const VIRTUAL_THRESHOLD = 1 * 1024 * 1024
const { state, dispatch } = useAppState()
const { openSite } = useBrowser()
const { fileVisualState } = useFileVisualPrefs()
const { pdfPrefs } = useReaderPrefs()
const txt = injectTxt()
const epub = injectEpub()
const pdf = injectPdf()

const isTxt = computed(() => state.content === 'file' && state.fileKind === 'txt')
const isEpub = computed(() => state.content === 'file' && state.fileKind === 'epub')
const isPdf = computed(() => state.content === 'file' && state.fileKind === 'pdf')
const usesPdfCustomColors = computed(() => isPdf.value && pdfPrefs.value.invertColors)
const pdfColors = computed(() => normalizePdfColorPrefs(pdfPrefs.value))
const isNormalFileForm = computed(() => state.content === 'file' && state.form === 'normal')
const supportsFileVisual = computed(() => isTxt.value || isEpub.value)
const rendererBodyOpacity = computed(() => {
  return `calc(${props.opacity} * var(--stealth-file-body-opacity-multiplier, 1))`
})
const fileVisualStyle = computed(() => {
  const base = { opacity: rendererBodyOpacity.value }
  if (isPdf.value) {
    return { ...base, '--pdf-background-color': pdfColors.value.backgroundColor }
  }
  if (!supportsFileVisual.value) return base
  const visual = fileVisualState.value
  return {
    ...base,
    '--file-bg-gradient': visual.gradientCss,
    '--file-text-color': visual.effectiveTextColor || undefined,
    ...visual.selectionCssVars
  }
})
const useVirtual = computed(() => isTxt.value && (txt?.sizeBytes.value || 0) > VIRTUAL_THRESHOLD)
const txtReaderKey = computed(() => txt?.fileId.value || 'txt-empty')
// 带上加载序号：EpubReader 的 rendition 建在 onMounted，重开同一本书时 fileId 不变，
// 只用 fileId 作 key 不会重挂载，正文会永久空白。
const epubReaderKey = computed(
  () => `${epub?.fileId.value || 'epub-empty'}#${epub?.loadInstance.value ?? 0}`
)
const pdfReaderKey = computed(() => pdf?.fileId.value || 'pdf-empty')
const pdfHasAcceptedDocument = computed(() => Boolean(pdf?.fileId.value && pdf?.doc.value))
const isHomeHistoryContent = computed(() => state.content === 'home' || state.content === 'history')
const homeHistoryDirection = ref('forward')
const homeHistoryTransitioning = ref(false)
const homeHistoryTransitionName = computed(() => {
  if (homeHistoryDirection.value === 'back') return 'home-history-back'
  return 'home-history-forward'
})

watch(
  () => state.content,
  (next, prev) => {
    if (prev === 'home' && next === 'history') homeHistoryDirection.value = 'forward'
    if (prev === 'history' && next === 'home') homeHistoryDirection.value = 'back'
  }
)

function openHistory() {
  dispatch({ type: 'OPEN_HISTORY' })
}

function setHomeHistoryTransitioning(value) {
  homeHistoryTransitioning.value = value
}
</script>

<template>
  <div
    class="content-area"
    :class="{
      'is-stealth-overlay': props.stealthOverlay,
      'is-file-visual': supportsFileVisual,
      'has-custom-file-gradient': supportsFileVisual && fileVisualState.hasCustomGradient
    }"
  >
    <div
      class="content-main interface-fade-target"
      :class="{
        'is-home-history-transitioning': homeHistoryTransitioning,
        'is-normal-file-form': isNormalFileForm,
        'is-pdf-custom-colors': usesPdfCustomColors
      }"
      :inert="homeHistoryTransitioning ? '' : null"
      :style="fileVisualStyle"
      data-chrome-focus-target="content"
      tabindex="-1"
    >
      <Transition
        v-if="isHomeHistoryContent"
        :name="homeHistoryTransitionName"
        mode="out-in"
        @before-enter="setHomeHistoryTransitioning(true)"
        @after-enter="setHomeHistoryTransitioning(false)"
        @enter-cancelled="setHomeHistoryTransitioning(false)"
        @before-leave="setHomeHistoryTransitioning(true)"
        @after-leave="setHomeHistoryTransitioning(false)"
        @leave-cancelled="setHomeHistoryTransitioning(false)"
      >
        <HomePage
          v-if="state.content === 'home'"
          key="home"
          @open-site="openSite"
          @open-history="openHistory"
        />
        <HistoryPage
          v-else-if="state.content === 'history'"
          key="history"
          :initial-tab="state.lastHomeEntrySource"
        />
      </Transition>

      <template v-else>
        <TxtReaderVirtual v-if="useVirtual" :key="txtReaderKey" />
        <TxtReader v-else-if="isTxt" :key="txtReaderKey" />
        <EpubReader
          v-else-if="isEpub"
          :key="epubReaderKey"
          :file-visual-state="fileVisualState"
          :is-mini="state.form === 'mini'"
        />
        <PdfReader v-else-if="isPdf && pdfHasAcceptedDocument" :key="pdfReaderKey" />
        <BrowserPlaceholder v-else />
      </template>
    </div>
  </div>
</template>

<style scoped>
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.content-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.content-main.is-pdf-custom-colors {
  background: var(--pdf-background-color);
}
.content-main:focus {
  outline: none;
}
.content-main.is-home-history-transitioning {
  pointer-events: none;
}
.content-main.is-normal-file-form :deep(.txt-content) {
  width: 100%;
  max-width: var(--reader-txt-content-max-w-normal);
  box-sizing: border-box;
  padding: var(--reader-content-block-pad-normal) var(--reader-content-inline-pad-normal);
}
.content-main.is-normal-file-form :deep(.epub-view-container) {
  padding: 0;
}
.home-history-forward-enter-active,
.home-history-forward-leave-active,
.home-history-back-enter-active,
.home-history-back-leave-active {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  transition:
    transform var(--motion-nav) cubic-bezier(0.25, 1, 0.5, 1),
    opacity var(--motion-nav) ease;
  pointer-events: none;
}
.home-history-forward-enter-from {
  opacity: 0;
  transform: translateX(22px);
}
.home-history-forward-leave-to {
  opacity: 0;
  transform: translateX(-22px);
}
.home-history-back-enter-from {
  opacity: 0;
  transform: translateX(-22px);
}
.home-history-back-leave-to {
  opacity: 0;
  transform: translateX(22px);
}
.content-area.is-stealth-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.content-area.is-file-visual {
  background: transparent;
}
.content-area.is-file-visual.has-custom-file-gradient .content-main {
  background: var(--file-bg-gradient);
}
@media (prefers-reduced-motion: reduce) {
  .home-history-forward-enter-active,
  .home-history-forward-leave-active,
  .home-history-back-enter-active,
  .home-history-back-leave-active {
    transition: none;
  }
  .home-history-forward-enter-from,
  .home-history-forward-leave-to,
  .home-history-back-enter-from,
  .home-history-back-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
