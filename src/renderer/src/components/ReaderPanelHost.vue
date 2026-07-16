<script setup>
import { computed, markRaw, onBeforeUnmount, watch } from 'vue'
import { useAppState } from '../composables/useAppState.js'
import { useChromeLock } from '../composables/useChromeLockRegistry.js'
import { injectEpub } from '../composables/useEpub.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import { injectPdf } from '../composables/usePdf.js'
import { injectTxt } from '../composables/useTxt.js'
import { injectTxtReaderController } from '../composables/useTxtReaderController.js'
import EpubSearchPanel from './EpubSearchPanel.vue'
import EpubTocPanel from './EpubTocPanel.vue'
import PdfOutlinePanel from './PdfOutlinePanel.vue'
import ReaderSidePanel from './ReaderSidePanel.vue'
import TxtSearchPanel from './TxtSearchPanel.vue'
import TxtTocPanel from './TxtTocPanel.vue'

const TXT_TOC_LOCK_ID = 'bottom.txt-toc'
const TXT_SEARCH_LOCK_ID = 'bottom.txt-search'
const EPUB_TOC_LOCK_ID = 'bottom.epub-toc'
const EPUB_SEARCH_LOCK_ID = 'bottom.epub-search'
const PDF_OUTLINE_LOCK_ID = 'bottom.pdf-outline'
const TXT_APPLIES = { content: ['file'], fileKind: ['txt'], form: ['normal'] }
const EPUB_APPLIES = { content: ['file'], fileKind: ['epub'], form: ['normal'] }
const PDF_APPLIES = { content: ['file'], fileKind: ['pdf'], form: ['normal'] }
const PANEL_TRIGGERS = new Set(['txt-toc', 'txt-search', 'epub-toc', 'epub-search', 'pdf-outline'])

const { state } = useAppState()
const txt = injectTxt()
const ctrl = injectTxtReaderController()
const epub = injectEpub()
const epubCtrl = injectEpubCtrl()
const pdf = injectPdf()

const isNormalTxt = computed(
  () => state.content === 'file' && state.fileKind === 'txt' && state.form === 'normal'
)
const isNormalEpub = computed(
  () => state.content === 'file' && state.fileKind === 'epub' && state.form === 'normal'
)
const isNormalPdf = computed(
  () => state.content === 'file' && state.fileKind === 'pdf' && state.form === 'normal'
)
const txtHasFile = computed(() => Boolean(txt?.fileId?.value))
const epubHasFile = computed(() => Boolean(epub?.fileId?.value))
const pdfHasFile = computed(() => Boolean(pdf?.fileId?.value))
const showTxtToc = computed(() => isNormalTxt.value && txtHasFile.value && ctrl.showToc.value)
const showTxtSearch = computed(() => isNormalTxt.value && txtHasFile.value && ctrl.showSearch.value)
const showEpubToc = computed(
  () => isNormalEpub.value && epubHasFile.value && epubCtrl.showToc.value
)
const showEpubSearch = computed(
  () => isNormalEpub.value && epubHasFile.value && epubCtrl.showSearch.value
)
const showPdfOutline = computed(
  () => isNormalPdf.value && pdfHasFile.value && pdf?.showOutline?.value
)
const pdfContentFocusTarget = computed(() => document.querySelector('.pdf-scroll-container'))
const activePanel = computed(() => {
  if (showTxtToc.value) {
    return {
      key: 'txt-toc',
      title: '目录',
      closeLabel: '关闭目录',
      dock: 'left',
      headerAction: {
        icon: 'refresh',
        label: '重置目录',
        run: () => txt.resetChapters()
      },
      ownerId: TXT_TOC_LOCK_ID,
      close: () => ctrl.closeToc()
    }
  }
  if (showTxtSearch.value) {
    return {
      key: 'txt-search',
      title: '搜索',
      closeLabel: '关闭搜索',
      dock: 'bottom',
      ownerId: TXT_SEARCH_LOCK_ID,
      close: () => ctrl.closeSearch()
    }
  }
  if (showEpubToc.value) {
    return {
      key: 'epub-toc',
      title: '目录',
      closeLabel: '关闭目录',
      dock: 'left',
      ownerId: EPUB_TOC_LOCK_ID,
      close: () => epubCtrl.closeToc()
    }
  }
  if (showEpubSearch.value) {
    return {
      key: 'epub-search',
      title: '搜索',
      closeLabel: '关闭搜索',
      dock: 'bottom',
      ownerId: EPUB_SEARCH_LOCK_ID,
      close: () => epubCtrl.closeSearch()
    }
  }
  if (showPdfOutline.value) {
    return {
      key: 'pdf-outline',
      title: '目录',
      closeLabel: '关闭目录',
      dock: 'left',
      ownerId: PDF_OUTLINE_LOCK_ID,
      close: () => pdf.closeOutline()
    }
  }
  return null
})

