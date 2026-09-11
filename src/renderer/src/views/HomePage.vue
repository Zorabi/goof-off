<script setup>
import { computed, ref, onMounted } from 'vue'
import { applySiteOrder } from '../../../shared/siteOrdering.js'
import SiteCard from '../components/SiteCard.vue'
import AddSiteDialog from '../components/AddSiteDialog.vue'
import Icon from '../components/icons/Icon.vue'
import { useSites } from '../composables/useSites.js'
import { injectFileOpenCoordinator } from '../composables/useFileOpenCoordinator.js'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import { logDiagnostic } from '../composables/useDiagnosticLog.js'
import { pushStatus } from '../composables/usePageMessages.js'
import { useTileDragSort } from '../composables/useTileDragSort.js'

const emit = defineEmits(['open-site', 'open-history'])

const ADD_SITE_DIALOG_LOCK_ID = 'content.add-site-dialog'
const { orderedSites, refresh, add, update, remove, reorder } = useSites()
const fileCoordinator = injectFileOpenCoordinator()
const chromeLocks = injectChromeLockRegistry()
const siteScrollRef = ref(null)
const siteGridRef = ref(null)

async function handleReorder(orderedIds) {
  try {
    await reorder(orderedIds)
  } catch (e) {
    pushStatus('排序保存失败')
    console.error('[HomePage] site reorder failed:', e)
  }
}

const drag = useTileDragSort({
  getContainer: () => siteGridRef.value?.$el ?? siteGridRef.value,
  getScrollContainer: () => siteScrollRef.value,
  getOrderedIds: () => orderedSites.value.map((site) => site.id),
  isBlocked: () =>
    chromeLocks.activeLocks.value.some((lock) =>
      String(lock.ownerId).startsWith('content.site-card-menu:')
    ),
  onReorder: handleReorder
})

const displaySites = computed(() =>
  drag.previewIds.value
    ? applySiteOrder(orderedSites.value, drag.previewIds.value)
    : orderedSites.value
)
const hasCommonSites = computed(() => displaySites.value.length > 0)

const dialogOpen = ref(false)
const editing = ref(null) // null = 新增；object = 编辑该站点
const submitError = ref('')
const dialogFocusTarget = ref(null)
const openingFile = ref(false)

onMounted(refresh)

function siteValidationDiagnosticUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { invalidUrl: true }
    }
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return { invalidUrl: true }
  }
}

function reportUrlValidationFailure(source, payload, error) {
  const message = `保存失败：${error?.message || '站点地址仅支持 http/https'}`
  submitError.value = message
  pushStatus(message)
  logDiagnostic('sites.url_validation_result', {
    ok: false,
    reason: 'invalid-url-scheme',
    source,
    url: siteValidationDiagnosticUrl(payload?.url)
  })
}

async function openLocalFile() {
  if (!fileCoordinator?.openAnyFileFromDialog) {
    pushStatus('文件不可用')
    return
  }
  if (openingFile.value) return
  openingFile.value = true
  try {
    await fileCoordinator.openAnyFileFromDialog()
  } catch (error) {
    console.error('[HomePage] file open failed:', error)
    pushStatus(error?.message || '文件打开失败')
  } finally {
    openingFile.value = false
  }
}

