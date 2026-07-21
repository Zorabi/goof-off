<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { POPOVER_DESIRED_SIZE } from '../../../shared/popoverProtocol.js'
import { useAppState } from '../composables/useAppState.js'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import { buildThemeSnapshot } from '../popoverAdapters.js'
import { createPopoverRequestToken } from '../popoverRequestToken.js'
import IconButton from './base/IconButton.vue'
import Icon from './icons/Icon.vue'

const MORE_MENU_LOCK_ID = 'top.more-menu'

const props = defineProps({
  alwaysOnTop: { type: Boolean, default: false },
  canMini: { type: Boolean, default: false },
  miniDisabledTitle: { type: String, default: '' },
  toolbarAutoHideEnabled: { type: Boolean, default: false },
  bodyAutoHideEnabled: { type: Boolean, default: false },
  bodyAutoHideAvailable: { type: Boolean, default: false },
  bodyAutoHideDisabledTitle: { type: String, default: '' },
  toolbarAutoHideLocked: { type: Boolean, default: false },
  autoHideGateActive: { type: Boolean, default: false },
  autoHideControlsVisible: { type: Boolean, default: false },
  chromeVisible: { type: Boolean, default: true },
  bodyHidden: { type: Boolean, default: false }
})

const emit = defineEmits([
  'toggle-always-on-top',
  'toggle-mini',
  'toggle-toolbar-auto-hide',
  'toggle-body-auto-hide'
])

const { state } = useAppState()
const chromeLocks = injectChromeLockRegistry()
const open = ref(false)
const rootRef = ref(null)
const triggerRef = ref(null)
const panelRef = ref(null)
const panelStyle = ref({})
let openGeneration = 0
let activeRequestToken = null
let removeChildAction = null
let removeChildClose = null
let removeRecompute = null

function registerTopChromeLock() {
  chromeLocks.registerLock({
    ownerId: MORE_MENU_LOCK_ID,
    kind: 'menu',
    scope: 'top',
    priority: 70,
    mutexGroup: 'top.primary-interaction',
    appliesTo: { form: ['normal'] },
    focusRestore: { mode: 'trigger', target: triggerRef },
    onEscape: close
  })
}

function releaseMenuLocks({ restoreFocus = false, reason = 'release' } = {}) {
  chromeLocks.releaseLock(MORE_MENU_LOCK_ID, { restoreFocus, reason })
}

function isWebReading() {
  return state.content === 'web' && state.form === 'normal'
}

function updatePanelPosition() {
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return
  panelStyle.value = {
    top: `${Math.round(rect.bottom + 4)}px`,
    right: `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`
  }
}

function menuItems() {
  const items = [
    {
      id: 'pin',
      label: props.alwaysOnTop ? '取消置顶' : '窗口置顶',
      icon: 'pin',
      enabled: true,
      active: props.alwaysOnTop
    },
    {
      id: 'mini',
      label: '精简模式',
      icon: 'mini-enter',
      enabled: props.canMini,
      title: props.canMini ? '' : props.miniDisabledTitle
    }
  ]
  if (props.autoHideControlsVisible) {
    items.push(
      {
        id: 'toolbar-auto-hide',
        label: '工具栏自动隐藏',
        icon: 'autohide-toolbar',
        enabled: !toolbarAutoHideDisabled.value,
        checked: props.toolbarAutoHideEnabled,
        title: toolbarDisabledTitle.value,
        separatorBefore: true
      },
      {
        id: 'body-auto-hide',
        label: '主体自动隐藏',
        icon: 'autohide-body',
        enabled: !bodyAutoHideDisabled.value,
        checked: props.bodyAutoHideEnabled,
        title: bodyAutoHideDisabled.value ? props.bodyAutoHideDisabledTitle : ''
      }
    )
  }
  items.push({ id: 'preferences', label: '偏好设置', icon: 'gear', enabled: true })
  return items
}

function menuSnapshot() {
  return { id: 'more-menu', items: menuItems(), theme: buildThemeSnapshot() }
}

function ownsChildMenu(payload) {
  return payload?.id === 'more-menu' && payload.requestToken === activeRequestToken
}

async function openChildMenu() {
  const rect = rootRef.value?.getBoundingClientRect?.()
  if (!rect) return false
  const existingRequestToken = activeRequestToken
  const requestToken = existingRequestToken || createPopoverRequestToken('more-menu')
  const payload = {
    id: 'more-menu',
    requestToken,
    placement: 'bottom',
    triggerRectDip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    desiredSizeDip: POPOVER_DESIRED_SIZE['more-menu'],
    mainWindowSizeDip: { width: window.innerWidth, height: window.innerHeight },
    snapshot: menuSnapshot()
  }
  if (existingRequestToken) {
    const updated = await window.api?.popoverUpdateSnapshot?.(payload)
    return updated === true
  }
  activeRequestToken = requestToken
  const opened = await window.api?.popoverOpen?.(payload)
  if (activeRequestToken === requestToken) {
    activeRequestToken = opened === true ? requestToken : null
  } else if (opened === true) {
    await window.api?.popoverClose?.({ id: 'more-menu', requestToken })
  }
  return opened === true && activeRequestToken === requestToken
}

