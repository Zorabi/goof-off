<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { injectEpub } from '../composables/useEpub.js'
import { injectEpubCtrl } from '../composables/useEpubReaderController.js'
import { flattenToc, findActiveNode, getParentChain } from './epubTocHelpers.js'
import Icon from './icons/Icon.vue'

const { toc, book } = injectEpub()
const ctrl = injectEpubCtrl()
const { showToc, currentChapterHref, currentTocHref, guardedGoToChapter } = ctrl

const expandedNodes = ref(new Set())
const bodyRef = ref(null)

function canonical(href) {
  if (!href || !book.value) return href || ''
  try {
    return book.value.canonical(href)
  } catch {
    return href
  }
}

const flatNodes = computed(() => flattenToc(toc.value, expandedNodes.value))

function isActive(node) {
  if (!node.href) return false
  const activeHref = currentTocHref.value || currentChapterHref.value
  if (!activeHref) return false
  return canonical(node.href) === activeHref
}

function toggleExpand(id) {
  const s = new Set(expandedNodes.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  expandedNodes.value = s
}

function isExternalHref(href) {
  const value = String(href || '').trim()
  return /^\/\//.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)
}

function canNavigate(node) {
  return Boolean(node?.href) && !isExternalHref(node.href)
}

function canExpand(node) {
  return Boolean(node?.hasChildren)
}

function isDisabledNode(node) {
  return !canNavigate(node) && !canExpand(node)
}

function selectItem(item) {
  if (!canNavigate(item)) return
  const result = guardedGoToChapter(item.href)
  if (result === true) showToc.value = false
}

function expandToActive() {
  const activeHref = currentTocHref.value || currentChapterHref.value
  if (!activeHref || !toc.value.length) {
    expandedNodes.value = new Set()
    return
  }
  const activeId = findActiveNode(toc.value, activeHref, canonical)
  const parents = activeId ? getParentChain(toc.value, activeId) : []
  expandedNodes.value = new Set(parents)
}

function scrollActiveIntoView() {
  nextTick(() => {
    const activeEl = bodyRef.value?.querySelector('.toc-node.active')
    activeEl?.scrollIntoView({ block: 'center' })
  })
}

watch(showToc, (val) => {
  if (!val) return
  expandToActive()
  scrollActiveIntoView()
})

onMounted(() => {
  expandToActive()
  scrollActiveIntoView()
})
</script>

<template>
  <div ref="bodyRef" class="epub-toc-panel" data-gesture-inert>
    <div v-if="flatNodes.length === 0" class="toc-empty">暂无目录</div>
    <button
      v-for="node in flatNodes"
      :key="node.id"
      class="toc-node"
      :class="{ active: isActive(node), disabled: isDisabledNode(node) }"
      :style="{ '--toc-depth': node.depth }"
      :title="node.label"
      :data-toc-item="node.id"
      :disabled="isDisabledNode(node)"
      type="button"
      @click="selectItem(node)"
    >
      <span
        v-if="node.hasChildren"
        class="toc-arrow"
        :class="{ expanded: expandedNodes.has(node.id) }"
        :data-toc-expand="node.id"
        @click.stop="toggleExpand(node.id)"
      >
        <Icon name="chevron-right" size="12px" stroke-width="2" />
      </span>
      <span v-else class="toc-arrow-placeholder"></span>
      <span class="toc-label">{{ node.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.epub-toc-panel {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px 0;
}
.toc-empty {
  padding: 24px var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--text-body-size);
  text-align: center;
}
.toc-node {
  --toc-depth: 0;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: center;
  padding-top: var(--space-xxs);
  padding-right: var(--space-sm);
  padding-bottom: var(--space-xxs);
  padding-left: calc(var(--space-lg) + var(--toc-depth) * var(--space-xl));
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}
.toc-node:hover:not(:disabled) {
  background: var(--color-hover-bg);
}
.toc-node.active {
  border-left-color: var(--color-accent);
  background: var(--color-current-bg);
}
.toc-node.disabled {
  color: var(--color-text-muted);
  cursor: default;
}
.toc-node:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.toc-arrow,
.toc-arrow-placeholder {
  width: 24px;
  min-height: 24px;
  flex: 0 0 24px;
  margin-right: 4px;
  color: var(--color-text-secondary);
}
.toc-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--motion-micro) ease;
}
.toc-arrow.expanded {
  transform: rotate(90deg);
}
.toc-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--text-list-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .toc-arrow {
    transition: none;
  }
}
</style>
