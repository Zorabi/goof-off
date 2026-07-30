<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { POPOVER_DESIRED_SIZE } from '../../../shared/popoverProtocol.js'
import { buildThemeSnapshot, createVisualActionScheduler } from '../popoverAdapters.js'
import { useAppState } from '../composables/useAppState.js'
import { useTransparency } from '../composables/useTransparency.js'
import { useWebPrefs } from '../composables/useWebPrefs.js'
import { logDiagnosticError } from '../composables/useDiagnosticLog.js'
import { usePageMessages } from '../composables/usePageMessages.js'
import { useDialogPrompt } from '../composables/useDialogPrompt.js'
import { injectChromeLockRegistry, useChromeLock } from '../composables/useChromeLockRegistry.js'
import { injectTxt } from '../composables/useTxt.js'
import { injectTxtReaderController } from '../composables/useTxtReaderController.js'
import { injectEpub } from '../composables/useEpub.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import { injectPdf } from '../composables/usePdf.js'
import { useReaderPrefs } from '../composables/useReaderPrefs.js'
import BasePopover from './BasePopover.vue'
import ReaderBottomChrome from './ReaderBottomChrome.vue'
import IconButton from './base/IconButton.vue'
import VisualControlPanel from './VisualControlPanel.vue'
import TxtTypographyPanel from './TxtTypographyPanel.vue'
import AutoTurnPanel from './AutoTurnPanel.vue'
import EpubTypographyPanel from './EpubTypographyPanel.vue'
import PdfFitPanel from './PdfFitPanel.vue'
import PageJumpInput from './PageJumpInput.vue'
import { resolveReaderBottomMode } from './readerBottomMode.js'

const props = defineProps({
  visible: { type: Boolean, default: true },
  interactive: { type: Boolean, default: true },
  solid: { type: Boolean, default: false },
  isDarkTheme: { type: Boolean, default: false }
})

const { state } = useAppState()
const {
  prefs: transparencyPrefs,
  setToggle: setTransparencyToggle,
  setPatch: setTransparencyPatch
} = useTransparency()
const { webPrefs, sessionZoom, setWebPrefs, setWebSessionZoom, refreshWebPrefs } = useWebPrefs()
const { current, pushStatus } = usePageMessages()
const { current: dialog, respond } = useDialogPrompt()
const promptInput = ref('')

const txt = injectTxt()
const ctrl = injectTxtReaderController()
const epub = injectEpub()
const epubCtrl = injectEpubCtrl()
const pdf = injectPdf()
const { txtPrefs, epubPrefs, pdfPrefs, setEpubPrefs, setPdfPrefs } = useReaderPrefs()
const isTxt = computed(() => state.content === 'file' && state.fileKind === 'txt')
const isEpub = computed(() => state.content === 'file' && state.fileKind === 'epub')
const isPdf = computed(() => state.content === 'file' && state.fileKind === 'pdf')
const isMini = computed(() => state.form === 'mini')
const epubImagesPending = ref(false)
const bottomMode = computed(() => resolveReaderBottomMode(state))
const webControlsVisible = computed(() => state.content === 'web')
const contentToggleDisabled = computed(() => !transparencyPrefs.value.windowEnabled)
const contentToggleDisabledReason = computed(() =>
  transparencyPrefs.value.windowEnabled ? '' : 'window-off'
)
const showPageInput = ref(false)
const showPdfPageInput = ref(false)
const showPdfFitPanel = ref(false)
const bottomBarRef = ref(null)
const chromeLocks = injectChromeLockRegistry()
const BOTTOM_FOCUS_LOCK_ID = 'bottom.focus-within'
const BOTTOM_POPOVER_OFFSET = 0
const txtAutoTurnButtonRef = ref(null)
const epubTypographyButtonRef = ref(null)
const epubAutoTurnButtonRef = ref(null)
const txtPageTriggerRef = ref(null)
const pdfPageTriggerRef = ref(null)
const normalFormApplies = { form: ['normal'] }
const txtApplies = { content: ['file'], fileKind: ['txt'], form: ['normal'] }
const epubApplies = { content: ['file'], fileKind: ['epub'], form: ['normal'] }
const pdfApplies = { content: ['file'], fileKind: ['pdf'], form: ['normal'] }

const typographyButtonRef = ref(null)
const pdfFitButtonRef = ref(null)

function resolveElement(target) {
  return target?.$el || target || null
}

