<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import Icon from './icons/Icon.vue'

const emit = defineEmits(['exit-mini', 'close-window'])
const open = ref(false)
const rootRef = ref(null)
const chromeLocks = injectChromeLockRegistry()
const triggerRef = ref(null)
const panelRef = ref(null)
const panelStyle = ref({})
const MINI_MENU_LOCK_ID = 'top.mini-menu'

function updatePanelPosition() {
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return
  panelStyle.value = {
    top: `${Math.round(rect.bottom + 4)}px`,
    right: `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`
  }
}

function setOpen(value) {
  if (open.value === value) return
  open.value = value
  if (value) {
    chromeLocks.registerLock({
      ownerId: MINI_MENU_LOCK_ID,
      kind: 'menu',
      scope: 'top',
      priority: 70,
      appliesTo: { content: ['file'], fileKind: ['txt', 'epub'], form: ['mini'] },
      focusRestore: { mode: 'trigger', target: triggerRef },
      onEscape: close
    })
    updatePanelPosition()
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', updatePanelPosition)
  } else {
    chromeLocks.releaseLock(MINI_MENU_LOCK_ID, { restoreFocus: true })
    document.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('resize', updatePanelPosition)
  }
}

function toggle() {
  setOpen(!open.value)
}

function close() {
  setOpen(false)
}

function exitMini() {
  close()
  emit('exit-mini')
}

function closeWindow() {
  close()
  emit('close-window')
}

function onPointerDown(event) {
  if (!open.value) return
  if (rootRef.value?.contains(event.target)) return
  if (panelRef.value?.contains(event.target)) return
  close()
}

onBeforeUnmount(() => {
  chromeLocks.releaseLock(MINI_MENU_LOCK_ID)
  document.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('resize', updatePanelPosition)
})
</script>

<template>
  <div ref="rootRef" class="mini-menu" data-gesture-inert>
    <button
      ref="triggerRef"
      class="mini-menu-trigger"
      :class="{ active: open }"
      type="button"
      aria-label="精简态菜单"
      :aria-expanded="String(open)"
      aria-haspopup="menu"
      @click="toggle"
    >
      <Icon name="more-horizontal" size="14px" stroke-width="2" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="panelRef" class="mini-menu-panel" role="menu" :style="panelStyle">
        <button data-test="exit-mini" type="button" role="menuitem" @click="exitMini">
          退出精简态
        </button>
        <button data-test="close-window" type="button" role="menuitem" @click="closeWindow">
          关闭窗口
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mini-menu {
  position: relative;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.mini-menu-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1;
  letter-spacing: 0;
  -webkit-app-region: no-drag;
}

.mini-menu-trigger:hover,
.mini-menu-trigger.active {
  background: var(--toolbar-border);
  color: var(--text-primary);
}

.mini-menu-panel {
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

.mini-menu-panel button {
  display: block;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  letter-spacing: 0;
}

.mini-menu-panel button:hover {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
  color: var(--text-primary);
}
@keyframes menu-pop-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}
</style>
