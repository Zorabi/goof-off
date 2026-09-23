<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import IconButton from './base/IconButton.vue'
import Icon from './icons/Icon.vue'
import {
  buildTocNodes,
  findCurrentTocNodeId,
  getAncestorIds,
  getVisibleTocNodes
} from './txtTocTree.js'
import { injectTxt } from '../composables/useTxt.js'
import { injectTxtReaderController } from '../composables/useTxtReaderController.js'

const txt = injectTxt()
const ctrl = injectTxtReaderController()
const panelRef = ref(null)
const expandedIds = ref(new Set())

const tocNodes = computed(() => buildTocNodes(txt.chapters.value))
const currentChapterId = computed(() => findCurrentTocNodeId(txt.chapters.value, txt.offset.value))
const visibleNodes = computed(() => getVisibleTocNodes(tocNodes.value, expandedIds.value))

function isExpanded(node) {
  return expandedIds.value.has(node.id)
}

function syncCurrentExpanded() {
  const next = new Set(expandedIds.value)
  for (const id of getAncestorIds(tocNodes.value, currentChapterId.value)) {
    next.add(id)
  }
  expandedIds.value = next
}

function toggleNode(node) {
  const next = new Set(expandedIds.value)
  if (next.has(node.id)) next.delete(node.id)
  else next.add(node.id)
  expandedIds.value = next
}

function onJump(chapter) {
  ctrl.scrollToOffset(chapter.charOffset, 0)
  ctrl.closeToc()
}

function onRemove(chapter) {
  txt.removeChapter(chapter.id)
}

async function scrollCurrentChapterIntoView() {
  await nextTick()
  panelRef.value?.querySelector('.toc-item.active')?.scrollIntoView({
    block: 'center',
    inline: 'nearest'
  })
}

function percent(charOffset) {
  const total = txt.text.value.length
  if (!total) return '0%'
  return Math.round((charOffset / total) * 100) + '%'
}

onMounted(() => {
  syncCurrentExpanded()
  scrollCurrentChapterIntoView()
})

watch(
  () => [txt.chapters.value, currentChapterId.value],
  () => {
    syncCurrentExpanded()
    scrollCurrentChapterIntoView()
  },
  { deep: true }
)
</script>

<template>
  <div ref="panelRef" class="txt-toc-panel" data-gesture-inert>
    <div v-if="txt.chapters.value.length === 0" class="toc-empty">未识别到章节</div>
    <div v-else class="toc-list">
      <div
        v-for="node in visibleNodes"
        :key="node.id"
        class="toc-item"
        :class="{ active: currentChapterId === node.id }"
        :data-toc-id="node.id"
        :data-depth="node.depth"
        :style="{ '--toc-depth': node.depth }"
      >
        <button
          v-if="node.hasChildren"
          type="button"
          class="toc-toggle"
          :aria-label="isExpanded(node) ? '折叠章节' : '展开章节'"
          :aria-expanded="String(isExpanded(node))"
          @click.stop="toggleNode(node)"
          @keydown.enter.prevent.stop="toggleNode(node)"
          @keydown.space.prevent.stop="toggleNode(node)"
        >
          <Icon name="chevron-right" size="var(--icon-size-mini)" />
        </button>
        <span v-else class="toc-toggle-spacer" aria-hidden="true"></span>
        <button
          type="button"
          class="toc-main"
          :title="node.title"
          :aria-label="node.title"
          :aria-current="currentChapterId === node.id ? 'location' : undefined"
          @click="onJump(node)"
          @keydown.enter.prevent.stop="onJump(node)"
          @keydown.space.prevent.stop="onJump(node)"
        >
          <span class="toc-title">{{ node.title }}</span>
          <span class="toc-percent">{{ percent(node.charOffset) }}</span>
        </button>
        <IconButton
          class="toc-remove"
          icon="close"
          aria-label="删除章节"
          title="删除章节"
          @click.stop="onRemove(node)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.txt-toc-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  color: var(--color-text-primary);
}

.toc-empty {
  padding: var(--space-xl) var(--space-md);
  color: var(--color-text-muted);
  font-size: var(--text-body-size);
  text-align: center;
}

.toc-list {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) 0;
}

.toc-item {
  --toc-depth: 0;
  box-sizing: border-box;
  display: flex;
  width: 100%;
  min-height: 28px;
  align-items: flex-start;
  gap: var(--space-xxs);
  padding: var(--space-xxs) var(--space-sm);
  padding-left: calc(var(--space-lg) + var(--toc-depth) * var(--space-xl));
  border-left: 2px solid transparent;
}

.toc-item:hover {
  background: var(--color-hover-bg);
}

.toc-item.active {
  border-left-color: var(--color-accent);
  background: var(--color-current-bg);
}

.toc-toggle,
.toc-toggle-spacer {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
}

.toc-toggle {
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.toc-toggle[aria-expanded='true'] {
  color: var(--color-text-primary);
}

.toc-toggle[aria-expanded='true'] :deep(svg) {
  transform: rotate(90deg);
}

.toc-toggle:hover {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
}

.toc-toggle:focus-visible,
.toc-main:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

.toc-main {
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.toc-title {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--color-text-primary);
  font-size: var(--text-list-size);
  line-height: 1.35;
  white-space: normal;
}

.toc-percent {
  align-self: flex-start;
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--color-text-secondary);
  font-size: var(--text-readout-size);
  font-variant-numeric: var(--text-readout-variant);
}

.toc-remove {
  align-self: flex-start;
  flex: 0 0 auto;
  margin-left: var(--space-xxs);
  opacity: 0;
  visibility: hidden;
}

.toc-item:hover .toc-remove,
.toc-item:focus-within .toc-remove {
  opacity: 1;
  visibility: visible;
}

@media (prefers-reduced-motion: no-preference) {
  .toc-toggle :deep(svg) {
    transition: transform var(--motion-micro) ease;
  }
}
</style>
