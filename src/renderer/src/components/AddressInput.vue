<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHROME_HOT_ZONE_HEIGHT } from '../../../shared/chromeLayoutModel.js'
import { POPOVER_DESIRED_SIZE } from '../../../shared/popoverProtocol.js'
import { buildThemeSnapshot } from '../popoverAdapters.js'

const props = defineProps({
  controller: { type: Object, required: true },
  placeholder: { type: String, default: '输入网址或搜索' },
  ariaLabel: { type: String, default: '地址或搜索' },
  suggestionsHost: {
    type: String,
    default: 'inline',
    validator: (value) => ['inline', 'child'].includes(value)
  },
  chromeVisible: { type: Boolean, default: true },
  bodyHidden: { type: Boolean, default: false }
})

const inputRef = ref(null)
const listRef = ref(null)
const listId = `address-suggestions-${Math.random().toString(36).slice(2)}`
let requestSeq = 0
let childItemSeq = 0
let activeRequestToken = null
let removeChildAction = null
let removeChildClose = null
let removeRecompute = null
let childSuggestionIds = new Map()

const activeDescendant = computed(() => {
  const item = props.controller.suggestions.value?.[props.controller.activeIndex.value]
  return item ? optionId(item) : undefined
})

const shouldUseChildSuggestions = computed(() => props.suggestionsHost === 'child')

const listStyle = computed(() => ({
  '--address-suggestions-max-height': `min(260px, calc(100vh - ${CHROME_HOT_ZONE_HEIGHT * 2}px))`
}))

