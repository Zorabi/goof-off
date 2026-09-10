<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  options: { type: Array, required: true },
  modelValue: { type: [String, Number], default: null },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '' },
  dataTest: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])
const triggerRef = ref(null)
const menuRef = ref(null)
const open = ref(false)
const activeIndex = ref(0)
const menuStyle = ref({})
let positionFrame = null

const selectedIndex = computed(() => {
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  return index >= 0 ? index : 0
})
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label || '')
const listboxId = computed(() => (props.dataTest ? `${props.dataTest}-listbox` : undefined))

function optionId(index) {
  return listboxId.value ? `${listboxId.value}-option-${index}` : undefined
}

function positionMenu() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const estimatedHeight = Math.min(
    menuRef.value?.scrollHeight || props.options.length * 44 + 8,
    264
  )
  const openUpward =
    window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight
  const top = openUpward
    ? Math.max(4, rect.top - estimatedHeight - 4)
    : Math.min(window.innerHeight - estimatedHeight - 4, rect.bottom + 4)
  menuStyle.value = {
    left: `${Math.max(4, Math.min(rect.left, window.innerWidth - rect.width - 4))}px`,
    top: `${Math.max(4, top)}px`,
    minWidth: `${rect.width}px`
  }
}

function schedulePositionMenu() {
  if (!open.value || positionFrame != null) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = null
    if (open.value) positionMenu()
  })
}

async function showMenu() {
  if (props.disabled || open.value) return
  activeIndex.value = selectedIndex.value
  positionMenu()
  open.value = true
  await nextTick()
  positionMenu()
}

function closeMenu() {
  open.value = false
  if (positionFrame != null) cancelAnimationFrame(positionFrame)
  positionFrame = null
}

function toggleMenu() {
  if (open.value) closeMenu()
  else showMenu()
}

function selectIndex(index) {
  const option = props.options[index]
  if (!option) return
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
  closeMenu()
  nextTick(() => triggerRef.value?.focus())
}

function moveActive(delta) {
  if (!props.options.length) return
  activeIndex.value = (activeIndex.value + delta + props.options.length) % props.options.length
}

function onTriggerKeydown(event) {
  if (props.disabled) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    if (!open.value) showMenu()
    else moveActive(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    if (open.value) selectIndex(activeIndex.value)
    else showMenu()
    return
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    if (!open.value) showMenu()
    activeIndex.value = event.key === 'Home' ? 0 : Math.max(0, props.options.length - 1)
  }
}

function onWindowKeydown(event) {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    nextTick(() => triggerRef.value?.focus())
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    selectIndex(activeIndex.value)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    activeIndex.value = event.key === 'Home' ? 0 : Math.max(0, props.options.length - 1)
  } else if (event.key === 'Tab') {
    closeMenu()
  }
}

function onDocumentPointerdown(event) {
  if (!open.value) return
  if (triggerRef.value?.contains(event.target) || menuRef.value?.contains(event.target)) return
  closeMenu()
}

function onViewportChange(event) {
  if (event?.target && menuRef.value?.contains(event.target)) return
  schedulePositionMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  document.addEventListener('pointerdown', onDocumentPointerdown, true)
})

onBeforeUnmount(() => {
  if (positionFrame != null) cancelAnimationFrame(positionFrame)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  document.removeEventListener('pointerdown', onDocumentPointerdown, true)
})
</script>

<template>
  <span class="prefs-select">
    <button
      ref="triggerRef"
      type="button"
      class="prefs-select__trigger"
      :class="{ 'is-open': open }"
      :data-test="dataTest || undefined"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="listboxId"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="prefs-select__value">{{ selectedLabel }}</span>
      <span class="prefs-select__chevron" aria-hidden="true"></span>
    </button>

    <Teleport to=".prefs-shell">
      <div
        v-if="open"
        :id="listboxId"
        ref="menuRef"
        class="prefs-select__menu"
        role="listbox"
        :aria-label="ariaLabel || undefined"
        :aria-activedescendant="optionId(activeIndex)"
        :data-test="dataTest ? `${dataTest}-listbox` : undefined"
        :style="menuStyle"
      >
        <button
          v-for="(option, index) in options"
          :id="optionId(index)"
          :key="option.value"
          type="button"
          role="option"
          class="prefs-select__option"
          :class="{
            'is-selected': option.value === modelValue,
            'is-active': index === activeIndex
          }"
          :aria-selected="option.value === modelValue ? 'true' : 'false'"
          :data-test="dataTest ? `${dataTest}-${option.value}` : undefined"
          @mouseenter="activeIndex = index"
          @pointerdown.prevent="selectIndex(index)"
        >
          <span>{{ option.label }}</span>
          <span v-if="option.value === modelValue" class="prefs-select__check" aria-hidden="true"
            >✓</span
          >
        </button>
      </div>
    </Teleport>
  </span>
</template>