function createRect({ x, y, width, height }) {
  const rect = {
    x,
    y,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    width,
    height
  }
  rect.toJSON = () => ({ ...rect })
  return rect
}

function createBottomPopoverAnchor(triggerRef) {
  return {
    getBoundingClientRect() {
      const triggerEl = resolveElement(triggerRef.value)
      const triggerRect = triggerEl?.getBoundingClientRect?.()
      const bottomRect = bottomBarRef.value?.getBoundingClientRect?.()
      const sourceRect = triggerRect || bottomRect
      if (!sourceRect) return createRect({ x: 0, y: 0, width: 0, height: 0 })

      const centerX = sourceRect.x + sourceRect.width / 2
      const topY = bottomRect?.top ?? bottomRect?.y ?? sourceRect.top ?? sourceRect.y
      return createRect({ x: centerX, y: topY, width: 0, height: 0 })
    }
  }
}

const pdfZoomLabel = computed(() => {
  if (!pdf) return ''
  const z = pdf.zoom.value
  if (z.mode === 'fit-width') return '适宽'
  if (z.mode === 'fit-page') return '适页'
  return `${Math.round(z.value)}%`
})

const pdfPagePercent = computed(() => {
  return Math.max(0, Math.min(100, Math.round(pdf?.progressPercent?.value || 0)))
})

const pdfPageStatusText = computed(() => {
  const pageText = `${pdf.currentPage.value} / ${pdf.pageCount.value}`
  const percentText = `${pdfPagePercent.value}%`
  if (pdfPrefs.value.pageDisplay === 'percent') return percentText
  if (pdfPrefs.value.pageDisplay === 'both') return `${pageText} · ${percentText}`
  return pageText
})

const pdfOutlineToolVisible = computed(() => {
  if (!pdf?.fileId?.value) return false
  return Boolean(pdf.outlineLoading?.value || pdf.outlineAvailable?.value)
})
const pdfOutlineDisabled = computed(() => Boolean(pdf?.outlineLoading?.value))

const epubPercentText = computed(() => {
  const value = epub?.percentage?.value
  if (value == null || !Number.isFinite(value)) return '--'
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return `${pct}%`
})

const webZoomPercent = computed(() => `${Math.round(sessionZoom.value * 100)}%`)
const plainViewToolVisible = computed(
  () =>
    webControlsVisible.value &&
    !transparencyPrefs.value.merged &&
    transparencyPrefs.value.windowEnabled
)

function onPdfPageJump(n) {
  window.dispatchEvent(new CustomEvent('pdf:go-to-page', { detail: n }))
}

function dispatchPdfZoomStep(direction) {
  window.dispatchEvent(new CustomEvent('pdf:zoom-step', { detail: direction }))
}

function onPdfFitPreset(preset) {
  window.dispatchEvent(new CustomEvent('pdf:zoom-preset', { detail: preset }))
  showPdfFitPanel.value = false
}

function onPdfPercent(value) {
  window.dispatchEvent(new CustomEvent('pdf:zoom-preset', { detail: value }))
}

async function setPdfInvertColors(value) {
  try {
    await setPdfPrefs({ invertColors: value })
  } catch (error) {
    logDiagnosticError('pdf.invert_colors_change', error, {
      invertColors: value,
      source: 'pdf-fit-popover',
      ok: false
    })
    pushStatus('PDF 显示设置保存失败')
  }
}

function clampWebZoom(value) {
  return Math.max(0.5, Math.min(2, Number(value.toFixed(1))))
}

function stepWebZoom(direction) {
  const next = clampWebZoom(sessionZoom.value + direction * 0.1)
  return setWebSessionZoom(next)
}

function toggleHideMedia() {
  return setWebPrefs({ hideMedia: !webPrefs.value.hideMedia })
}

function togglePlainView() {
  return setWebPrefs({ plainView: !webPrefs.value.plainView })
}

function toggleEpubMode() {
  epubCtrl.mode.value = epubCtrl.mode.value === 'scroll' ? 'paginate' : 'scroll'
}

async function toggleEpubImages() {
  if (epubImagesPending.value) return
  const hideImages = !epubPrefs.value.hideImages
  epubImagesPending.value = true
  try {
    await setEpubPrefs({ hideImages })
  } catch (error) {
    logDiagnosticError('epub.hide_images_change', error, {
      hideImages,
      source: 'epub-bottom-bar',
      ok: false
    })
    pushStatus('EPUB 图片设置未保存')
  } finally {
    epubImagesPending.value = false
  }
}

