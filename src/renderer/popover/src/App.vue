<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import VisualControlPanel from '../../src/components/VisualControlPanel.vue'
import Icon from '../../src/components/icons/Icon.vue'
import { scheduleAfterNextPaint } from '../../src/scheduleAfterNextPaint.js'

const snapshot = ref(null)
const rootRef = ref(null)
const isWindows = window.popoverApi?.platformPolicy?.family === 'windows'
let removeSnapshot = null
let removePrepareReveal = null
let cancelPreparedReveal = null
let resizeObserver = null
let lastMeasuredSignature = ''

const shellClass = computed(() => ({
  'is-windows': isWindows,
  'popover-child-shell--visual': snapshot.value?.id === 'visual',
  'popover-child-shell--compact': ['address-suggestions', 'more-menu'].includes(snapshot.value?.id)
}))

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', Boolean(theme?.isDark))
  const vars = theme?.cssVars || {}
  document.documentElement.style.setProperty('--panel-bg', vars.panelBg || '')
  document.documentElement.style.setProperty('--toolbar-border', vars.toolbarBorder || '')
  document.documentElement.style.setProperty('--text-primary', vars.textPrimary || '')
  document.documentElement.style.setProperty('--text-secondary', vars.textSecondary || '')
  document.documentElement.style.setProperty(
    '--effective-popover-bg',
    vars.effectivePopoverBg || vars.panelBg || ''
  )
  document.documentElement.style.setProperty(
    '--effective-popover-border',
    vars.effectivePopoverBorder || vars.toolbarBorder || ''
  )
  document.documentElement.style.setProperty(
    '--effective-popover-hover-bg',
    vars.effectivePopoverHoverBg || ''
  )
  document.documentElement.style.setProperty(
    '--effective-popover-shadow',
    vars.effectivePopoverShadow || ''
  )
  document.documentElement.style.setProperty(
    '--effective-popover-backdrop-filter',
    vars.effectivePopoverBackdropFilter || 'blur(var(--panel-material-blur))'
  )
}

async function onSnapshot(nextSnapshot) {
  lastMeasuredSignature = ''
  snapshot.value = nextSnapshot
  applyTheme(nextSnapshot.theme)
  await nextTick()
  observeRootSize()
  measure()
}

function withRequestToken(payload) {
  if (!snapshot.value?.requestToken) return payload
  return { ...payload, requestToken: snapshot.value.requestToken }
}

function ownsReveal(payload) {
  if (!Number.isSafeInteger(payload?.requestId) || payload.requestId <= 0) return false
  if (!snapshot.value || payload.id !== snapshot.value.id) return false
  if (snapshot.value.requestToken) return payload.requestToken === snapshot.value.requestToken
  return payload.requestToken === undefined
}

function onPrepareReveal(payload) {
  if (!ownsReveal(payload)) return
  cancelPreparedReveal?.()
  cancelPreparedReveal = scheduleAfterNextPaint(() => {
    cancelPreparedReveal = null
    if (ownsReveal(payload)) window.popoverApi.revealReady(payload)
  })
}

function measure() {
  const rect = rootRef.value?.getBoundingClientRect?.()
  if (!rect || !snapshot.value) return
  const sizeDip = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
  const signature = `${snapshot.value.id}:${snapshot.value.requestToken || ''}:${sizeDip.width}x${sizeDip.height}`
  if (signature === lastMeasuredSignature) return
  lastMeasuredSignature = signature
  window.popoverApi.measureReady(
    withRequestToken({
      id: snapshot.value.id,
      sizeDip
    })
  )
}

function observeRootSize() {
  if (!rootRef.value) return
  if (!resizeObserver) resizeObserver = new ResizeObserver(measure)
  resizeObserver.disconnect()
  resizeObserver.observe(rootRef.value)
}

function send(action) {
  window.popoverApi.sendAction(withRequestToken(action))
}

function sourceLabel(source) {
  return source === 'history' ? '历史' : '收藏'
}

