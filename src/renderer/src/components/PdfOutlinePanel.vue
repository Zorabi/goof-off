<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { injectPdf } from '../composables/usePdf.js'
import {
  flattenPdfOutlineTree,
  selectPdfOutlineCurrentItem
} from '../composables/pdfOutlineModel.js'
import Icon from './icons/Icon.vue'

const pdf = injectPdf()
const emit = defineEmits(['close'])
const expandedNodes = ref(new Set())
const bodyRef = ref(null)

const visibleNodes = computed(() =>
  flattenPdfOutlineTree(pdf?.outlineItems?.value || [], expandedNodes.value)
)
const currentNode = computed(() =>
  selectPdfOutlineCurrentItem(pdf?.outlineItems?.value || [], pdf?.currentPage?.value || 1)
)
const currentNodeId = computed(() => currentNode.value?.id || '')

function ancestorIds(id) {
  if (!id) return []
  const parts = id.split('-')
  const ids = []
  for (let index = 1; index < parts.length; index += 1) {
    ids.push(parts.slice(0, index).join('-'))
  }
  return ids
}

function toggleExpand(id) {
  const next = new Set(expandedNodes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedNodes.value = next
}

function selectItem(node) {
  if (node.disabled || !node.page) return
  window.dispatchEvent(new CustomEvent('pdf:go-to-page', { detail: node.page }))
  emit('close')
}

function handleNodeKeydown(node, event) {
  if (node.disabled || node.page || !node.children.length) return
  event.preventDefault()
  toggleExpand(node.id)
}

function revealCurrentItem({ scroll = false } = {}) {
  const id = currentNodeId.value
  if (!id) return
  const next = new Set(expandedNodes.value)
  for (const ancestorId of ancestorIds(id)) next.add(ancestorId)
  expandedNodes.value = next
  if (!scroll) return

  nextTick(() => {
    const scrollIntoViewCurrent = () => {
      bodyRef.value?.querySelector(`[data-outline-item="${CSS.escape(id)}"]`)?.scrollIntoView({
        block: 'center',
        inline: 'nearest'
      })
    }
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(scrollIntoViewCurrent)
      return
    }
    window.setTimeout(scrollIntoViewCurrent, 0)
  })
}

onMounted(() => revealCurrentItem({ scroll: true }))
watch(
  () => pdf?.outlineItems?.value,
  () => revealCurrentItem({ scroll: true })
)
watch(currentNodeId, () => revealCurrentItem())
</script>

<template>
  <div ref="bodyRef" class="pdf-outline-panel" data-gesture-inert>
    <div v-if="pdf.outlineLoading.value" class="outline-empty">目录加载中...</div>
    <div v-else-if="pdf.outlineError.value" class="outline-empty">{{ pdf.outlineError.value }}</div>
    <div v-else-if="visibleNodes.length === 0" class="outline-empty">暂无目录</div>
    <template v-else>
      <button
        v-for="node in visibleNodes"
        :key="node.id"
        class="outline-node"
        :class="{ disabled: node.disabled, current: currentNodeId === node.id }"
        :style="{ '--toc-depth': node.depth }"
        :data-outline-item="node.id"
        :data-outline-current="currentNodeId === node.id ? 'true' : undefined"
        :disabled="node.disabled"
        :title="node.disabledReason || node.title"
        :aria-current="currentNodeId === node.id ? 'location' : undefined"
        :aria-expanded="node.children.length ? String(expandedNodes.has(node.id)) : undefined"
        type="button"
        @click="selectItem(node)"
        @keydown.enter="handleNodeKeydown(node, $event)"
        @keydown.space="handleNodeKeydown(node, $event)"
      >
        <span
          v-if="node.children.length"
          class="outline-arrow"
          :class="{ expanded: expandedNodes.has(node.id) }"
          :data-outline-expand="node.id"
          @click.stop="toggleExpand(node.id)"
        >
          <Icon name="chevron-right" size="12px" stroke-width="2" />
        </span>
        <span v-else class="outline-arrow-placeholder"></span>
        <span class="outline-title">{{ node.title }}</span>
        <span v-if="node.page" class="outline-page">p.{{ node.page }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.pdf-outline-panel {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px 0;
}
.outline-empty {
  padding: 24px var(--space-sm);
  color: var(--color-text-muted);
  font-size: var(--text-body-size);
  text-align: center;
}
.outline-node {
  --toc-depth: 0;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: center;
  gap: var(--space-xs);
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
.outline-node:hover:not(:disabled) {
  background: var(--color-hover-bg);
}
.outline-node.current {
  border-left-color: var(--color-accent);
  background: var(--color-current-bg);
  color: var(--color-text-primary);
}
.outline-node:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.outline-node.disabled {
  color: var(--color-text-muted);
  cursor: default;
}
.outline-arrow,
.outline-arrow-placeholder {
  width: 24px;
  min-height: 24px;
  flex: 0 0 24px;
  color: var(--color-text-secondary);
}
.outline-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--motion-micro) ease;
}
.outline-arrow.expanded {
  transform: rotate(90deg);
}
.outline-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: var(--text-list-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outline-page {
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
}
@media (prefers-reduced-motion: reduce) {
  .outline-arrow {
    transition: none;
  }
}
</style>
