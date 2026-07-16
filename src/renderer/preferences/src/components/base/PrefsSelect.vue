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

const selectedIndex = computed(() => {
  const index = props.options.findIndex((option) => option.value === props.modelValue)
  return index >= 0 ? index : 0
})
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label || '')
const listboxId = computed(() => (props.dataTest ? `${props.dataTest}-listbox` : undefined))

function positionMenu() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const estimatedHeight = props.options.length * 30 + 8
  const openUpward =
    window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight
  menuStyle.value = {
    left: `${rect.left}px`,
    top: openUpward ? `${Math.max(4, rect.top - estimatedHeight - 4)}px` : `${rect.bottom + 4}px`,
    width: `${rect.width}px`
  }
}

async function showMenu() {
  if (props.disabled || open.value) return
  activeIndex.value = selectedIndex.value
  open.value = true
  await nextTick()
  positionMenu()
}

function closeMenu() {
  open.value = false
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
  }
}

function onDocumentPointerdown(event) {
  if (!open.value) return
  if (triggerRef.value?.contains(event.target) || menuRef.value?.contains(event.target)) return
  closeMenu()
}

function onViewportChange() {
  if (open.value) closeMenu()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  document.addEventListener('pointerdown', onDocumentPointerdown, true)
})

onBeforeUnmount(() => {
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

    <div
      v-if="open"
      :id="listboxId"
      ref="menuRef"
      class="prefs-select__menu"
      role="listbox"
      :aria-label="ariaLabel || undefined"
      :data-test="dataTest ? `${dataTest}-listbox` : undefined"
      :style="menuStyle"
    >
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        role="option"
        class="prefs-select__option"
        :class="{ 'is-selected': option.value === modelValue, 'is-active': index === activeIndex }"
        :aria-selected="option.value === modelValue ? 'true' : 'false'"
        :data-test="dataTest ? `${dataTest}-${option.value}` : undefined"
        @mouseenter="activeIndex = index"
        @click="selectIndex(index)"
      >
        <span>{{ option.label }}</span>
        <span v-if="option.value === modelValue" class="prefs-select__check" aria-hidden="true"
          >✓</span
        >
      </button>
    </div>
  </span>
</template>