function optionId(item) {
  return `address-option-${String(item.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function onInput(event) {
  props.controller.setInputValue(event.target.value)
}

function onFocus() {
  props.controller.focus()
  nextTick(() => inputRef.value?.select?.())
}

function onBlur() {
  if (shouldUseChildSuggestions.value && activeRequestToken) {
    props.controller.deferBlur?.()
    return
  }
  props.controller.blur()
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    props.controller.moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    props.controller.moveActive(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    props.controller.commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    props.controller.escape()
  }
}

function sourceLabel(source) {
  return source === 'history' ? '历史' : '收藏'
}

function setActiveIndex(index) {
  props.controller.setActiveIndex(index)
}

function commitSuggestion(index) {
  setActiveIndex(index)
  props.controller.commit()
}

function measureSuggestions() {
  const rect = listRef.value?.getBoundingClientRect?.()
  if (rect) props.controller.setSuggestionPanelHeight(rect.height)
}

function readInputRect() {
  const rect = inputRef.value?.getBoundingClientRect?.()
  if (!rect) return null
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function childSuggestionKey(item) {
  return `${item.source}\u0000${item.id}\u0000${item.targetUrl || ''}`
}

function childSuggestionIdFor(item) {
  const key = childSuggestionKey(item)
  const existing = childSuggestionIds.get(key)
  if (existing) return existing
  const id = `address-item-${++childItemSeq}`
  childSuggestionIds.set(key, id)
  return id
}

function syncChildSuggestionIds() {
  const next = new Map()
  for (const item of props.controller.suggestions.value) {
    const key = childSuggestionKey(item)
    next.set(key, childSuggestionIds.get(key) || `address-item-${++childItemSeq}`)
  }
  childSuggestionIds = next
}

function suggestionItems() {
  syncChildSuggestionIds()
  return props.controller.suggestions.value.map((item) => ({
    id: childSuggestionIdFor(item),
    source: item.source,
    label: item.label,
    displayUrl: item.displayUrl
  }))
}

function buildChildSnapshot() {
  const style = getComputedStyle(inputRef.value)
  return {
    id: 'address-suggestions',
    items: suggestionItems(),
    activeIndex: props.controller.activeIndex.value,
    fontSize: style.fontSize || 'var(--text-address-size)',
    fontWeight: style.fontWeight || 'var(--text-address-weight)',
    theme: buildThemeSnapshot()
  }
}

function ownsChildSuggestions(payload) {
  return payload?.id === 'address-suggestions' && payload.requestToken === activeRequestToken
}

function hasCurrentSuggestionItem(payload) {
  if (!Number.isInteger(payload?.index) || payload.index < 0) return false
  const item = props.controller.suggestions.value[payload.index]
  if (!item) return false
  return childSuggestionIds.get(childSuggestionKey(item)) === payload.itemId
}

async function closeOwnerAfterChildFailure(requestToken) {
  const closeResult = window.api?.popoverClose?.({ id: 'address-suggestions', requestToken })
  if (activeRequestToken === requestToken) {
    activeRequestToken = null
    childSuggestionIds = new Map()
  }
  const escapeResult = props.controller.escape()
  await closeResult
  await escapeResult
}

async function openOrUpdateChildSuggestions() {
  if (!shouldUseChildSuggestions.value) return
  if (!props.controller.editing.value || props.controller.suggestions.value.length === 0) {
    await closeChildSuggestions()
    return
  }
  const triggerRectDip = readInputRect()
  if (!triggerRectDip) {
    await closeChildSuggestions()
    return
  }
  const existingRequestToken = activeRequestToken
  const requestToken = existingRequestToken || `address-suggestions:${++requestSeq}`
  const snapshot = buildChildSnapshot()
  const desiredSizeDip = {
    width: Math.max(1, Math.ceil(triggerRectDip.width)),
    height: POPOVER_DESIRED_SIZE['address-suggestions'].height
  }
  const payload = {
    id: 'address-suggestions',
    requestToken,
    placement: 'bottom',
    triggerRectDip,
    desiredSizeDip,
    mainWindowSizeDip: { width: window.innerWidth, height: window.innerHeight },
    snapshot
  }
  if (existingRequestToken) {
    const updated = await window.api?.popoverUpdateSnapshot?.(payload)
    if (updated !== true && activeRequestToken === requestToken) {
      await closeOwnerAfterChildFailure(requestToken)
    }
    return
  }
  activeRequestToken = requestToken
  const opened = await window.api?.popoverOpen?.(payload)
  if (activeRequestToken === requestToken) {
    if (opened === true) activeRequestToken = requestToken
    else await closeOwnerAfterChildFailure(requestToken)
  } else if (opened === true) {
    await window.api?.popoverClose?.({ id: 'address-suggestions', requestToken })
  }
}

async function closeChildSuggestions() {
  if (!activeRequestToken) {
    childSuggestionIds = new Map()
    return
  }
  const requestToken = activeRequestToken
  await window.api?.popoverClose?.({ id: 'address-suggestions', requestToken })
  if (activeRequestToken === requestToken) {
    activeRequestToken = null
    childSuggestionIds = new Map()
  }
}

async function closeForHiddenHost() {
  if (!activeRequestToken && !props.controller.editing.value) return
  props.controller.cancelDeferredBlur?.()
  const escapeResult = props.controller.escape?.()
  await closeChildSuggestions()
  await escapeResult
}

function handleChildAction(payload) {
  if (!ownsChildSuggestions(payload)) return
  if (payload.action === 'set-active-index') {
    if (!hasCurrentSuggestionItem(payload)) return
    props.controller.cancelDeferredBlur?.()
    props.controller.setActiveIndex(payload.index)
    return
  }
  if (payload.action === 'commit-suggestion') {
    if (!hasCurrentSuggestionItem(payload)) return
    props.controller.cancelDeferredBlur?.()
    props.controller.setActiveIndex(payload.index)
    props.controller.commit()
    return
  }
  if (payload.action === 'close') {
    props.controller.cancelDeferredBlur?.()
    props.controller.escape()
  }
}

async function handleChildClose(payload) {
  if (!ownsChildSuggestions(payload)) return
  props.controller.blur()
  await closeChildSuggestions()
}

watch(
  () => props.controller.suggestions.value.length,
  async () => {
    await nextTick()
    measureSuggestions()
  }
)

watch(
  () => [
    props.controller.editing.value,
    props.controller.suggestions.value,
    props.controller.activeIndex.value
  ],
  async () => {
    await nextTick()
    await openOrUpdateChildSuggestions()
  },
  { deep: true }
)

watch(
  () => [props.chromeVisible, props.bodyHidden],
  ([chromeVisible, bodyHidden]) => {
    if (chromeVisible !== false && bodyHidden !== true) return
    void closeForHiddenHost()
  }
)

onMounted(async () => {
  measureSuggestions()
  removeChildAction = window.api?.onPopoverChildAction?.(handleChildAction)
  removeChildClose = window.api?.onPopoverChildClose?.(handleChildClose)
  removeRecompute = window.api?.onPopoverRecomputeRequest?.((payload) => {
    if (payload?.id === 'address-suggestions') openOrUpdateChildSuggestions()
  })
  await nextTick()
  await openOrUpdateChildSuggestions()
})

onBeforeUnmount(() => {
  removeChildAction?.()
  removeChildClose?.()
  removeRecompute?.()
  closeChildSuggestions()
})
</script>

<template>
  <div class="address-input">
    <input
      ref="inputRef"
      class="address-input__field"
      type="text"
      :value="controller.displayValue.value"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="String(controller.suggestions.value.length > 0)"
      :aria-controls="listId"
      :aria-activedescendant="activeDescendant"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />

    <ul
      v-if="
        !shouldUseChildSuggestions &&
        controller.editing.value &&
        controller.suggestions.value.length > 0
      "
      :id="listId"
      ref="listRef"
      class="address-input__list"
      :style="listStyle"
      role="listbox"
    >
      <li
        v-for="(item, index) in controller.suggestions.value"
        :id="optionId(item)"
        :key="item.id"
        class="address-input__option"
        :class="{ 'is-active': index === controller.activeIndex.value }"
        role="option"
        :aria-selected="String(index === controller.activeIndex.value)"
        @mouseenter="setActiveIndex(index)"
        @mousedown.prevent="commitSuggestion(index)"
      >
        <span class="address-input__label">{{ item.label }}</span>
        <span class="address-input__display">{{ item.displayUrl }}</span>
        <span class="address-input__source">{{ sourceLabel(item.source) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.address-input {
  position: relative;
  width: 100%;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.address-input__field {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  -webkit-app-region: no-drag;
}

.address-input__field:focus-visible {
  border: var(--focus-ring-input);
}

.address-input__list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: var(--z-popover);
  max-height: var(--address-suggestions-max-height);
  margin: 0;
  padding: 4px;
  overflow: auto;
  list-style: none;
  border: 1px solid var(--toolbar-border);
  border-radius: 8px;
  background: var(--panel-bg);
  box-shadow: var(--shadow-float);
  -webkit-app-region: no-drag;
}

.address-input__option {
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
  color: var(--color-text-primary);
  cursor: default;
  -webkit-app-region: no-drag;
}

.address-input__option.is-active {
  background: var(--color-current-bg);
}

.address-input__label {
  grid-area: label;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.address-input__display {
  grid-area: display;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}

.address-input__source {
  grid-area: source;
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
</style>