function toggleEpubAutoTurn() {
  window.dispatchEvent(new CustomEvent('epub:toggle-auto-turn'))
}

function toggleTxtAutoTurn() {
  window.dispatchEvent(new CustomEvent('txt:toggle-auto-turn'))
}

function setTxtAutoTurnSec(value) {
  return window.api?.txtSetPrefs?.({ autoTurnSec: value })
}

function setEpubAutoTurnSec(value) {
  return window.api?.epubSetPrefs?.({ autoTurnSec: value })
}

const epubCountdownText = computed(() => {
  const s = epubCtrl.autoTurnCountdown.value
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
})

const totalChars = computed(() => txt?.text.value.length || 0)
const percent = computed(() =>
  totalChars.value ? Math.round((txt.offset.value / totalChars.value) * 100) : 0
)

const countdownText = computed(() => {
  const s = ctrl.autoTurnCountdown.value
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
})

watch(dialog, (d) => {
  promptInput.value = d?.kind === 'prompt' ? d.defaultVal || '' : ''
})

function onCancel() {
  respond(dialog.value?.kind === 'confirm' ? false : null)
}
function onConfirm() {
  if (dialog.value?.kind === 'prompt') {
    respond(promptInput.value)
  } else {
    respond(true)
  }
}

function registerBottomLock(activeRef, lock) {
  useChromeLock(activeRef, () => ({
    scope: 'bottom',
    ...lock
  }))
}

function registerFocusWithinLock() {
  if (isMini.value) return
  chromeLocks.registerLock({
    ownerId: BOTTOM_FOCUS_LOCK_ID,
    kind: 'reserved-area',
    scope: 'bottom',
    priority: 10,
    mutexGroup: BOTTOM_FOCUS_LOCK_ID,
    transient: false,
    bodyHideGate: false,
    appliesTo: { content: ['web', 'file'], form: ['normal'] }
  })
}

function releaseFocusWithinLock() {
  chromeLocks.releaseLock(BOTTOM_FOCUS_LOCK_ID)
}

function onFocusIn() {
  registerFocusWithinLock()
}

function onFocusOut(event) {
  const nextTarget = event.relatedTarget
  if (nextTarget && bottomBarRef.value?.contains(nextTarget)) return
  nextTick(() => {
    if (bottomBarRef.value?.contains(document.activeElement)) return
    releaseFocusWithinLock()
  })
}

registerBottomLock(
  computed(() => !isMini.value && Boolean(dialog.value)),
  {
    ownerId: 'bottom.inline-dialog',
    kind: 'dialog',
    priority: 80,
    appliesTo: normalFormApplies,
    onEscape: onCancel
  }
)
registerBottomLock(showPageInput, {
  ownerId: 'bottom.txt-page-input',
  kind: 'input',
  priority: 60,
  appliesTo: txtApplies,
  focusRestore: { mode: 'trigger', target: txtPageTriggerRef },
  onEscape: () => {
    showPageInput.value = false
  }
})
registerBottomLock(showPdfPageInput, {
  ownerId: 'bottom.pdf-page-input',
  kind: 'input',
  priority: 60,
  appliesTo: pdfApplies,
  focusRestore: { mode: 'trigger', target: pdfPageTriggerRef },
  onEscape: () => {
    showPdfPageInput.value = false
  }
})

const visualButtonRef = ref(null)
const showVisualPanel = ref(false)
const visualPopoverTriggerEl = computed(() => visualButtonRef.value?.$el || visualButtonRef.value)
const visualPopoverAnchorEl = createBottomPopoverAnchor(visualButtonRef)
const pdfFitPopoverAnchorEl = createBottomPopoverAnchor(pdfFitButtonRef)
const txtTypographyPopoverAnchorEl = createBottomPopoverAnchor(typographyButtonRef)
const txtAutoTurnPopoverAnchorEl = createBottomPopoverAnchor(txtAutoTurnButtonRef)
const epubTypographyPopoverAnchorEl = createBottomPopoverAnchor(epubTypographyButtonRef)
const epubAutoTurnPopoverAnchorEl = createBottomPopoverAnchor(epubAutoTurnButtonRef)

