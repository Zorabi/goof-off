<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import { computeSiteMenuPosition } from '../composables/siteMenuPosition.js'

const props = defineProps({
  name: { type: String, required: true },
  removable: { type: Boolean, default: false },
  lockOwnerId: { type: String, default: '' }
})
const emit = defineEmits(['click', 'edit', 'remove'])

const chromeLocks = injectChromeLockRegistry()
const menuOpen = ref(false)
const confirmingDelete = ref(false)
const wrapperRef = ref(null)
const tileRef = ref(null)
const confirmDeleteRef = ref(null)
const menuRef = ref(null)
const menuStyle = ref({})
const menuPlacement = ref('below')

const ownerId = () => props.lockOwnerId || `content.site-card-menu:${props.name}`

function positionMenu() {
  const tile = tileRef.value
  const menu = menuRef.value
  if (!tile || !menu) return
  const result = computeSiteMenuPosition({
    tileRect: tile.getBoundingClientRect(),
    menuSize: { width: menu.offsetWidth, height: menu.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight }
  })
  menuPlacement.value = result.placement
  menuStyle.value = { left: `${result.left}px`, top: `${result.top}px`, visibility: 'visible' }
}

function closeMenu({ restoreFocus = false, reason = 'close' } = {}) {
  menuOpen.value = false
  confirmingDelete.value = false
  chromeLocks.releaseLock(ownerId(), { restoreFocus, reason })
}

function registerMenuLock() {
  chromeLocks.registerLock({
    ownerId: ownerId(),
    kind: 'menu',
    scope: 'content',
    appliesTo: { content: ['home'], form: ['normal'] },
    focusRestore: { mode: 'trigger', target: tileRef },
    onEscape: ({ reason } = {}) => {
      closeMenu({ restoreFocus: reason === 'escape', reason: reason || 'escape' })
    }
  })
}

function onAnchorInvalidated() {
  if (!menuOpen.value) return
  closeMenu({ restoreFocus: false, reason: 'anchor-moved' })
}

watch(menuOpen, (open) => {
  if (open) {
    registerMenuLock()
    document.addEventListener('scroll', onAnchorInvalidated, true)
    window.addEventListener('resize', onAnchorInvalidated)
  } else {
    chromeLocks.releaseLock(ownerId())
    document.removeEventListener('scroll', onAnchorInvalidated, true)
    window.removeEventListener('resize', onAnchorInvalidated)
  }
})

watch(confirmingDelete, () => {
  if (menuOpen.value) nextTick(positionMenu)
})

function onContextMenu(e) {
  if (!props.removable) return
  e.preventDefault()
  e.stopPropagation()
  menuStyle.value = { visibility: 'hidden' }
  menuOpen.value = true
  nextTick(positionMenu)
}
function onEdit(e) {
  e.stopPropagation()
  const focusTarget = tileRef.value
  closeMenu({ restoreFocus: false, reason: 'edit' })
  emit('edit', { focusTarget })
}
function onDeleteRequest(e) {
  e.stopPropagation()
  confirmingDelete.value = true
  nextTick(() => {
    if (menuOpen.value && confirmingDelete.value) {
      confirmDeleteRef.value?.focus?.({ preventScroll: true })
    }
  })
}
function onCancelDelete(e) {
  e.stopPropagation()
  closeMenu({ restoreFocus: true, reason: 'cancel-delete' })
}
function onConfirmRemove(e) {
  e.stopPropagation()
  closeMenu({ restoreFocus: false, reason: 'confirm-remove' })
  emit('remove')
}
function isInsideInteractiveArea(node) {
  if (!(node instanceof Node)) return false
  return Boolean(wrapperRef.value?.contains(node) || menuRef.value?.contains(node))
}
function onFocusout(e) {
  if (isInsideInteractiveArea(e.relatedTarget)) return
  setTimeout(() => {
    if (isInsideInteractiveArea(document.activeElement)) return
    closeMenu({ restoreFocus: false, reason: 'focusout' })
  }, 0)
}
function onDocumentPointerdown(e) {
  if (!menuOpen.value) return
  if (isInsideInteractiveArea(e.target)) return
  closeMenu({ restoreFocus: false, reason: 'outside-pointer' })
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerdown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerdown, true)
  document.removeEventListener('scroll', onAnchorInvalidated, true)
  window.removeEventListener('resize', onAnchorInvalidated)
  chromeLocks.releaseLock(ownerId())
})
</script>

<template>
  <div ref="wrapperRef" class="site-card-wrap" @focusout="onFocusout">
    <button ref="tileRef" class="site-card" @click="$emit('click')" @contextmenu="onContextMenu">
      <span class="name">{{ name }}</span>
    </button>
    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="menuRef"
        class="menu"
        :class="{ 'is-above': menuPlacement === 'above' }"
        :style="menuStyle"
        @focusout="onFocusout"
      >
        <template v-if="!confirmingDelete">
          <button @click.stop="onEdit">编辑</button>
          <button class="danger" @click.stop="onDeleteRequest">删除</button>
        </template>
        <template v-else>
          <button ref="confirmDeleteRef" class="danger" @click.stop="onConfirmRemove">
            确认删除
          </button>
          <button @click.stop="onCancelDelete">取消</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.site-card-wrap {
  position: relative;
  min-width: 0;
}

.site-card {
  width: 100%;
  height: 38px;
  border: 0;
  border-radius: var(--radius-tile);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  padding: 0 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--motion-micro) ease;
  user-select: none;
  overflow: hidden;
}
.site-card:hover,
.site-card:focus-visible {
  background: var(--color-hover-bg);
}
.site-card:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}

.name {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: normal;
  line-height: 1.2;
  font-size: 11px;
  color: inherit;
  text-align: center;
}

.menu {
  position: fixed;
  min-width: 104px;
  padding: 4px;
  background: var(--effective-popover-bg, var(--panel-bg));
  backdrop-filter: var(--effective-popover-backdrop-filter, blur(var(--panel-material-blur)));
  border: 1px solid var(--effective-popover-border, var(--toolbar-border));
  border-radius: 6px;
  box-shadow: var(--effective-popover-shadow, var(--shadow-float));
  z-index: var(--z-popover);
  animation: menu-pop-in var(--motion-micro) ease;
}
.menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
}
.menu button:hover {
  background: var(--effective-popover-hover-bg, var(--color-hover-bg));
}
.menu .danger {
  color: var(--color-danger);
}
@keyframes menu-pop-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}
.menu.is-above {
  animation-name: menu-pop-in-up;
}
@keyframes menu-pop-in-up {
  from {
    opacity: 0;
    transform: translateY(2px);
  }
}
</style>
