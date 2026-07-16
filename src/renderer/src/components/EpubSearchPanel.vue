<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { injectEpubSearch } from '../composables/useEpubSearch.js'

const search = injectEpubSearch()
const emit = defineEmits(['close'])
const inputRef = ref(null)
const listRef = ref(null)
const visibleCount = ref(100)
const beforeLoadRetryBlocked = ref(false)
const afterLoadRetryBlocked = ref(false)
const lastScrollTop = ref(0)
const lastScrollLeft = ref(0)
const itemRefs = new Map()

const effectiveVisibleCount = computed(() => {
  const current = search.currentHitIndex.value
  return Math.min(
    search.results.value.length,
    Math.max(visibleCount.value, current >= 0 ? current + 30 : 100)
  )
})
const visibleResults = computed(() =>
  search.results.value.slice(0, effectiveVisibleCount.value).map((hit, index) => ({ hit, index }))
)
const allResultEntries = computed(() => search.results.value.map((hit, index) => ({ hit, index })))
const groupedResults = computed(() => groupResults(visibleResults.value))
const totalGroupCount = computed(() => groupResults(allResultEntries.value).length)
const countLabel = computed(() => {
  if (!search.query.value || !search.hitCount.value) return ''
  const total = search.truncated.value ? `${search.hitCount.value}+` : String(search.hitCount.value)
  if (search.currentHitIndex.value < 0) return total
  return `${search.currentHitIndex.value + 1}/${total}`
})
const summaryLabel = computed(() => {
  if (!search.query.value || !search.hitCount.value) return ''
  const parts = [
    search.truncated.value ? `${search.hitCount.value}+ 处结果` : `${search.hitCount.value} 处结果`,
    `${totalGroupCount.value} 章`
  ]
  if (search.truncated.value) parts.push('已加载当前位置附近')
  return parts.join(' · ')
})

function groupResults(resultEntries) {
  const groups = []
  const groupByChapter = new Map()
  resultEntries.forEach(({ hit, index }) => {
    const label = hit.chapterLabel || '未知章节'
    const key = Number.isInteger(hit.spineIndex)
      ? `spine:${hit.spineIndex}`
      : `fallback:${hit.resultKey || hit.cfi || index}`
    let group = groupByChapter.get(key)
    if (!group) {
      group = { key, label, items: [] }
      groupByChapter.set(key, group)
      groups.push(group)
    }
    group.items.push({ hit, index })
  })
  return groups
}

function onInput(event) {
  search.setQuery(event.target.value)
  visibleCount.value = 100
  resetBoundaryRetryBlocked()
}

async function onKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (event.shiftKey) await search.prevHit()
    else await search.nextHit()
  }
}

function onScroll(event) {
  const el = event.currentTarget
  const verticalChanged = el.scrollTop !== lastScrollTop.value
  const horizontalChanged = el.scrollLeft !== lastScrollLeft.value
  lastScrollTop.value = el.scrollTop
  lastScrollLeft.value = el.scrollLeft
  if (horizontalChanged && !verticalChanged) return

  const nearBefore = el.scrollTop <= 160
  const nearAfter = el.scrollTop + el.clientHeight >= el.scrollHeight - 160
  if (!nearBefore) beforeLoadRetryBlocked.value = false
  if (!nearAfter) afterLoadRetryBlocked.value = false

  if (
    nearBefore &&
    search.hasBefore.value &&
    !search.loadingBefore.value &&
    !beforeLoadRetryBlocked.value
  ) {
    const renderedBefore = effectiveVisibleCount.value
    const beforeHeight = el.scrollHeight
    search.loadBefore().then((result) => {
      if (!result?.ok) {
        if (search.loadBeforeFailed.value) beforeLoadRetryBlocked.value = true
        return
      }
      if (!result.addedCount) return
      visibleCount.value = Math.min(search.results.value.length, renderedBefore + result.addedCount)
      nextTick(() => {
        el.scrollTop += el.scrollHeight - beforeHeight
      })
    })
  }
  if (nearAfter) {
    const renderedCount = effectiveVisibleCount.value
    if (renderedCount < search.results.value.length) {
      visibleCount.value = Math.min(search.results.value.length, renderedCount + 100)
      return
    }
    if (search.hasAfter.value && !search.loadingAfter.value && !afterLoadRetryBlocked.value) {
      search.loadAfter().then((result) => {
        if (!result?.ok) {
          if (search.loadAfterFailed.value) afterLoadRetryBlocked.value = true
          return
        }
        if (!result.addedCount) return
        visibleCount.value = Math.min(
          search.results.value.length,
          renderedCount + result.addedCount
        )
      })
    }
  }
}

async function onHitClick(index) {
  if (await search.goToHit(index)) emit('close')
}

function setItemRef(index, el) {
  if (el) itemRefs.set(index, el)
  else itemRefs.delete(index)
}

function scrollCurrentIntoView() {
  const el = itemRefs.get(search.currentHitIndex.value)
  el?.scrollIntoView?.({ block: 'nearest' })
  inputRef.value?.focus()
}

