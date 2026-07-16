<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import IconButton from '../components/base/IconButton.vue'
import { useAppState } from '../composables/useAppState.js'
import { injectFileOpenCoordinator } from '../composables/useFileOpenCoordinator.js'
import { pushStatus } from '../composables/usePageMessages.js'
import { createHistoryGroups } from './historyDisplayModel.js'

const { dispatch } = useAppState()
const fileCoordinator = injectFileOpenCoordinator()
const props = defineProps({
  initialTab: { type: String, default: 'web' }
})
const activeTab = ref(normalizeInitialTab(props.initialTab))
const web = ref([])
const files = ref([])
const loaded = ref(false)
const missingFileConfirmId = ref(null)
const clearConfirming = ref(false)
let clearConfirmTimer = null
let initializedTab = false
let unlistenHistoryChanged = null

const activeItems = computed(() => (activeTab.value === 'web' ? web.value : files.value))
const activeGroups = computed(() => createHistoryGroups(activeItems.value, activeTab.value))
const emptyText = computed(() => (activeTab.value === 'web' ? '暂无网页历史' : '暂无文件历史'))

function normalizeInitialTab(tab) {
  return tab === 'files' ? 'files' : 'web'
}

function applyHistorySnapshot(result) {
  web.value = Array.isArray(result?.web) ? result.web : []
  files.value = Array.isArray(result?.files) ? result.files : []
  clearMissingFileConfirm()
  resetClearConfirm()
}

function clearMissingFileConfirm() {
  missingFileConfirmId.value = null
}

function resetClearConfirm() {
  clearConfirming.value = false
  if (clearConfirmTimer) {
    clearTimeout(clearConfirmTimer)
    clearConfirmTimer = null
  }
}

function onPageEscape() {
  clearMissingFileConfirm()
  resetClearConfirm()
}

async function refresh() {
  try {
    const result = await window.api.historyList()
    applyHistorySnapshot(result)
    if (!initializedTab) {
      activeTab.value = normalizeInitialTab(props.initialTab)
      initializedTab = true
    }
  } catch {
    web.value = []
    files.value = []
    activeTab.value = 'web'
    pushStatus('历史记录读取失败')
  } finally {
    loaded.value = true
  }
}

async function clearCurrent() {
  if (!clearConfirming.value) {
    clearMissingFileConfirm()
    clearConfirming.value = true
    clearConfirmTimer = setTimeout(() => resetClearConfirm(), 3000)
    return
  }
  resetClearConfirm()
  try {
    clearMissingFileConfirm()
    if (activeTab.value === 'web') await window.api.historyClearWeb()
    else await window.api.historyClearFiles()
    await refresh()
  } catch {
    pushStatus('清空历史失败')
  }
}

function switchTab(tab) {
  activeTab.value = normalizeInitialTab(tab)
  clearMissingFileConfirm()
  resetClearConfirm()
}

async function removeHistoryItem(type, item) {
  if (!item?.id) return
  try {
    if (type === 'web') await window.api.historyRemoveWeb(item.id)
    else await window.api.historyRemoveFile(item.id)
    clearMissingFileConfirm()
    await refresh()
  } catch {
    pushStatus('删除历史失败')
  }
}

function isMissingConfirm(row) {
  return activeTab.value === 'files' && missingFileConfirmId.value === row.item.id
}

function openRow(row) {
  if (activeTab.value === 'web') openWeb(row.item)
  else openFile(row.item)
}

function goBack() {
  dispatch({ type: 'NAVIGATE_HOME' })
}

async function openWeb(item) {
  if (!fileCoordinator) {
    pushStatus('网页不可用')
    return
  }
  await fileCoordinator.openWebByUrl(item.url)
}

async function openFile(item) {
  if (!fileCoordinator) {
    pushStatus('文件不可用')
    return
  }
  const result = await fileCoordinator.openFileByPath(item.kind, item.path)
  if (result?.ok === false && result.reason === 'not-found') {
    missingFileConfirmId.value = item.id
    return
  }
  clearMissingFileConfirm()
}

