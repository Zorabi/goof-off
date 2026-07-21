<script setup>
import {
  useFloating,
  offset as floatingOffset,
  flip,
  shift,
  size,
  autoUpdate
} from '@floating-ui/vue'
import { computed, ref, toRef, unref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useBrowser } from '../composables/useBrowser.js'
import { usePopoverRegistry } from '../composables/usePopoverRegistry.js'
import { createPopoverOverflowController } from '../composables/usePopoverOverflow.js'

const props = defineProps({
  modelValue: Boolean,
  popoverId: { type: String, required: true },
  triggerEl: { type: Object, default: null },
  anchorEl: { type: Object, default: null },
  placement: { type: String, default: 'top' },
  offset: { type: Number, default: 4 },
  maxHeight: { type: Number, default: null },
  panelId: { type: String, required: true },
  desiredSize: { type: Object, default: null },
  snapshot: { type: Object, default: null },
  childActionHandler: { type: Function, default: null },
  forceChildHost: { type: Boolean, default: false },
  lockAppliesTo: { type: Object, default: null },
  lockPriority: { type: Number, default: 30 }
})

const emit = defineEmits(['update:modelValue'])
const { notifyPopover } = useBrowser()
const { register, unregister, updateKind, getReservedPopoverId, setReservedPopoverId } =
  usePopoverRegistry()

const popoverPanelRef = ref(null)
const triggerRef = toRef(() => props.triggerEl)
const anchorRef = toRef(() => props.anchorEl || props.triggerEl)
const modelValueRef = toRef(props, 'modelValue')
const snapshotRef = toRef(props, 'snapshot')
const appliedMaxHeight = ref(null)
const isOverflowHostResolving = ref(false)
const isOverflowHostResolved = ref(!props.desiredSize)
let disposed = false
let updateCounter = 0
let overflowResolutionCounter = 0
let removePointerListener = null
let resizeObserver = null
let reservationNotified = false
let closeContextForNextUnregister = null

function shouldRestoreFocusForClose(context) {
  if (context?.restoreFocus === false) return false
  return context?.reason !== 'replaced'
}

function closePopover(payload = {}) {
  closeContextForNextUnregister = {
    reason: payload?.reason || 'release',
    restoreFocus: payload?.restoreFocus
  }
  emit('update:modelValue', false)
}

const overflow = props.desiredSize
  ? createPopoverOverflowController({
      id: props.popoverId,
      modelValue: modelValueRef,
      triggerEl: anchorRef,
      panelEl: popoverPanelRef,
      placement: props.placement,
      desiredSizeDip: props.desiredSize,
      snapshot: snapshotRef,
      onChildAction: props.childActionHandler,
      onChildClose: closePopover,
      forceChildHost: toRef(props, 'forceChildHost'),
      onChildOpenFailed: () => closePopover({ reason: 'open-failed' })
    })
  : null
const isForcedChildHost = computed(() => Boolean(overflow && props.forceChildHost))
const renderInMainWindow = computed(
  () =>
    props.modelValue &&
    isOverflowHostResolved.value &&
    !overflow?.isChildHostActive.value &&
    !isForcedChildHost.value
)

async function resolveOverflowHost() {
  if (!overflow) return
  const currentCounter = ++overflowResolutionCounter
  isOverflowHostResolved.value = false
  isOverflowHostResolving.value = true
  try {
    await overflow.recompute()
  } finally {
    if (!disposed && currentCounter === overflowResolutionCounter) {
      isOverflowHostResolved.value = true
      isOverflowHostResolving.value = false
    }
  }
}

function cancelOverflowHostResolution() {
  overflowResolutionCounter++
  isOverflowHostResolved.value = !overflow
  isOverflowHostResolving.value = false
}

function handlePointerDown(event) {
  if (!props.modelValue) return
  const panel = popoverPanelRef.value
  const trigger = props.triggerEl
  const target = event.target
  if (panel?.contains(target) || trigger?.contains?.(target)) return
  emit('update:modelValue', false)
}

const fallbackPlacements = computed(() => (props.placement === 'top' ? ['left', 'right'] : ['top']))

const { floatingStyles, isPositioned } = useFloating(anchorRef, popoverPanelRef, {
  open: modelValueRef,
  placement: props.placement,
  transform: false,
  middleware: [
    floatingOffset(props.offset),
    flip({ padding: 8, fallbackPlacements: fallbackPlacements.value }),
    shift({ padding: 8 }),
    size({
      apply({ availableHeight, elements }) {
        const limit = props.maxHeight ?? availableHeight - 16
        const maxHeight = Math.max(0, Math.min(limit, availableHeight - 16))
        appliedMaxHeight.value = maxHeight
        Object.assign(elements.floating.style, { maxHeight: `${maxHeight}px` })
      }
    })
  ],
  whileElementsMounted: autoUpdate
})