function resultWindowKey(hit) {
  return hit?.resultKey || hit?.cfi || null
}

function resetBoundaryRetryBlocked() {
  beforeLoadRetryBlocked.value = false
  afterLoadRetryBlocked.value = false
}

watch(
  () => search.navigationIntent.value,
  (intent) => {
    if (!intent || intent.reason === 'index-shift' || intent.reason === 'none') return
    visibleCount.value = Math.max(visibleCount.value, search.currentHitIndex.value + 30)
    nextTick(scrollCurrentIntoView)
  },
  { deep: true, immediate: true }
)

watch(
  () => [
    search.query.value,
    resultWindowKey(search.results.value[0]),
    resultWindowKey(search.results.value.at(-1)),
    search.hasBefore.value,
    search.hasAfter.value,
    search.navigationIntent.value?.id ?? 0,
    search.navigationIntent.value?.reason ?? 'none'
  ],
  resetBoundaryRetryBlocked,
  { flush: 'sync' }
)

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})
</script>

<template>
  <div class="epub-search-panel" data-gesture-inert>
    <div ref="listRef" class="search-list" @scroll.passive="onScroll">
      <div v-if="search.loadingBefore.value" class="search-loading">正在加载更早结果…</div>
      <div v-if="search.loadBeforeFailed.value" class="search-loading">更早结果加载失败</div>
      <div
        v-if="search.query.value && !search.searching.value && search.hitCount.value === 0"
        class="search-empty"
      >
        无结果
      </div>
      <div v-for="group in groupedResults" :key="group.key" class="search-group">
        <div class="search-group-title">{{ group.label }}</div>
        <button
          v-for="item in group.items"
          :key="item.hit.resultKey || item.hit.cfi || item.index"
          :ref="(el) => setItemRef(item.index, el)"
          class="search-item"
          :class="{ active: search.currentHitIndex.value === item.index }"
          type="button"
          @click="onHitClick(item.index)"
        >
          <span class="search-snippet">
            <span class="search-snippet-context search-snippet-before">
              {{ item.hit.snippet.before }}
            </span>
            <mark class="search-snippet-match">{{ item.hit.snippet.match }}</mark>
            <span class="search-snippet-context search-snippet-after">
              {{ item.hit.snippet.after }}
            </span>
          </span>
        </button>
      </div>
      <div v-if="search.query.value && search.searching.value" class="search-loading">
        正在搜索…
      </div>
      <div v-if="search.loadingAfter.value" class="search-loading">正在加载更晚结果…</div>
      <div v-if="search.loadAfterFailed.value" class="search-loading">更晚结果加载失败</div>
    </div>
    <div class="search-foot">
      <div v-if="summaryLabel" class="search-summary">{{ summaryLabel }}</div>
      <div class="search-input-row">
        <input
          ref="inputRef"
          class="search-input"
          :value="search.query.value"
          placeholder="搜索全书"
          @input="onInput"
          @keydown="onKeydown"
        />
        <span class="search-count">{{ countLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.epub-search-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.search-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: var(--space-xs) 0;
}
.search-group,
.search-empty,
.search-loading {
  box-sizing: border-box;
  max-width: 720px;
  margin-inline: auto;
}
.search-group + .search-group {
  margin-top: var(--space-xs);
}
.search-group-title {
  position: sticky;
  top: 0;
  overflow: hidden;
  padding: 4px var(--space-lg);
  background: var(--panel-bg);
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-empty,
.search-loading {
  padding: 24px var(--space-lg);
  color: var(--color-text-secondary);
  font-size: var(--text-body-size);
  text-align: center;
}
.search-item {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 32px;
  padding: 6px var(--space-lg);
  border: none;
  border-left: 2px solid transparent;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  font: inherit;
  scroll-margin-top: 24px;
  text-align: left;
}
.search-item:hover {
  background: var(--color-hover-bg);
}
.search-item.active {
  border-left-color: var(--color-accent);
  background: var(--color-current-bg);
}
.search-item:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
.search-snippet {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: var(--text-body-size);
  line-height: 1.6;
  word-break: break-all;
}
.search-snippet-match {
  background: var(--color-current-bg);
  color: var(--color-accent);
}
.search-foot {
  flex: 0 0 auto;
  border-top: 1px solid var(--color-divider);
}
.search-summary {
  overflow: hidden;
  padding: 4px var(--space-lg) 0;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-input-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
}
.search-input {
  flex: 1;
  min-width: 0;
  height: var(--hit-min);
  padding: 0 var(--space-sm);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-button);
  background: var(--panel-bg);
  color: var(--color-text-primary);
  font-size: var(--text-body-size);
  outline: none;
}
.search-input:focus {
  border-color: var(--color-accent);
  outline: var(--focus-ring-input);
  outline-offset: 1px;
}
.search-count {
  min-width: 44px;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  font-variant-numeric: var(--text-readout-variant);
  text-align: right;
}
</style>