function registerPanelLock(
  source,
  ownerId,
  appliesTo,
  close,
  isApplicable,
  focusRestore = { mode: 'content' }
) {
  useChromeLock(source, () => ({
    ownerId,
    kind: 'panel',
    scope: 'bottom',
    priority: 50,
    transient: false,
    appliesTo,
    focusRestore: markRaw(focusRestore),
    isApplicable,
    onEscape: close
  }))
}

registerPanelLock(
  showTxtToc,
  TXT_TOC_LOCK_ID,
  TXT_APPLIES,
  () => ctrl.closeToc(),
  () => Boolean(txt?.fileId?.value && ctrl.showToc.value)
)
registerPanelLock(
  showTxtSearch,
  TXT_SEARCH_LOCK_ID,
  TXT_APPLIES,
  () => ctrl.closeSearch(),
  () => Boolean(txt?.fileId?.value && ctrl.showSearch.value)
)
registerPanelLock(
  showEpubToc,
  EPUB_TOC_LOCK_ID,
  EPUB_APPLIES,
  () => epubCtrl.closeToc(),
  () => Boolean(epub?.fileId?.value && epubCtrl.showToc.value)
)
registerPanelLock(
  showEpubSearch,
  EPUB_SEARCH_LOCK_ID,
  EPUB_APPLIES,
  () => epubCtrl.closeSearch(),
  () => Boolean(epub?.fileId?.value && epubCtrl.showSearch.value)
)
registerPanelLock(
  showPdfOutline,
  PDF_OUTLINE_LOCK_ID,
  PDF_APPLIES,
  () => pdf.closeOutline(),
  () => Boolean(pdf?.fileId?.value && pdf?.doc?.value && pdf?.showOutline?.value),
  { mode: 'content', target: pdfContentFocusTarget }
)

function closeActivePanel() {
  activePanel.value?.close()
}

function runHeaderAction() {
  const action = activePanel.value?.headerAction
  if (action?.run) {
    action.run()
    return
  }
  closeActivePanel()
}

function targetIsPanelTrigger(target) {
  const trigger = target?.closest?.('[data-reader-panel-trigger]')
  if (!trigger) return false
  return PANEL_TRIGGERS.has(trigger.getAttribute('data-reader-panel-trigger'))
}

function onDocumentPointerdown(event) {
  if (!activePanel.value) return
  const target = event.target
  if (target?.closest?.('.reader-side-panel')) return
  if (targetIsPanelTrigger(target)) return
  closeActivePanel()
}

watch(
  () => [state.content, state.fileKind, state.form],
  ([content, fileKind, form]) => {
    const stillTxtNormal = content === 'file' && fileKind === 'txt' && form === 'normal'
    const stillEpubNormal = content === 'file' && fileKind === 'epub' && form === 'normal'
    const stillPdfNormal = content === 'file' && fileKind === 'pdf' && form === 'normal'
    if (!stillTxtNormal) {
      if (ctrl.showToc.value) ctrl.closeToc()
      if (ctrl.showSearch.value) ctrl.closeSearch()
    }
    if (!stillEpubNormal) {
      if (epubCtrl.showToc.value) epubCtrl.closeToc()
      if (epubCtrl.showSearch.value) epubCtrl.closeSearch()
    }
    if (!stillPdfNormal && pdf?.showOutline?.value) {
      pdf.closeOutline()
    }
  },
  { immediate: true }
)

watch(
  () => epub?.fileId?.value,
  (fileId, previousFileId) => {
    if (fileId === previousFileId) return
    if (epubCtrl.showToc.value) epubCtrl.closeToc()
    if (epubCtrl.showSearch.value) epubCtrl.closeSearch()
  }
)

watch(
  () => pdf?.fileId?.value,
  (fileId, previousFileId) => {
    if (fileId === previousFileId) return
    if (pdf?.showOutline?.value) pdf.closeOutline()
  }
)

document.addEventListener('pointerdown', onDocumentPointerdown, true)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerdown, true)
})
</script>

<template>
  <ReaderSidePanel
    :open="Boolean(activePanel)"
    :title="activePanel?.title || '阅读面板'"
    :close-label="activePanel?.closeLabel || '关闭面板'"
    :header-action="activePanel?.headerAction || null"
    :dock="activePanel?.dock || 'left'"
    @close="closeActivePanel"
    @header-action="runHeaderAction"
  >
    <div class="reader-panel-host__body" :data-active-panel="activePanel?.key || undefined">
      <TxtTocPanel v-if="activePanel?.key === 'txt-toc'" />
      <TxtSearchPanel v-else-if="activePanel?.key === 'txt-search'" @close="closeActivePanel" />
      <EpubTocPanel v-else-if="activePanel?.key === 'epub-toc'" />
      <EpubSearchPanel v-else-if="activePanel?.key === 'epub-search'" @close="closeActivePanel" />
      <PdfOutlinePanel v-else-if="activePanel?.key === 'pdf-outline'" @close="closeActivePanel" />
    </div>
  </ReaderSidePanel>
</template>

<style scoped>
.reader-panel-host__body {
  height: 100%;
  min-height: 0;
}
</style>
