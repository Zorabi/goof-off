<script setup>
import { computed } from 'vue'
import IconButton from './base/IconButton.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  closeLabel: { type: String, default: '关闭面板' },
  headerAction: { type: Object, default: null },
  dock: { type: String, default: 'left' }
})

const emit = defineEmits(['close', 'header-action'])

const WHEEL_LINE_PX = 16
const actionIcon = computed(() => props.headerAction?.icon || 'close')
const actionLabel = computed(() => props.headerAction?.label || props.closeLabel)
const isBottomDock = computed(() => props.dock === 'bottom')
const transitionName = computed(() =>
  isBottomDock.value ? 'reader-bottom-panel' : 'reader-side-panel'
)

function runHeaderAction() {
  if (props.headerAction) {
    emit('header-action')
    return
  }
  emit('close')
}

function getWheelDeltaMode() {
  return typeof WheelEvent === 'undefined' ? 0 : WheelEvent.DOM_DELTA_PIXEL
}

function wheelDeltaToPixels(delta, mode, pageSize) {
  if (typeof WheelEvent !== 'undefined' && mode === WheelEvent.DOM_DELTA_LINE) {
    return delta * WHEEL_LINE_PX
  }
  if (typeof WheelEvent !== 'undefined' && mode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * pageSize
  }
  return delta
}

function isEditableWheelTarget(element, boundary) {
  let current = element
  while (current && current !== boundary) {
    if (
      current instanceof HTMLInputElement ||
      current instanceof HTMLTextAreaElement ||
      current.isContentEditable
    ) {
      return true
    }
    current = current.parentElement
  }
  return false
}

function canScrollHorizontally(element) {
  const overflowX = window.getComputedStyle(element).overflowX
  return (
    ['auto', 'scroll', 'overlay'].includes(overflowX) && element.scrollWidth > element.clientWidth
  )
}

function findHorizontalScrollTarget(target, boundary) {
  if (!(target instanceof Element)) return null
  if (isEditableWheelTarget(target, boundary)) return null

  let current = target
  while (current && current !== boundary) {
    if (canScrollHorizontally(current)) return current
    current = current.parentElement
  }
  return canScrollHorizontally(boundary) ? boundary : null
}

function handleWheel(event) {
  if (!event.shiftKey || event.ctrlKey || event.metaKey) return

  const scrollTarget = findHorizontalScrollTarget(event.target, event.currentTarget)
  if (!scrollTarget) return

  const mode = event.deltaMode ?? getWheelDeltaMode()
  const deltaX = wheelDeltaToPixels(event.deltaX || 0, mode, scrollTarget.clientWidth)
  const deltaY = wheelDeltaToPixels(event.deltaY || 0, mode, scrollTarget.clientWidth)
  if (!deltaY || Math.abs(deltaX) > Math.abs(deltaY)) return

  const maxLeft = scrollTarget.scrollWidth - scrollTarget.clientWidth
  const nextLeft = Math.max(0, Math.min(maxLeft, scrollTarget.scrollLeft + deltaY))
  event.preventDefault()
  scrollTarget.scrollLeft = nextLeft
}
</script>

<template>
  <Transition :name="transitionName">
    <aside
      v-if="open"
      class="reader-side-panel"
      :class="{ 'is-dock-bottom': isBottomDock }"
      data-gesture-inert
      role="dialog"
      :aria-label="title"
      tabindex="-1"
      @wheel="handleWheel"
    >
      <div v-if="isBottomDock" class="reader-panel-handle" aria-hidden="true"></div>
      <header v-else class="reader-side-panel-header">
        <span class="reader-side-panel-title">{{ title }}</span>
        <IconButton
          :icon="actionIcon"
          :aria-label="actionLabel"
          :title="actionLabel"
          @click="runHeaderAction"
        />
      </header>
      <div class="reader-side-panel-body">
        <slot />
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.reader-side-panel {
  position: absolute;
  top: var(--chrome-hot-zone-h);
  bottom: var(--chrome-hot-zone-h);
  left: 0;
  z-index: var(--z-panel);
  display: flex;
  width: 50%;
  min-width: 0;
  flex-direction: column;
  overflow: visible;
  border-right: 1px solid var(--color-divider);
  color: var(--color-text-primary);
  background: var(--panel-bg);
  backdrop-filter: blur(var(--panel-material-blur));
  outline: none;
}

.reader-side-panel.is-dock-bottom {
  top: auto;
  right: 0;
  bottom: var(--chrome-bottom-h);
  width: auto;
  height: clamp(180px, 36%, 340px);
  border-top: 1px solid var(--color-divider);
  border-right: none;
}

.reader-panel-handle {
  display: flex;
  height: 12px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.reader-panel-handle::before {
  content: '';
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: var(--color-divider);
}

.reader-side-panel-header {
  display: flex;
  min-height: var(--chrome-top-h-mini);
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0 var(--space-sm) 0 var(--space-md);
  border-bottom: 1px solid var(--color-divider);
}

.reader-side-panel-title {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--text-section-size);
  font-weight: var(--text-section-weight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-side-panel-body {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.reader-side-panel-enter-active,
.reader-side-panel-leave-active,
.reader-bottom-panel-enter-active,
.reader-bottom-panel-leave-active {
  transition:
    transform var(--motion-panel),
    opacity var(--motion-panel);
}

.reader-side-panel-enter-from,
.reader-side-panel-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

.reader-bottom-panel-enter-from,
.reader-bottom-panel-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .reader-side-panel-enter-active,
  .reader-side-panel-leave-active,
  .reader-bottom-panel-enter-active,
  .reader-bottom-panel-leave-active {
    transition: opacity var(--motion-panel);
  }

  .reader-side-panel-enter-from,
  .reader-side-panel-leave-to,
  .reader-bottom-panel-enter-from,
  .reader-bottom-panel-leave-to {
    transform: none;
  }
}
</style>