onMounted(() => {
  refresh()
  unlistenHistoryChanged = window.api.onHistoryChanged?.((snapshot) => {
    applyHistorySnapshot(snapshot)
    loaded.value = true
  })
})

onUnmounted(() => {
  clearMissingFileConfirm()
  resetClearConfirm()
  unlistenHistoryChanged?.()
})
</script>

<template>
  <div class="history-page" @keydown.esc="onPageEscape">
    <header class="history-header">
      <button data-test="history-back" class="back" @click="goBack">返回</button>
      <div class="segmented" role="tablist">
        <span
          class="segmented-thumb"
          :class="{ 'is-files': activeTab === 'files' }"
          aria-hidden="true"
        ></span>
        <button
          data-test="history-tab-web"
          :class="['seg-opt', { active: activeTab === 'web' }]"
          role="tab"
          @click="switchTab('web')"
        >
          网页历史
        </button>
        <button
          data-test="history-tab-files"
          :class="['seg-opt', { active: activeTab === 'files' }]"
          role="tab"
          @click="switchTab('files')"
        >
          文件历史
        </button>
      </div>
      <button
        data-test="history-clear"
        :class="['clear', { 'is-confirming': clearConfirming }]"
        :disabled="!activeItems.length"
        @click="clearCurrent"
      >
        {{ clearConfirming ? '确认清空' : '清空' }}
      </button>
    </header>

    <div v-if="loaded" class="history-list" :data-history-tab="activeTab">
      <template v-if="activeGroups.length">
        <section
          v-for="group in activeGroups"
          :key="group.key"
          data-test="history-group"
          class="history-group"
        >
          <div data-test="history-group-title" class="history-group-title">{{ group.title }}</div>
          <div
            v-for="row in group.rows"
            :key="row.id"
            :data-test="activeTab === 'web' ? 'history-web-item' : 'history-file-item'"
            class="history-item"
            role="button"
            tabindex="0"
            @click="openRow(row)"
            @keydown.enter.prevent="openRow(row)"
            @keydown.space.prevent="openRow(row)"
          >
            <span
              :data-test="activeTab === 'web' ? 'history-web-marker' : 'history-file-marker'"
              :class="['history-marker', row.markerTone]"
              aria-hidden="true"
            >
              {{ row.markerLabel }}
            </span>
            <span v-if="!isMissingConfirm(row)" class="history-main">
              <span class="title">{{ row.title }}</span>
              <span class="meta">{{ row.subtitle }}</span>
            </span>
            <span
              v-if="isMissingConfirm(row)"
              data-test="history-missing-confirm"
              class="missing-confirm"
              @click.stop
              @keydown.enter.stop
              @keydown.space.stop
            >
              <span class="missing-confirm-text">文件已不存在，是否删除这条历史记录？</span>
              <span class="missing-confirm-actions">
                <button
                  data-test="history-missing-delete"
                  class="inline-confirm-button danger"
                  type="button"
                  @click.stop="removeHistoryItem('files', row.item)"
                  @keydown.enter.stop
                  @keydown.space.stop
                >
                  删除
                </button>
                <button
                  data-test="history-missing-cancel"
                  class="inline-confirm-button"
                  type="button"
                  @click.stop="clearMissingFileConfirm"
                  @keydown.enter.stop
                  @keydown.space.stop
                >
                  取消
                </button>
              </span>
            </span>
            <span v-else class="history-actions">
              <span data-test="history-row-right" class="history-right">{{ row.right }}</span>
              <IconButton
                :data-test="activeTab === 'web' ? 'history-web-delete' : 'history-file-delete'"
                class="history-delete"
                icon="close"
                icon-size="12px"
                aria-label="删除历史"
                title="删除历史"
                danger
                @click.stop="removeHistoryItem(activeTab, row.item)"
                @keydown.enter.stop
                @keydown.space.stop
              />
            </span>
          </div>
        </section>
      </template>
      <div v-else class="empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<style scoped>