async function closeChildMenu() {
  if (!activeRequestToken) return
  const requestToken = activeRequestToken
  activeRequestToken = null
  await window.api?.popoverClose?.({ id: 'more-menu', requestToken })
}

async function refreshOpenChildMenu() {
  if (!open.value || !isWebReading() || !activeRequestToken) return
  const generation = openGeneration
  const requestToken = activeRequestToken
  await nextTick()
  if (!open.value || generation !== openGeneration || activeRequestToken !== requestToken) {
    return
  }
  const updated = await openChildMenu()
  if (
    !updated &&
    open.value &&
    generation === openGeneration &&
    activeRequestToken === requestToken
  ) {
    close({ reason: 'open-failed' })
  }
}

async function setOpen(value, options = {}) {
  const restoreFocus = options.restoreFocus ?? true
  const reason = options.reason || 'release'
  if (open.value === value) return
  const generation = ++openGeneration
  open.value = value
  if (value) {
    registerTopChromeLock()
    updatePanelPosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onResize)
    if (isWebReading()) {
      await nextTick()
      if (!open.value || generation !== openGeneration) return
      const opened = await openChildMenu()
      if (!opened && open.value && generation === openGeneration) {
        close({ reason: 'open-failed' })
      }
      return
    }
    await nextTick()
  } else {
    releaseMenuLocks({ restoreFocus, reason })
    document.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('resize', onResize)
    await closeChildMenu()
  }
}

function toggle() {
  setOpen(!open.value)
}

function resolveTriggerElement() {
  const trigger = triggerRef.value
  if (trigger instanceof HTMLElement) return trigger
  if (trigger?.$el instanceof HTMLElement) return trigger.$el
  return null
}

function close(context = {}) {
  const restoreFocus = context.restoreFocus ?? context.reason !== 'replaced'
  setOpen(false, { restoreFocus, reason: context.reason || 'release' })
  if (context.blurTrigger === true) resolveTriggerElement()?.blur?.()
}

function onResize() {
  updatePanelPosition()
  refreshOpenChildMenu()
}

function onPointerDown(event) {
  if (!open.value) return
  if (rootRef.value?.contains(event.target)) return
  if (panelRef.value?.contains(event.target)) return
  close()
}

function toggleAlwaysOnTop() {
  close()
  emit('toggle-always-on-top')
}

function toggleMini() {
  if (!props.canMini) return
  close()
  emit('toggle-mini')
}

const toolbarDisabledTitle = computed(() => {
  if (!props.autoHideGateActive) return '开启背景隐去后可用'
  return ''
})

const toolbarAutoHideDisabled = computed(() => !props.autoHideGateActive)

const bodyAutoHideDisabled = computed(
  () => !props.autoHideGateActive || !props.bodyAutoHideAvailable
)

function toggleToolbarAutoHide() {
  if (toolbarAutoHideDisabled.value) return
  emit('toggle-toolbar-auto-hide', !props.toolbarAutoHideEnabled)
  close({ restoreFocus: false, blurTrigger: true })
}

function toggleBodyAutoHide() {
  if (bodyAutoHideDisabled.value) return
  emit('toggle-body-auto-hide', !props.bodyAutoHideEnabled)
  close({ restoreFocus: false, blurTrigger: true })
}

function openPreferences() {
  close()
  window.api?.openPreferences?.()
}

function executeCommand(command) {
  if (command === 'pin') return toggleAlwaysOnTop()
  if (command === 'mini') return toggleMini()
  if (command === 'toolbar-auto-hide') return toggleToolbarAutoHide()
  if (command === 'body-auto-hide') return toggleBodyAutoHide()
  if (command === 'preferences') return openPreferences()
  return undefined
}

watch(
  () => [state.content, state.fileKind, state.form],
  async () => {
    if (!open.value) return
    if (state.form !== 'normal') {
      close()
      return
    }
    if (!isWebReading()) {
      await closeChildMenu()
      await nextTick()
      updatePanelPosition()
      return
    }
    await refreshOpenChildMenu()
  }
)

watch(
  () => [props.chromeVisible, props.bodyHidden],
  ([chromeVisible, bodyHidden]) => {
    if (!open.value) return
    if (chromeVisible !== false && bodyHidden !== true) return
    close({
      reason: bodyHidden ? 'body-hidden' : 'chrome-hidden',
      restoreFocus: false,
      blurTrigger: true
    })
  }
)

watch(
  () => [
    props.alwaysOnTop,
    props.canMini,
    props.miniDisabledTitle,
    props.autoHideControlsVisible,
    props.toolbarAutoHideEnabled,
    props.bodyAutoHideEnabled,
    props.autoHideGateActive,
    props.bodyAutoHideAvailable,
    props.bodyAutoHideDisabledTitle,
    props.toolbarAutoHideLocked
  ],
  refreshOpenChildMenu
)