const visualPopoverSnapshot = computed(() => ({
  id: 'visual',
  merged: transparencyPrefs.value.merged,
  windowEnabled: transparencyPrefs.value.windowEnabled,
  contentEnabled: transparencyPrefs.value.contentEnabled,
  contentToggleDisabled: contentToggleDisabled.value,
  contentToggleDisabledReason: contentToggleDisabledReason.value,
  contentLevel: transparencyPrefs.value.contentLevel,
  zoom: sessionZoom.value,
  wheelSpeed: webPrefs.value.wheelSpeed,
  plainView: webPrefs.value.plainView,
  hideMedia: webPrefs.value.hideMedia,
  webControlsVisible: webControlsVisible.value,
  theme: buildThemeSnapshot(props.isDarkTheme)
}))

async function applyUnifiedTransparencyToggle(value, { source = 'bottom-bar' } = {}) {
  const previousPlainView = webPrefs.value.plainView
  await setTransparencyToggle('unified', value)
  try {
    await setWebPrefs({ plainView: value })
  } catch (error) {
    try {
      await refreshWebPrefs()
    } catch {
      webPrefs.value = { ...webPrefs.value, plainView: previousPlainView }
    }
    logDiagnosticError('transparency.unified_plain_view_sync', error, {
      value,
      ok: false,
      source
    })
  }
}

function applyTransparencyAction(kind, value, source = 'bottom-bar') {
  if (kind === 'unified') return applyUnifiedTransparencyToggle(value, { source })
  return (async () => {
    await setTransparencyToggle(kind, value)
    if (
      kind === 'window' &&
      value === false &&
      webControlsVisible.value &&
      webPrefs.value.plainView === true
    ) {
      try {
        await setWebPrefs({ plainView: false })
      } catch (error) {
        try {
          await refreshWebPrefs()
        } catch {
          webPrefs.value = { ...webPrefs.value, plainView: true }
        }
        logDiagnosticError('transparency.unified_plain_view_sync', error, {
          value: false,
          ok: false,
          source
        })
      }
    }
  })()
}

function applyVisualChildAction(payload) {
  if (payload.action === 'toggle-transparency') {
    return applyTransparencyAction(payload.kind, payload.value, 'visual-popover')
  }
  if (payload.action === 'set-content-level') {
    return setTransparencyPatch({ contentLevel: payload.value })
  }
  if (payload.action === 'set-zoom') return setWebSessionZoom(payload.value)
  if (payload.action === 'set-wheel-speed') return setWebPrefs({ wheelSpeed: payload.value })
  if (payload.action === 'set-plain-view') return setWebPrefs({ plainView: payload.value })
  if (payload.action === 'set-hide-media') return setWebPrefs({ hideMedia: payload.value })
}

const visualActionScheduler = createVisualActionScheduler(applyVisualChildAction)

function handleVisualChildAction(payload) {
  if (payload.action === 'commit') return visualActionScheduler.commit()
  if (
    payload.action === 'toggle-transparency' ||
    payload.action === 'set-plain-view' ||
    payload.action === 'set-hide-media'
  ) {
    return applyVisualChildAction(payload)
  }
  visualActionScheduler.schedule(payload)
}

watch(showVisualPanel, (open) => {
  if (!open) visualActionScheduler.commit()
})

watch(
  () => [
    showVisualPanel.value,
    ctrl.showTypography.value,
    ctrl.showAutoTurnPanel.value,
    ctrl.showSearch.value,
    epubCtrl.showTypography?.value,
    epubCtrl.showAutoTurnPanel?.value,
    showPdfFitPanel.value
  ],
  ([visual, typography, txtAutoTurn, txtSearch, epubTypography, epubAutoTurn, pdfFit]) => {
    if (
      !visual &&
      !typography &&
      !txtAutoTurn &&
      !txtSearch &&
      !epubTypography &&
      !epubAutoTurn &&
      !pdfFit
    )
      return
    showPageInput.value = false
    showPdfPageInput.value = false
  }
)

watch(
  () => state.form,
  (form) => {
    if (form !== 'mini') return
    showPageInput.value = false
    showPdfPageInput.value = false
    showPdfFitPanel.value = false
    if (ctrl.showToc.value) ctrl.showToc.value = false
    if (ctrl.showTypography.value) ctrl.closeTypography()
    if (ctrl.showAutoTurnPanel.value) ctrl.closeAutoTurnPanel()
    if (ctrl.showSearch.value) ctrl.closeSearch()
    if (epubCtrl.showTypography?.value) epubCtrl.closeTypography()
    if (epubCtrl.showAutoTurnPanel?.value) epubCtrl.closeAutoTurnPanel()
  },
  { immediate: true }
)