function addressShellStyle() {
  return {
    '--address-suggestion-font-size': snapshot.value?.fontSize || 'var(--text-address-size)',
    '--address-suggestion-font-weight': snapshot.value?.fontWeight || 'var(--text-address-weight)'
  }
}

function addressAction(action, item, index) {
  send({ id: 'address-suggestions', action, index, itemId: item.id })
}

function menuCommand(command) {
  send({ id: 'more-menu', action: 'command', command })
}

function isMenuCheckboxItem(item) {
  return (
    item.id === 'toolbar-auto-hide' ||
    item.id === 'body-auto-hide' ||
    item.id === 'body-follow-pointer'
  )
}

function commitVisual() {
  if (snapshot.value?.id === 'visual')
    window.popoverApi.sendAction(withRequestToken({ id: 'visual', action: 'commit' }))
}

function onKeydown(event) {
  if (event.key === 'Escape' && snapshot.value) {
    window.popoverApi.requestClose(withRequestToken({ id: snapshot.value.id }))
  }
}

onMounted(() => {
  document.documentElement.classList.toggle('is-windows-popover', isWindows)
  removeSnapshot = window.popoverApi.onSnapshot(onSnapshot)
  removePrepareReveal = window.popoverApi.onPrepareReveal(onPrepareReveal)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('is-windows-popover')
  resizeObserver?.disconnect()
  resizeObserver = null
  removeSnapshot?.()
  cancelPreparedReveal?.()
  cancelPreparedReveal = null
  removePrepareReveal?.()
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="snapshot" ref="rootRef" class="popover-child-shell" :class="shellClass">
    <VisualControlPanel
      v-if="snapshot.id === 'visual'"
      embedded
      :window-enabled="snapshot.windowEnabled"
      :content-enabled="snapshot.contentEnabled"
      :content-toggle-disabled="snapshot.contentToggleDisabled"
      :content-level="snapshot.contentLevel"
      :zoom="snapshot.zoom"
      :wheel-speed="snapshot.wheelSpeed"
      :web-controls-visible="snapshot.webControlsVisible !== false"
      @toggle-transparency="
        send({
          id: 'visual',
          action: 'toggle-transparency',
          kind: $event.kind,
          value: $event.value
        })
      "
      @update:content-level="send({ id: 'visual', action: 'set-content-level', value: $event })"
      @update:zoom="send({ id: 'visual', action: 'set-zoom', value: $event })"
      @update:wheel-speed="send({ id: 'visual', action: 'set-wheel-speed', value: $event })"
      @range-commit="commitVisual"
      @pointerup.capture="commitVisual"
      @change.capture="commitVisual"
    />

    <ul
      v-else-if="snapshot.id === 'address-suggestions'"
      class="address-suggestions-child"
      :style="addressShellStyle()"
      role="listbox"
    >
      <li
        v-for="(item, index) in snapshot.items"
        :key="item.id"
        :data-test="`address-suggestion-${index}`"
        class="address-suggestions-child__item"
        :class="{ active: index === snapshot.activeIndex }"
        role="option"
        :aria-selected="String(index === snapshot.activeIndex)"
        @mouseenter="addressAction('set-active-index', item, index)"
        @mousedown.prevent="addressAction('commit-suggestion', item, index)"
      >
        <span class="address-suggestions-child__label">{{ item.label }}</span>
        <span class="address-suggestions-child__display">{{ item.displayUrl }}</span>
        <span class="address-suggestions-child__source">{{ sourceLabel(item.source) }}</span>
      </li>
    </ul>

    <div v-else-if="snapshot.id === 'more-menu'" class="more-menu-child" role="menu">
      <template v-for="item in snapshot.items" :key="item.id">
        <div v-if="item.separatorBefore" class="more-menu-child__separator" role="separator"></div>
        <button
          :data-test="`more-child-${item.id}`"
          type="button"
          class="more-menu-child__item"
          :class="{
            'is-active': item.active === true || item.checked === true,
            'is-disabled': !item.enabled
          }"
          :role="isMenuCheckboxItem(item) ? 'menuitemcheckbox' : 'menuitem'"
          :aria-checked="isMenuCheckboxItem(item) ? String(item.checked === true) : undefined"
          :disabled="!item.enabled"
          :title="item.title || ''"
          @click="menuCommand(item.id)"
        >
          <Icon :name="item.icon" />
          <span class="more-menu-child__label">{{ item.label }}</span>
        </button>
      </template>
    </div>

    <div v-else-if="snapshot.id === 'encoding'" class="popover-list">
      <button
        v-for="enc in snapshot.options"
        :key="enc"
        class="popover-list-item"
        :class="{ active: enc === snapshot.currentEncoding }"
        @click="send({ id: 'encoding', action: 'select-encoding', value: enc, closeAfter: true })"
      >
        {{ enc }}
      </button>
    </div>

    <div v-else-if="snapshot.id === 'pdf-zoom'" class="popover-list">
      <button
        v-for="preset in snapshot.presets"
        :key="preset.value"
        class="popover-list-item"
        @click="
          send({ id: 'pdf-zoom', action: 'select-preset', value: preset.value, closeAfter: true })
        "
      >
        {{ preset.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.popover-child-shell {
  background: var(--effective-popover-bg, var(--panel-bg));
  backdrop-filter: var(--effective-popover-backdrop-filter, blur(var(--panel-material-blur)));
  border-radius: var(--radius-window);
  border: 1px solid var(--effective-popover-border, var(--toolbar-border));
  box-shadow: none;
  padding: 12px 16px;
  color: var(--text-primary);
  overflow-x: hidden;
  overflow-y: auto;
}
.popover-child-shell,
.popover-child-shell * {
  box-sizing: border-box;
}
.popover-child-shell--compact {
  padding: 4px;
}
.popover-child-shell--visual .visual-control-panel.embedded {
  width: 100%;
  min-width: 0;
}
.popover-child-shell.is-windows {
  background: var(--panel-bg);
  backdrop-filter: none;
}
:global(html.is-windows-popover),
:global(html.is-windows-popover body),
:global(html.is-windows-popover #app) {
  background: transparent;
}
.popover-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.popover-list-item {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 4px 8px;
  text-align: left;
  cursor: pointer;
}
.popover-list-item:hover,
.popover-list-item.active {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
  color: var(--text-primary);
}
.address-suggestions-child {
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.address-suggestions-child__item {
  display: grid;
  grid-template-areas:
    'label source'
    'display source';
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 10px;
  align-items: center;
  min-height: 44px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--text-primary);
  cursor: default;
  font-size: var(--address-suggestion-font-size);
  font-weight: var(--address-suggestion-font-weight);
}
.address-suggestions-child__item.active,
.address-suggestions-child__item:hover {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
}
.address-suggestions-child__label {
  grid-area: label;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.address-suggestions-child__display {
  grid-area: display;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.address-suggestions-child__source {
  grid-area: source;
  color: var(--text-secondary);
  white-space: nowrap;
}
.more-menu-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-width: 0;
}
.more-menu-child__item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 44px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-meta-size);
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
  position: relative;
}
.more-menu-child__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.more-menu-child__item:hover:not(:disabled) {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
  color: var(--text-primary);
}
.more-menu-child__item:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.more-menu-child__item.is-active {
  background: transparent;
  color: var(--color-active-icon);
}
.more-menu-child__item.is-active:hover:not(:disabled) {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
}
.more-menu-child__item.is-active::before {
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
.more-menu-child__item.is-disabled {
  background: color-mix(
    in srgb,
    var(--effective-popover-border, var(--toolbar-border)) 52%,
    transparent
  );
}
.more-menu-child__item:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}
.more-menu-child__separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--effective-popover-border, var(--toolbar-border));
}
</style>