onMounted(() => {
  removeChildAction = window.api?.onPopoverChildAction?.((payload) => {
    if (!ownsChildMenu(payload)) return
    if (payload.action === 'command') executeCommand(payload.command)
    if (payload.action === 'close') close()
  })
  removeChildClose = window.api?.onPopoverChildClose?.((payload) => {
    if (!ownsChildMenu(payload)) return
    close({ reason: payload.reason || 'closed' })
  })
  removeRecompute = window.api?.onPopoverRecomputeRequest?.((payload) => {
    if (payload?.id !== 'more-menu' || !open.value || !isWebReading()) return
    refreshOpenChildMenu()
  })
})

onBeforeUnmount(() => {
  releaseMenuLocks()
  removeChildAction?.()
  removeChildClose?.()
  removeRecompute?.()
  closeChildMenu()
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div ref="rootRef" class="more-menu" data-gesture-inert>
    <IconButton
      ref="triggerRef"
      icon="chevron-down"
      aria-label="更多"
      title="更多"
      :active="open"
      aria-haspopup="menu"
      :aria-expanded="String(open)"
      @click="toggle"
    />
    <Teleport to="body">
      <div
        v-if="open && !isWebReading()"
        ref="panelRef"
        class="more-menu-panel"
        role="menu"
        :style="panelStyle"
      >
        <button
          data-test="more-pin"
          type="button"
          role="menuitem"
          :class="{ 'is-active': props.alwaysOnTop }"
          @click="toggleAlwaysOnTop"
        >
          <Icon name="pin" />
          <span>{{ props.alwaysOnTop ? '取消置顶' : '窗口置顶' }}</span>
        </button>
        <button
          data-test="more-mini"
          type="button"
          role="menuitem"
          :class="{ 'is-disabled': !props.canMini }"
          :disabled="!props.canMini"
          :title="props.canMini ? '' : props.miniDisabledTitle"
          @click="toggleMini"
        >
          <Icon name="mini-enter" />
          <span>精简模式</span>
        </button>
        <template v-if="props.autoHideControlsVisible">
          <div class="more-menu-separator" role="separator"></div>
          <button
            data-test="more-toolbar-auto-hide"
            type="button"
            role="menuitemcheckbox"
            :class="{
              'is-active': props.toolbarAutoHideEnabled,
              'is-disabled': toolbarAutoHideDisabled
            }"
            :aria-checked="String(props.toolbarAutoHideEnabled)"
            :disabled="toolbarAutoHideDisabled"
            :title="toolbarDisabledTitle"
            @click="toggleToolbarAutoHide"
          >
            <Icon name="autohide-toolbar" />
            <span>工具栏自动隐藏</span>
          </button>
          <button
            data-test="more-body-auto-hide"
            type="button"
            role="menuitemcheckbox"
            :class="{
              'is-active': props.bodyAutoHideEnabled,
              'is-disabled': bodyAutoHideDisabled
            }"
            :aria-checked="String(props.bodyAutoHideEnabled)"
            :disabled="bodyAutoHideDisabled"
            :title="bodyAutoHideDisabled ? props.bodyAutoHideDisabledTitle : ''"
            @click="toggleBodyAutoHide"
          >
            <Icon name="autohide-body" />
            <span>主体自动隐藏</span>
          </button>
        </template>
        <button data-test="more-preferences" type="button" role="menuitem" @click="openPreferences">
          <Icon name="gear" />
          <span>偏好设置</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.more-menu {
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.more-menu-panel {
  position: fixed;
  min-width: 112px;
  padding: 4px;
  border: 1px solid var(--effective-popover-border, var(--toolbar-border));
  border-radius: var(--radius-button);
  background: var(--effective-popover-bg, var(--panel-bg));
  box-shadow: var(--effective-popover-shadow, var(--shadow-float));
  backdrop-filter: var(--effective-popover-backdrop-filter, blur(var(--panel-material-blur)));
  z-index: var(--z-popover);
  -webkit-app-region: no-drag;
  animation: menu-pop-in var(--motion-micro) ease;
}

.more-menu-panel button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0;
  position: relative;
}

.more-menu-panel button :deep(svg),
.more-menu-panel button :deep(.icon-glyph) {
  flex: 0 0 var(--icon-size);
}

.more-menu-panel button:hover:not(:disabled) {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
  color: var(--color-text-primary);
}

.more-menu-separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--effective-popover-border, var(--toolbar-border));
}

.more-menu-panel button.is-active {
  background: color-mix(
    in srgb,
    var(--effective-popover-hover-bg, var(--color-hover-bg)) 72%,
    transparent
  );
  color: var(--color-active-icon);
}

.more-menu-panel button.is-active::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  width: 2px;
  height: 14px;
  border-radius: 999px;
  background: var(--color-active-icon);
  transform: translateY(-50%);
}

.more-menu-panel button.is-active :deep(.icon-glyph),
.more-menu-panel button.is-active :deep(svg) {
  color: var(--color-active-icon);
}

.more-menu-panel button.is-disabled {
  background: color-mix(
    in srgb,
    var(--effective-popover-border, var(--toolbar-border)) 52%,
    transparent
  );
}

.more-menu-panel button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}
@keyframes menu-pop-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}
</style>