watch(
  () => [state.content, state.fileKind, state.form],
  ([content, fileKind, form]) => {
    const normalFile = content === 'file' && form !== 'mini'
    if (!(normalFile && fileKind === 'txt')) {
      if (ctrl.showAutoTurnPanel.value) ctrl.closeAutoTurnPanel()
    }
    if (!(normalFile && fileKind === 'epub')) {
      if (epubCtrl.showTypography?.value) epubCtrl.closeTypography()
      if (epubCtrl.showAutoTurnPanel?.value) epubCtrl.closeAutoTurnPanel()
    }
  },
  { immediate: true }
)

watch(
  () => [isPdf.value, state.form],
  ([pdfActive, form]) => {
    if (pdfActive && form !== 'mini') return
    showPdfFitPanel.value = false
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  releaseFocusWithinLock()
  visualActionScheduler.dispose()
})
</script>

<template>
  <div
    ref="bottomBarRef"
    class="bottom-bar"
    data-gesture-inert
    :class="{
      'is-hidden': !props.visible,
      'is-noninteractive': !props.interactive,
      'is-solid': props.solid,
      'is-mini': isMini
    }"
    :aria-hidden="String(!props.visible)"
    :inert="!props.visible || undefined"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <ReaderBottomChrome
      class="interface-fade-target"
      :mini="bottomMode === 'mini'"
      :solid="props.solid"
    >
      <template #stealth>
        <IconButton
          ref="visualButtonRef"
          icon="stealth"
          aria-label="视觉控制"
          title="视觉控制"
          :active="showVisualPanel"
          aria-controls="popover-visual"
          :aria-expanded="String(showVisualPanel)"
          @click="showVisualPanel = !showVisualPanel"
        />
      </template>

      <template #mode-tools>
        <template v-if="bottomMode === 'web'">
          <IconButton
            icon="zoom-out"
            aria-label="缩小网页"
            title="缩小网页"
            :disabled="sessionZoom <= 0.5"
            @click="stepWebZoom(-1)"
          />
          <span class="web-zoom-readout" aria-live="polite">{{ webZoomPercent }}</span>
          <IconButton
            icon="zoom-in"
            aria-label="放大网页"
            title="放大网页"
            :disabled="sessionZoom >= 2"
            @click="stepWebZoom(1)"
          />
          <IconButton
            icon="hide-media"
            aria-label="隐藏媒体"
            title="隐藏媒体"
            :active="webPrefs.hideMedia"
            @click="toggleHideMedia"
          />
          <IconButton
            v-if="plainViewToolVisible"
            icon="plain-view"
            aria-label="网页素览"
            title="网页素览"
            :active="webPrefs.plainView"
            @click="togglePlainView"
          />
        </template>

        <IconButton
          v-if="isTxt && !isMini"
          data-reader-panel-trigger="txt-toc"
          icon="toc"
          aria-label="目录"
          title="目录"
          :active="ctrl.showToc.value"
          @click="ctrl.toggleToc()"
        />
        <IconButton
          v-if="isTxt && !isMini"
          data-reader-panel-trigger="txt-search"
          icon="search"
          aria-label="搜索"
          title="搜索"
          :active="ctrl.showSearch.value"
          @click="ctrl.toggleSearch()"
        />
        <IconButton
          v-if="isTxt && !isMini"
          ref="typographyButtonRef"
          icon="type"
          aria-label="排版"
          title="排版"
          :active="ctrl.showTypography.value"
          aria-controls="popover-typography"
          :aria-expanded="String(ctrl.showTypography.value)"
          @click="ctrl.toggleTypography()"
        />
        <IconButton
          v-if="isTxt && !isMini"
          ref="txtAutoTurnButtonRef"
          icon="autopage"
          aria-label="自动翻页"
          title="自动翻页"
          :active="ctrl.autoTurnRunning.value || ctrl.autoTurnPaused.value"
          aria-controls="popover-txt-auto-turn"
          :aria-expanded="String(ctrl.showAutoTurnPanel.value)"
          @click="ctrl.toggleAutoTurnPanel()"
        />

        <IconButton
          v-if="isEpub && !isMini"
          data-reader-panel-trigger="epub-toc"
          icon="toc"
          aria-label="目录"
          title="目录"
          :active="epubCtrl.showToc.value"
          @click="epubCtrl.toggleToc()"
        />
        <IconButton
          v-if="isEpub && !isMini"
          data-reader-panel-trigger="epub-search"
          icon="search"
          aria-label="搜索"
          title="搜索"
          :active="epubCtrl.showSearch.value"
          @click="epubCtrl.toggleSearch()"
        />
        <IconButton
          v-if="isEpub && !isMini"
          ref="epubTypographyButtonRef"
          icon="type"
          aria-label="排版"
          title="排版"
          :active="epubCtrl.showTypography.value"
          aria-controls="popover-epub-typography"
          :aria-expanded="String(epubCtrl.showTypography.value)"
          @click="epubCtrl.toggleTypography()"
        />
        <IconButton
          v-if="isEpub && !isMini"
          icon="hide-media"
          aria-label="隐藏图片"
          title="隐藏图片"
          :active="epubPrefs.hideImages"
          :aria-pressed="String(epubPrefs.hideImages)"
          :disabled="epubImagesPending"
          @click="toggleEpubImages"
        />
        <IconButton
          v-if="isEpub && !isMini"
          :icon="epubCtrl.mode.value === 'scroll' ? 'paginate-mode' : 'scroll-mode'"
          :aria-label="epubCtrl.mode.value === 'scroll' ? '切换到翻页模式' : '切换到滚动模式'"
          :title="epubCtrl.mode.value === 'scroll' ? '切换到翻页模式' : '切换到滚动模式'"
          @click="toggleEpubMode"
        />
        <IconButton
          v-if="isEpub && !isMini"
          ref="epubAutoTurnButtonRef"
          icon="autopage"
          aria-label="自动翻页"
          title="自动翻页"
          :active="epubCtrl.autoTurnRunning.value || epubCtrl.autoTurnPaused.value"
          aria-controls="popover-epub-auto-turn"
          :aria-expanded="String(epubCtrl.showAutoTurnPanel.value)"
          @click="epubCtrl.toggleAutoTurnPanel()"
        />

        <template v-if="isPdf && !isMini && pdf.fileId.value">
          <IconButton
            v-if="pdfOutlineToolVisible"
            data-reader-panel-trigger="pdf-outline"
            icon="toc"
            aria-label="PDF 目录"
            title="PDF 目录"
            disabled-reason="PDF 目录加载中"
            :disabled="pdfOutlineDisabled"
            :active="pdf.showOutline.value"
            @click="pdf.toggleOutline()"
          />
          <IconButton
            icon="zoom-out"
            aria-label="缩小 PDF"
            title="缩小 PDF"
            @click="dispatchPdfZoomStep(-1)"
          />
          <span class="pdf-zoom-readout" aria-live="polite">{{ pdfZoomLabel }}</span>
          <IconButton
            icon="zoom-in"
            aria-label="放大 PDF"
            title="放大 PDF"
            @click="dispatchPdfZoomStep(1)"
          />
          <IconButton
            ref="pdfFitButtonRef"
            icon="fit"
            aria-label="PDF 适配"
            title="PDF 适配"
            :active="showPdfFitPanel"
            aria-controls="popover-pdf-fit"
            :aria-expanded="String(showPdfFitPanel)"
            @click="showPdfFitPanel = !showPdfFitPanel"
          />
        </template>
      </template>

      <template #status>
        <div class="status" data-gesture-inert>
          <template v-if="dialog">
            <span class="dialog-msg">{{ dialog.msg }}</span>
            <input
              v-if="dialog.kind === 'prompt'"
              v-model="promptInput"
              class="dialog-input"
              @keyup.enter="onConfirm"
              @keyup.esc="onCancel"
            />
            <button type="button" class="dialog-btn" @click="onCancel">取消</button>
            <button type="button" class="dialog-btn primary" @click="onConfirm">确定</button>
          </template>
          <span v-else-if="current" class="status-text">{{ current.text }}</span>
          <template v-else-if="bottomMode === 'web'"></template>
          <template v-else-if="isPdf && pdf.fileId.value">
            <span class="status-text">
              <span
                ref="pdfPageTriggerRef"
                class="page-num"
                :class="{ 'is-editing': showPdfPageInput }"
                tabindex="0"
                role="button"
                @click="showPdfPageInput = !showPdfPageInput"
                @keyup.enter="showPdfPageInput = true"
              >
                {{ pdfPageStatusText }}
              </span>
            </span>
            <PageJumpInput
              v-if="showPdfPageInput"
              :page-count="pdf.pageCount.value"
              @submit="onPdfPageJump"
              @close="showPdfPageInput = false"
            />
          </template>
          <template v-else-if="isEpub && epub.fileId.value">
            <span v-if="epubCtrl.autoTurnRunning.value" class="status-text">{{
              epubCountdownText
            }}</span>
            <span class="status-text">{{ epubPercentText }}</span>
          </template>
          <template v-else-if="isTxt && txt?.text.value">
            <span v-if="ctrl.autoTurnRunning.value" class="status-text">{{ countdownText }}</span>
            <span class="status-text">
              <span
                ref="txtPageTriggerRef"
                class="page-num"
                :class="{ 'is-editing': showPageInput }"
                tabindex="0"
                role="button"
                @click="showPageInput = !showPageInput"
                @keyup.enter="showPageInput = true"
              >
                {{ ctrl.currentPage.value }}/{{ ctrl.pageCount.value }}
              </span>
              · {{ percent }}%
            </span>
            <PageJumpInput
              v-if="showPageInput"
              :page-count="ctrl.pageCount.value"
              @submit="(n) => ctrl.goToPage(n)"
              @close="showPageInput = false"
            />
          </template>
        </div>
      </template>
    </ReaderBottomChrome>

    <BasePopover
      v-model="showVisualPanel"
      popover-id="visual"
      :trigger-el="visualPopoverTriggerEl"
      :anchor-el="visualPopoverAnchorEl"
      panel-id="popover-visual"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="252"
      :desired-size="POPOVER_DESIRED_SIZE.visual"
      :snapshot="visualPopoverSnapshot"
      :child-action-handler="handleVisualChildAction"
      :force-child-host="webControlsVisible"
    >
      <template #content>
        <VisualControlPanel
          embedded
          :merged="transparencyPrefs.merged"
          :window-enabled="transparencyPrefs.windowEnabled"
          :content-enabled="transparencyPrefs.contentEnabled"
          :content-toggle-disabled="contentToggleDisabled"
          :content-toggle-disabled-reason="contentToggleDisabledReason"
          :content-level="transparencyPrefs.contentLevel"
          :zoom="sessionZoom"
          :wheel-speed="webPrefs.wheelSpeed"
          :plain-view="webPrefs.plainView"
          :hide-media="webPrefs.hideMedia"
          :web-controls-visible="webControlsVisible"
          @toggle-transparency="applyTransparencyAction($event.kind, $event.value, 'bottom-bar')"
          @update:content-level="
            handleVisualChildAction({
              id: 'visual',
              action: 'set-content-level',
              value: $event
            })
          "
          @update:zoom="setWebSessionZoom($event)"
          @update:wheel-speed="
            handleVisualChildAction({
              id: 'visual',
              action: 'set-wheel-speed',
              value: $event
            })
          "
          @update:plain-view="setWebPrefs({ plainView: $event })"
          @update:hide-media="setWebPrefs({ hideMedia: $event })"
        />
      </template>
    </BasePopover>
    <BasePopover
      v-if="isPdf"
      v-model="showPdfFitPanel"
      popover-id="pdf-fit"
      :trigger-el="pdfFitButtonRef?.$el"
      :anchor-el="pdfFitPopoverAnchorEl"
      panel-id="popover-pdf-fit"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="156"
      :lock-applies-to="pdfApplies"
    >
      <template #content>
        <PdfFitPanel
          :zoom="pdf.zoom.value"
          :invert-colors="pdfPrefs.invertColors"
          @set-preset="onPdfFitPreset"
          @set-percent="onPdfPercent"
          @set-invert-colors="setPdfInvertColors"
        />
      </template>
    </BasePopover>
    <BasePopover
      v-if="isTxt && !isMini"
      v-model="ctrl.showTypography.value"
      popover-id="typography"
      :trigger-el="typographyButtonRef?.$el"
      :anchor-el="txtTypographyPopoverAnchorEl"
      panel-id="popover-typography"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="120"
      :lock-applies-to="txtApplies"
    >
      <template #content>
        <TxtTypographyPanel />
      </template>
    </BasePopover>
    <BasePopover
      v-if="isTxt && !isMini"
      v-model="ctrl.showAutoTurnPanel.value"
      popover-id="txt-auto-turn"
      :trigger-el="txtAutoTurnButtonRef?.$el"
      :anchor-el="txtAutoTurnPopoverAnchorEl"
      panel-id="popover-txt-auto-turn"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="120"
      :lock-applies-to="txtApplies"
    >
      <template #content>
        <AutoTurnPanel
          :running="ctrl.autoTurnRunning.value"
          :paused="ctrl.autoTurnPaused.value"
          :interval-sec="txtPrefs.autoTurnSec"
          @toggle="toggleTxtAutoTurn"
          @update:interval-sec="setTxtAutoTurnSec"
        />
      </template>
    </BasePopover>
    <BasePopover
      v-if="isEpub && !isMini"
      v-model="epubCtrl.showTypography.value"
      popover-id="epub-typography"
      :trigger-el="epubTypographyButtonRef?.$el"
      :anchor-el="epubTypographyPopoverAnchorEl"
      panel-id="popover-epub-typography"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="120"
      :lock-applies-to="epubApplies"
    >
      <template #content>
        <EpubTypographyPanel />
      </template>
    </BasePopover>
    <BasePopover
      v-if="isEpub && !isMini"
      v-model="epubCtrl.showAutoTurnPanel.value"
      popover-id="epub-auto-turn"
      :trigger-el="epubAutoTurnButtonRef?.$el"
      :anchor-el="epubAutoTurnPopoverAnchorEl"
      panel-id="popover-epub-auto-turn"
      :offset="BOTTOM_POPOVER_OFFSET"
      :max-height="120"
      :lock-applies-to="epubApplies"
    >
      <template #content>
        <AutoTurnPanel
          :running="epubCtrl.autoTurnRunning.value"
          :paused="epubCtrl.autoTurnPaused.value"
          :interval-sec="epubPrefs.autoTurnSec"
          @toggle="toggleEpubAutoTurn"
          @update:interval-sec="setEpubAutoTurnSec"
        />
      </template>
    </BasePopover>
  </div>