const panelStyles = computed(() => {
  const styles = { ...unref(floatingStyles) }
  const maxHeight = appliedMaxHeight.value ?? props.maxHeight
  if (Number.isFinite(maxHeight)) styles.maxHeight = `${Math.max(0, maxHeight)}px`
  if (props.modelValue && (!isPositioned.value || isOverflowHostResolving.value)) {
    styles.visibility = 'hidden'
  }
  return styles
})

watch(
  () => props.modelValue,
  async (isOpen) => {
    if (isOpen) {
      document.addEventListener('pointerdown', handlePointerDown)
      removePointerListener = () => document.removeEventListener('pointerdown', handlePointerDown)
      await resolveOverflowHost()
    } else {
      cancelOverflowHostResolution()
      removePointerListener?.()
      removePointerListener = null
      overflow?.closeChild()
    }
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      closeContextForNextUnregister = null
      register(props.popoverId, closePopover, {
        priority: props.lockPriority,
        appliesTo: props.lockAppliesTo,
        triggerEl: triggerRef
      })
    } else {
      const closeContext = closeContextForNextUnregister
      closeContextForNextUnregister = null
      unregister(props.popoverId, {
        restoreFocus: shouldRestoreFocusForClose(closeContext),
        reason: closeContext?.reason || 'release'
      })
    }
  },
  { immediate: true }
)

watch(
  [() => props.modelValue, isOverflowHostResolved],
  async ([isOpen]) => {
    const currentCounter = ++updateCounter

    if (isOpen && renderInMainWindow.value) {
      const previousReservedOwner = getReservedPopoverId()
      reservationNotified = previousReservedOwner !== null
      setReservedPopoverId(props.popoverId)
      await nextTick()
      await nextTick()
      if (disposed || currentCounter !== updateCounter || !renderInMainWindow.value) return

      const height = popoverPanelRef.value?.offsetHeight ?? 120
      reservationNotified = true
      notifyPopover(true, height)

      resizeObserver?.disconnect()
      if (popoverPanelRef.value) {
        resizeObserver = new ResizeObserver(() => {
          if (!disposed && props.modelValue && getReservedPopoverId() === props.popoverId) {
            const currentHeight = popoverPanelRef.value?.offsetHeight ?? 120
            notifyPopover(true, currentHeight)
          }
        })
        resizeObserver.observe(popoverPanelRef.value)
      }
    } else {
      resizeObserver?.disconnect()
      resizeObserver = null
      if (getReservedPopoverId() === props.popoverId) {
        setReservedPopoverId(null)
        if (reservationNotified) notifyPopover(false, 0)
      }
      reservationNotified = false
    }
  },
  { immediate: true, flush: 'post' }
)

watch(
  () => overflow?.isChildHostActive.value,
  async (isChild, wasChild) => {
    if (isChild) {
      updateKind(props.popoverId, 'native-popover')
      resizeObserver?.disconnect()
      resizeObserver = null
      if (getReservedPopoverId() === props.popoverId) {
        setReservedPopoverId(null)
        if (reservationNotified) notifyPopover(false, 0)
      }
      reservationNotified = false
      return
    }
    if (wasChild && props.modelValue && !isForcedChildHost.value) {
      updateKind(props.popoverId, 'popover')
      setReservedPopoverId(props.popoverId)
      await nextTick()
      const height = popoverPanelRef.value?.offsetHeight ?? 120
      reservationNotified = true
      notifyPopover(true, height)
    }
  }
)

onBeforeUnmount(() => {
  disposed = true
  updateCounter++
  cancelOverflowHostResolution()
  removePointerListener?.()
  resizeObserver?.disconnect()
  overflow?.dispose()
  unregister(props.popoverId)
  if (getReservedPopoverId() === props.popoverId) {
    setReservedPopoverId(null)
    if (reservationNotified) notifyPopover(false, 0)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="popover">
      <div
        v-if="renderInMainWindow"
        :id="panelId"
        ref="popoverPanelRef"
        :style="panelStyles"
        class="base-popover"
        data-gesture-inert
        role="dialog"
        aria-modal="false"
      >
        <slot name="content" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-popover {
  background: var(--effective-popover-bg, var(--panel-bg));
  backdrop-filter: var(--effective-popover-backdrop-filter, blur(var(--panel-material-blur)));
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--effective-popover-border, var(--toolbar-border));
  box-shadow: var(--effective-popover-shadow, var(--shadow-float));
  padding: 12px 16px;
  overflow-y: auto;
  z-index: 1000;
  -webkit-app-region: no-drag;
}
.base-popover::-webkit-scrollbar {
  display: none;
}
.popover-enter-active,
.popover-leave-active {
  transition: opacity var(--motion-panel);
}
.popover-enter-from {
  opacity: 0;
}
.popover-leave-to {
  opacity: 0;
}
</style>
