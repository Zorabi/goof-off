<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useAppState } from '../composables/useAppState.js'
import { useBrowser } from '../composables/useBrowser.js'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import { injectTxt } from '../composables/useTxt.js'
import { injectTxtReaderController } from '../composables/useTxtReaderController.js'
import { injectEpub } from '../composables/useEpub.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import { injectPdf } from '../composables/usePdf.js'
import { useWindowControls } from '../composables/useWindowControls.js'
import HomeAddressBar from './HomeAddressBar.vue'
import BareAddressBar from './BareAddressBar.vue'
import MiniMenu from './MiniMenu.vue'
import MoreMenu from './MoreMenu.vue'
import IconButton from './base/IconButton.vue'
import { resolveReaderTitle } from './readerTitle.js'

const props = defineProps({
  visible: { type: Boolean, default: true },
  interactive: { type: Boolean, default: true },
  solid: { type: Boolean, default: false },
  toolbarAutoHideEnabled: { type: Boolean, default: false },
  bodyAutoHideEnabled: { type: Boolean, default: false },
  bodyAutoHideAvailable: { type: Boolean, default: false },
  bodyAutoHideDisabledTitle: { type: String, default: '' },
  toolbarAutoHideLocked: { type: Boolean, default: false },
  autoHideGateActive: { type: Boolean, default: false },
  autoHideControlsVisible: { type: Boolean, default: false },
  bodyHidden: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle-toolbar-auto-hide', 'toggle-body-auto-hide'])

const { state, dispatch } = useAppState()
const { goHome } = useBrowser()
const txt = injectTxt()
const ctrl = injectTxtReaderController()
const epub = injectEpub()
const epubCtrl = injectEpubCtrl()
const pdf = injectPdf()
const { alwaysOnTop, toggleAlwaysOnTop } = useWindowControls()
const chromeLocks = injectChromeLockRegistry()
const topBarRef = ref(null)
const TOP_FOCUS_LOCK_ID = 'top.focus-within'
// 阅读态（网页/文件）前导拖拽区压缩宽度。README 仅对主页态硬性要求"左侧拖拽缓冲区"；
// 阅读态拖拽由 6px 常驻拖拽带、按钮缝隙与底栏非按钮区域兜底（2026-07-11 spec）。
const READING_LEADING_DRAG_REGION_WIDTH = 24

const isTxt = computed(() => state.content === 'file' && state.fileKind === 'txt')
const isEpub = computed(() => state.content === 'file' && state.fileKind === 'epub')
const isPdf = computed(() => state.content === 'file' && state.fileKind === 'pdf')
const isMini = computed(() => state.form === 'mini')
const canMini = computed(() => isTxt.value || isEpub.value)
const miniDisabledTitle = computed(() => (canMini.value ? '' : '仅 TXT/EPUB 支持精简态'))
const platformPolicy = computed(
  () =>
    window.api?.platformPolicy || {
      family: 'mac',
      window: {
        showCustomWindowControls: true,
        leadingDragRegionWidth: 56
      }
    }
)
const showCustomWindowControls = computed(
  () => !isMini.value && platformPolicy.value.window?.showCustomWindowControls === true
)
const leadingDragRegionStyle = computed(() => {
  const isReadingContent = state.content === 'web' || state.content === 'file'
  const width = isReadingContent
    ? READING_LEADING_DRAG_REGION_WIDTH
    : platformPolicy.value.window?.leadingDragRegionWidth || 56
  return { width: `${width}px` }
})
const readerTitle = computed(() =>
  resolveReaderTitle({
    fileKind: state.fileKind,
    txt: {
      displayName: txt?.displayName?.value,
      chapters: txt?.chapters?.value,
      offset: txt?.offset?.value,
      currentPage: ctrl?.currentPage?.value,
      pageCount: ctrl?.pageCount?.value
    },
    epub: {
      displayName: epub?.displayName?.value,
      currentChapterLabel: epubCtrl?.currentChapterLabel?.value,
      percentage: epub?.percentage?.value
    },
    pdf: {
      displayName: pdf?.displayName?.value,
      currentPage: pdf?.currentPage?.value,
      pageCount: pdf?.pageCount?.value
    }
  })
)

function onHome() {
  if (state.content === 'home') return
  goHome()
}

function goToPdfPage(n) {
  window.dispatchEvent(new CustomEvent('pdf:go-to-page', { detail: n }))
}

function toggleMini() {
  if (!canMini.value && !isMini.value) return
  dispatch({ type: 'TOGGLE_MINI' })
}

function toggleToolbarAutoHide(value) {
  emit('toggle-toolbar-auto-hide', value)
  releaseTopFocusForAutoHideCommand()
}

function toggleBodyAutoHide(value) {
  emit('toggle-body-auto-hide', value)
  releaseTopFocusForAutoHideCommand()
}

function registerFocusWithinLock() {
  if (isMini.value) return
  chromeLocks.registerLock({
    ownerId: TOP_FOCUS_LOCK_ID,
    kind: 'reserved-area',
    scope: 'top',
    priority: 10,
    mutexGroup: TOP_FOCUS_LOCK_ID,
    transient: false,
    bodyHideGate: false,
    appliesTo: { content: ['web', 'file'], form: ['normal'] }
  })
}

function releaseFocusWithinLock() {
  chromeLocks.releaseLock(TOP_FOCUS_LOCK_ID)
}

function releaseTopFocusForAutoHideCommand() {
  releaseFocusWithinLock()
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && topBarRef.value?.contains(activeElement)) {
    activeElement.blur()
  }
}

function onFocusIn() {
  registerFocusWithinLock()
}

function onFocusOut(event) {
  const nextTarget = event.relatedTarget
  if (nextTarget && topBarRef.value?.contains(nextTarget)) return
  nextTick(() => {
    if (topBarRef.value?.contains(document.activeElement)) return
    releaseFocusWithinLock()
  })
}

onBeforeUnmount(() => {
  releaseFocusWithinLock()
})

function closeWindow() {
  window.api.quitApp()
}

function minimizeWindow() {
  window.api.minimizeWindow?.()
}

function requestCloseWindow() {
  window.api.closeWindow?.()
}
</script>

<template>
  <div
    ref="topBarRef"
    class="top-bar"
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
    <div class="top-bar-main interface-fade-target">
      <template v-if="isMini">
        <div class="mini-title">
          <span v-if="isTxt || isEpub" class="file-name">{{ readerTitle }}</span>
        </div>
        <MiniMenu @exit-mini="toggleMini" @close-window="closeWindow" />
      </template>
      <template v-else>
        <div class="leading-drag-region" :style="leadingDragRegionStyle"></div>

        <div v-if="isTxt" class="left">
          <IconButton
            class="top-icon-button"
            icon="chevron-left"
            aria-label="上一屏"
            @click="ctrl.prevPage()"
          />
          <IconButton
            class="top-icon-button"
            icon="chevron-right"
            aria-label="下一屏"
            @click="ctrl.nextPage()"
          />
        </div>

        <div v-else-if="isEpub" class="left">
          <IconButton
            class="top-icon-button"
            icon="chevron-left"
            aria-label="上一章"
            @click="epubCtrl.guardedPrevChapter()"
          />
          <IconButton
            class="top-icon-button"
            icon="chevron-right"
            aria-label="下一章"
            @click="epubCtrl.guardedNextChapter()"
          />
        </div>

        <div v-else-if="isPdf" class="left">
          <IconButton
            class="top-icon-button"
            icon="chevron-left"
            :disabled="pdf.currentPage.value <= 1"
            disabled-reason="已在第一页"
            aria-label="上一页"
            @click="goToPdfPage(pdf.currentPage.value - 1)"
          />
          <IconButton
            class="top-icon-button"
            icon="chevron-right"
            :disabled="pdf.currentPage.value >= pdf.pageCount.value"
            disabled-reason="已在最后一页"
            aria-label="下一页"
            @click="goToPdfPage(pdf.currentPage.value + 1)"
          />
        </div>

        <div class="center" :class="{ 'is-file-title-region': isTxt || isEpub || isPdf }">
          <HomeAddressBar v-if="state.content === 'home' || state.content === 'history'" />
          <span v-else-if="isTxt || isEpub || isPdf" class="file-name">{{ readerTitle }}</span>
          <BareAddressBar v-else :chrome-visible="props.visible" :body-hidden="props.bodyHidden" />
        </div>

        <div class="right">
          <IconButton
            icon="home"
            class="top-icon-button"
            aria-label="主页"
            title="主页"
            :disabled="state.content === 'home'"
            @click="onHome"
          />
          <MoreMenu
            :always-on-top="alwaysOnTop"
            :can-mini="canMini"
            :mini-disabled-title="miniDisabledTitle"
            :toolbar-auto-hide-enabled="props.toolbarAutoHideEnabled"
            :body-auto-hide-enabled="props.bodyAutoHideEnabled"
            :body-auto-hide-available="props.bodyAutoHideAvailable"
            :body-auto-hide-disabled-title="props.bodyAutoHideDisabledTitle"
            :toolbar-auto-hide-locked="props.toolbarAutoHideLocked"
            :auto-hide-gate-active="props.autoHideGateActive"
            :auto-hide-controls-visible="props.autoHideControlsVisible"
            :chrome-visible="props.visible"
            :body-hidden="props.bodyHidden"
            @toggle-always-on-top="toggleAlwaysOnTop"
            @toggle-mini="toggleMini"
            @toggle-toolbar-auto-hide="toggleToolbarAutoHide"
            @toggle-body-auto-hide="toggleBodyAutoHide"
          />
          <IconButton
            v-if="showCustomWindowControls"
            icon="minimize"
            class="top-icon-button window-control-btn"
            aria-label="最小化窗口"
            title="最小化"
            @click="minimizeWindow"
          />
          <IconButton
            v-if="showCustomWindowControls"
            icon="close"
            class="top-icon-button window-control-btn"
            aria-label="关闭窗口"
            title="关闭"
            @click="requestCloseWindow"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.top-bar {
  height: var(--chrome-top-h);
  user-select: none;
  -webkit-app-region: drag;
  transition: opacity var(--motion-content) ease;
}
.top-bar-main {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 8px 0 0;
  background: var(--effective-toolbar-bg);
  backdrop-filter: var(--effective-toolbar-backdrop-filter);
  border-bottom: 1px solid var(--effective-toolbar-border);
  transition:
    background var(--motion-micro) ease,
    border-color var(--motion-micro) ease;
}
.top-bar.is-solid .top-bar-main,
.top-bar:hover .top-bar-main,
.top-bar:focus-within .top-bar-main {
  background: var(--effective-toolbar-solid-bg);
  border-bottom-color: var(--effective-toolbar-solid-border);
}
.top-bar.is-hidden {
  opacity: 0;
  pointer-events: none;
}
.top-bar.is-noninteractive {
  pointer-events: none;
}
.top-bar.is-mini {
  height: var(--chrome-top-h-mini);
}
.top-bar.is-mini .top-bar-main {
  padding: 0 6px 0 8px;
}

.leading-drag-region {
  flex-shrink: 0;
  height: 100%;
  -webkit-app-region: drag;
}

.center {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.right {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.left {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.mini-title {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  -webkit-app-region: drag;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 300;
  color: var(--color-text-primary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.top-bar.is-mini .file-name {
  font-size: 12px;
  text-align: left;
}
.center.is-file-title-region {
  justify-content: center;
}
.center.is-file-title-region .file-name {
  position: absolute;
  left: 50%;
  width: min(46%, 360px);
  transform: translateX(-50%);
  text-align: center;
}

.top-icon-button {
  -webkit-app-region: no-drag;
}

.window-control-btn {
  -webkit-app-region: no-drag;
}

@media (prefers-reduced-motion: reduce) {
  .top-bar {
    transition: none;
  }
}
</style>