</template>

<style scoped>
.bottom-bar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  height: var(--chrome-bottom-h);
  padding: 0;
  background: transparent;
  backdrop-filter: none;
  border-top: none;
  user-select: none;
  transition: opacity var(--motion-content) ease;
}
.bottom-bar:not(.is-mini) {
  -webkit-app-region: drag;
}
.bottom-bar.is-hidden {
  opacity: 0;
  pointer-events: none;
  border-top-color: rgba(255, 255, 255, 0.02);
}
.bottom-bar.is-noninteractive {
  pointer-events: none;
}
.bottom-bar.is-mini {
  justify-content: flex-start;
  height: var(--chrome-bottom-h-mini);
  padding: 0;
}

.bottom-bar :deep(.icon-button) {
  -webkit-app-region: no-drag;
}

.status {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-text {
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: status-fade-in var(--motion-toast-in) ease;
}

.dialog-msg {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
  -webkit-app-region: no-drag;
}
.dialog-input {
  flex-shrink: 0;
  width: 120px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--toolbar-border);
  border-radius: 11px;
  background: var(--panel-bg);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  -webkit-app-region: no-drag;
}
.dialog-input:focus {
  border-color: var(--color-accent);
}

.dialog-btn {
  flex-shrink: 0;
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--toolbar-border);
  border-radius: 11px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.dialog-btn:hover {
  background: var(--toolbar-border);
  color: var(--text-primary);
}
.dialog-btn.primary {
  background: var(--color-active-icon-bg);
  color: var(--color-text-primary);
  border-color: var(--color-divider);
}
.dialog-btn.primary:hover {
  background: var(--color-hover-bg);
}

.page-num {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-button);
  font-variant-numeric: var(--text-readout-variant);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition:
    transform var(--motion-micro) ease,
    border-color var(--motion-micro) ease,
    background var(--motion-micro) ease,
    color var(--motion-micro) ease;
}
.page-num:hover,
.page-num:focus-visible,
.page-num.is-editing {
  color: var(--color-text-primary);
  background: var(--color-hover-bg);
  border-color: var(--color-divider);
  transform: scale(1.03);
  outline: none;
}

@media (prefers-reduced-motion: reduce) {
  .bottom-bar,
  .page-num {
    transition: none;
  }
}
.pdf-zoom-readout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: var(--hit-min);
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  white-space: nowrap;
}

.web-zoom-readout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: var(--hit-min);
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  white-space: nowrap;
}

.segmented-mode-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--hit-min);
  height: var(--hit-min);
  padding: 0 6px;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.segmented-mode-button:hover {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
}
@keyframes status-fade-in {
  from {
    opacity: 0;
  }
}
</style>