.history-page {
  height: 100%;
  padding: 14px 16px 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-header {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: 56px 1fr 56px;
  align-items: center;
  gap: 8px;
}
.back,
.clear {
  min-height: 24px;
  border: 0;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 8px;
}
.back:hover,
.clear:not(:disabled):hover {
  background: var(--color-hover-bg);
  color: var(--text-primary);
}
.back:focus-visible,
.clear:focus-visible,
.history-item:focus-visible,
.history-delete:focus-visible,
.inline-confirm-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
.clear:not(:disabled):hover {
  color: var(--color-danger);
}
.clear:disabled {
  opacity: var(--opacity-disabled);
  cursor: default;
}
.history-delete {
  opacity: 0;
  transition: opacity var(--motion-micro) ease;
}
.history-item:hover .history-delete,
.history-delete:focus-visible {
  opacity: 1;
}
.clear.is-confirming {
  padding-inline: 3px;
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  color: var(--color-danger);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.clear.is-confirming:not(:disabled):hover {
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  color: var(--color-danger);
}
.segmented {
  position: relative;
  display: flex;
  background: var(--color-surface-panel);
  border-radius: 7px;
  padding: 2px;
  width: fit-content;
  margin: 0 auto;
}
.segmented-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: calc(50% - 2px);
  height: calc(100% - 4px);
  background: var(--color-segment-thumb);
  border-radius: 5px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: transform var(--motion-panel);
  transform: translateX(0);
}
.segmented-thumb.is-files {
  transform: translateX(100%);
}
:global(.dark) .segmented-thumb {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
}
.seg-opt {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 24px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  transition: color var(--motion-ui);
}
.seg-opt.active {
  color: var(--color-text-primary);
}
.seg-opt:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .segmented-thumb {
    transition: none;
  }
}
.history-list {
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-list::-webkit-scrollbar {
  display: none;
}
.history-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.history-group-title {
  height: 18px;
  line-height: 18px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  padding: 0 6px;
}
.history-item {
  width: 100%;
  height: 44px;
  min-height: 44px;
  border: 0;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  text-align: left;
}
.history-item:hover {
  background: var(--color-hover-bg);
}
.history-marker {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-badge);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 650;
  color: var(--text-primary);
  background: var(--history-marker-bg, var(--color-surface-panel));
}
.history-marker.tone-a {
  --history-marker-bg: color-mix(in srgb, var(--color-text-secondary) 16%, transparent);
}
.history-marker.tone-b {
  --history-marker-bg: color-mix(in srgb, var(--color-accent) 14%, transparent);
}
.history-marker.tone-c {
  --history-marker-bg: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
}
.history-marker.tone-d {
  --history-marker-bg: color-mix(in srgb, var(--color-danger) 10%, transparent);
}
.history-marker.tone-e {
  --history-marker-bg: color-mix(in srgb, var(--color-accent) 18%, transparent);
}
.history-marker.tone-f {
  --history-marker-bg: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
}
.history-marker.file-txt,
.history-marker.file-epub,
.history-marker.file-pdf,
.history-marker.file-unknown {
  color: var(--text-secondary);
  --history-marker-bg: var(--color-surface-panel);
}
.history-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.title {
  min-width: 0;
  font-size: 11px;
  font-weight: 500;
  line-height: 15px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-right {
  justify-self: end;
  color: var(--text-tertiary);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.history-actions {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.missing-confirm {
  grid-column: 2 / -1;
  justify-self: stretch;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.missing-confirm-text {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.missing-confirm-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.inline-confirm-button {
  min-width: 28px;
  min-height: 24px;
  border: 0;
  border-radius: var(--radius-button);
  background: var(--color-hover-bg);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  padding: 0 6px;
}
.inline-confirm-button:hover {
  color: var(--text-primary);
}
.inline-confirm-button.danger:hover {
  color: var(--color-danger);
}
.empty {
  flex: 1 1 auto;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