function rememberDialogFocusTarget(target) {
  if (target instanceof HTMLElement) {
    dialogFocusTarget.value = target
    return
  }
  dialogFocusTarget.value =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function onAdd() {
  rememberDialogFocusTarget()
  editing.value = null
  submitError.value = ''
  dialogOpen.value = true
}
function onEdit(site, focusTarget) {
  rememberDialogFocusTarget(focusTarget)
  editing.value = site
  submitError.value = ''
  dialogOpen.value = true
}
async function onSubmit(payload) {
  submitError.value = ''
  try {
    if (editing.value) {
      await update(editing.value.id, payload)
    } else {
      await add(payload)
    }
    chromeLocks.releaseLock(ADD_SITE_DIALOG_LOCK_ID, {
      restoreFocus: true,
      reason: 'submit-success'
    })
    dialogOpen.value = false
  } catch (e) {
    if (e?.reason === 'invalid-url-scheme') {
      reportUrlValidationFailure(editing.value ? 'update' : 'add', payload, e)
    } else {
      submitError.value = `保存失败：${e?.message || e}`
      console.error('[HomePage] site save failed:', e)
    }
  }
}
function onCancel() {
  dialogOpen.value = false
  submitError.value = ''
}
async function onRemove(site) {
  try {
    await remove(site.id)
  } catch (e) {
    const message = `删除失败：${e?.message || e}`
    pushStatus(message)
    console.error('[HomePage] site remove failed:', e)
  }
}
</script>

<template>
  <div class="home">
    <div class="home-main">
      <div class="home-logo caption">GOOF · OFF</div>
      <button data-test="history-card" class="history-card" @click="emit('open-history')">
        <span class="history-card-marker"
          ><Icon name="history" size="14px" stroke-width="2"
        /></span>
        <span class="history-card-text">
          <span class="history-card-title">历史</span>
          <span class="history-card-sub">网页 · 文件历史</span>
        </span>
        <Icon name="chevron-right" class="history-card-arrow" size="14px" stroke-width="2" />
      </button>
      <div class="section-title caption">常用站点</div>
      <div ref="siteScrollRef" class="site-scroll">
        <TransitionGroup
          v-if="hasCommonSites"
          ref="siteGridRef"
          tag="div"
          data-test="common-site-grid"
          class="site-grid"
          move-class="tile-move"
          @pointerdown="drag.onPointerdown"
          @click.capture="drag.onClickCapture"
          @contextmenu.capture="drag.onContextmenuCapture"
        >
          <SiteCard
            v-for="site in displaySites"
            :key="`${site.source}:${site.id}`"
            :data-site-id="site.id"
            :class="{ 'is-drag-source': drag.draggingId.value === site.id }"
            :name="site.name"
            :removable="site.source === 'custom' || site.source === 'preset'"
            :lock-owner-id="`content.site-card-menu:${site.source}:${site.id}`"
            @click="emit('open-site', site.url)"
            @edit="(event) => onEdit(site, event?.focusTarget)"
            @remove="onRemove(site)"
          />
          <button
            key="add-site-tile"
            data-test="add-site-tile"
            class="add-site-tile"
            aria-label="添加站点"
            @click="onAdd"
          >
            + 添加
          </button>
        </TransitionGroup>
        <div v-else class="site-empty">
          <button data-test="add-site-empty" type="button" @click="onAdd">添加常用站点</button>
          <span>，或拖入文件</span>
        </div>
      </div>
      <div data-test="file-drop-stage" class="file-drop-stage">
        <div class="drag-hint">
          拖入文件，或
          <button
            data-test="open-local-file"
            class="open-local-link"
            :disabled="openingFile"
            :aria-busy="openingFile ? 'true' : undefined"
            @click="openLocalFile"
          >
            {{ openingFile ? '打开中…' : '点此打开' }}
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <AddSiteDialog
        v-if="dialogOpen"
        :initial="editing"
        :external-error="submitError"
        :focus-restore-target="dialogFocusTarget"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  overflow: hidden;
}
.home-main {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 10px;
  gap: 10px;
}
.home-logo.caption {
  font-size: 9px;
  letter-spacing: 0.36em;
  font-weight: 600;
  text-align: center;
  color: var(--color-logo);
  margin: 2px 0 14px;
  padding-left: 0.36em;
  flex: 0 0 auto;
}
.history-card {
  flex: 0 0 auto;
  width: 100%;
  height: 40px;
  border: 0;
  border-radius: var(--radius-row);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  text-align: left;
  transition: background var(--motion-micro) ease;
  -webkit-app-region: no-drag;
}
.history-card:hover,
.history-card:focus-visible {
  background: var(--color-hover-bg);
}
.history-card:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
.history-card-marker {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--color-active-icon-bg);
  color: var(--color-text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.history-card-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.history-card-title {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--color-text-primary);
}
.history-card-sub {
  font-size: 10px;
  line-height: 1.2;
  margin-top: 1px;
  color: var(--color-text-muted);
}
.history-card-arrow {
  margin-left: auto;
  color: var(--color-text-muted);
}
.section-title.caption {
  flex: 0 0 auto;
  font-size: 9px;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--color-text-muted);
  height: 18px;
  line-height: 18px;
}
.site-scroll {
  position: relative;
  flex: 0 1 auto;
  min-height: 120px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  container-type: inline-size;
}
.site-scroll::-webkit-scrollbar {
  display: none;
}
.site-scroll::after {
  content: '';
  pointer-events: none;
  position: sticky;
  display: block;
  left: 0;
  right: 0;
  bottom: 0;
  height: 26px;
  background: linear-gradient(to bottom, transparent, var(--effective-shell-bg));
}
.site-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-tile-gap);
}
.tile-move {
  transition: transform var(--motion-micro) ease;
}
.site-grid :deep(.is-drag-source) {
  opacity: 0.35;
}
.add-site-tile {
  width: 100%;
  height: 38px;
  border: 0;
  border-radius: var(--radius-tile);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 11px;
  text-align: center;
  padding: 0 4px;
  transition: background var(--motion-micro) ease;
}
.add-site-tile:hover,
.add-site-tile:focus-visible {
  background: var(--color-hover-bg);
}
.add-site-tile:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
.site-empty {
  min-height: 85px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.site-empty button {
  border: 0;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
  padding: 0;
  font: inherit;
}
.site-empty button:hover,
.site-empty button:focus-visible {
  text-decoration: underline;
}
.file-drop-stage {
  flex: 1 1 auto;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.drag-hint {
  line-height: 22px;
  font-size: 10px;
  text-align: center;
  color: var(--color-text-muted);
}
.open-local-link {
  font: inherit;
  color: var(--color-text-secondary);
  text-decoration: underline;
  text-underline-offset: 2px;
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.open-local-link:hover,
.open-local-link:focus-visible {
  color: var(--color-text-primary);
}
.open-local-link:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
.open-local-link:disabled {
  cursor: progress;
  opacity: var(--opacity-disabled);
}
@container (max-width: 327px) {
  .site-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
