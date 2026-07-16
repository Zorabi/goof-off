<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import PrefsActionText from './base/PrefsActionText.vue'

const startupPrefs = ref({ restoreShellState: true })
const historyPrefs = ref({ recordWeb: true, recordFiles: true })
const diagnosticPrefs = ref({ enabled: true })
const systemPrefs = ref({ showInTaskbarOrDock: true })
const feedback = ref({})
const activeConfirm = ref('')
const maintenanceBusy = ref(false)
let unlistenStartup = null
let unlistenHistory = null
let unlistenDiagnostic = null
let unlistenSystem = null

const CONFIRM_HINT = '再点一次确认，3 秒后取消'

function setFeedback(row, kind, text) {
  feedback.value = { ...feedback.value, [row]: { kind, text } }
}

function setConfirming(row, value) {
  activeConfirm.value = value ? row : activeConfirm.value === row ? '' : activeConfirm.value
}

onMounted(async () => {
  startupPrefs.value = await window.api.startupPrefsGet()
  historyPrefs.value = await window.api.historyPrefsGet()
  diagnosticPrefs.value = await window.api.diagnosticPrefsGet()
  systemPrefs.value = await window.api.systemPrefsGet()
  unlistenStartup = window.api.onStartupPrefsChange?.((next) => {
    startupPrefs.value = next
  })
  unlistenHistory = window.api.onHistoryPrefsChange?.((next) => {
    historyPrefs.value = next
  })
  unlistenDiagnostic = window.api.onDiagnosticPrefsChange?.((next) => {
    diagnosticPrefs.value = next
  })
  unlistenSystem = window.api.onSystemPrefsChange?.((next) => {
    systemPrefs.value = next
  })
})

onUnmounted(() => {
  unlistenStartup?.()
  unlistenHistory?.()
  unlistenDiagnostic?.()
  unlistenSystem?.()
  unlistenSystem = null
})

async function setStartupPatch(patch) {
  startupPrefs.value = await window.api.startupPrefsSet(patch)
}

async function setHistoryPatch(patch) {
  historyPrefs.value = await window.api.historyPrefsSet(patch)
}

async function setDiagnosticEnabled(enabled) {
  diagnosticPrefs.value = await window.api.diagnosticPrefsSet({ enabled })
  setFeedback('diagnostic', 'success', enabled ? '已启用诊断日志' : '已停用诊断日志')
}

async function setSystemVisibility(enabled) {
  const previous = systemPrefs.value
  systemPrefs.value = { showInTaskbarOrDock: enabled }
  const next = await window.api.systemPrefsSet({ showInTaskbarOrDock: enabled })
  const normalized = {
    showInTaskbarOrDock:
      typeof next?.showInTaskbarOrDock === 'boolean'
        ? next.showInTaskbarOrDock
        : previous.showInTaskbarOrDock
  }
  systemPrefs.value = normalized
  if (normalized.showInTaskbarOrDock === enabled) {
    setFeedback(
      'visibility',
      'success',
      enabled ? '已显示任务栏 / Dock 图标' : '已隐藏任务栏 / Dock 图标'
    )
  } else {
    setFeedback('visibility', 'error', '任务栏 / Dock 图标状态未更改')
  }
}

async function clearWebHistory() {
  await window.api.historyClearWeb()
  setFeedback('historyWeb', 'success', '已清空网页历史')
}

async function clearFileHistory() {
  await window.api.historyClearFiles()
  setFeedback('historyFiles', 'success', '已清空文件历史')
}

function summarizeImport(result) {
  const parts = []
  if (result.invalidFields?.length) parts.push(`忽略非法字段 ${result.invalidFields.length} 个`)
  if (result.ignoredFields?.length) parts.push(`忽略未知字段 ${result.ignoredFields.length} 个`)
  if (result.bossKeyFailures?.length)
    parts.push(`Boss Key 冲突 ${result.bossKeyFailures.length} 个`)
  return parts.length ? `已导入配置，${parts.join('，')}` : '已导入配置'
}

async function exportPrefs() {
  const result = await window.api.preferencesExport()
  if (result?.reason === 'cancelled') return
  if (result?.ok) setFeedback('config', 'success', '已导出配置')
  else setFeedback('config', 'error', result?.message || '导出失败')
}

async function importPrefs() {
  const result = await window.api.preferencesImport()
  if (result?.reason === 'cancelled') return
  if (result?.ok) setFeedback('config', 'success', summarizeImport(result))
  else setFeedback('config', 'error', result?.message || '导入失败')
}

async function resetDefaults() {
  const result = await window.api.preferencesResetDefaults()
  if (result?.ok) {
    const failures = result.bossKeyFailures?.length || 0
    setFeedback(
      'reset',
      'success',
      failures ? `已恢复默认，Boss Key 冲突 ${failures} 个` : '已恢复默认'
    )
  } else {
    setFeedback('reset', 'error', result?.message || '恢复默认失败')
  }
}

async function clearAppCache() {
  if (maintenanceBusy.value) return
  maintenanceBusy.value = true
  try {
    const result = await window.api.appCacheClear()
    setFeedback(
      'cache',
      result?.ok ? 'success' : 'error',
      result?.ok ? '已清空应用缓存' : '缓存已部分清理'
    )
  } catch (error) {
    setFeedback('cache', 'error', error?.message || '清空缓存失败')
  } finally {
    maintenanceBusy.value = false
  }
}

async function initializeApp() {
  if (maintenanceBusy.value) return
  maintenanceBusy.value = true
  try {
    const result = await window.api.appInitialize()
    setFeedback(
      'initialize',
      result?.ok ? 'success' : 'error',
      result?.ok ? '已完成应用初始化' : '初始化部分失败'
    )
  } catch (error) {
    setFeedback('initialize', 'error', error?.message || '初始化失败')
  } finally {
    maintenanceBusy.value = false
  }
}
</script>

<template>
  <section class="prefs-sect">
    <div class="prefs-secthead">启动</div>
    <label class="prefs-line">
      <span class="prefs-line__label">启动时恢复上次阅读</span>
      <input
        data-test="startup-restore"
        type="checkbox"
        :checked="startupPrefs.restoreShellState"
        @change="setStartupPatch({ restoreShellState: $event.target.checked })"
      />
    </label>
  </section>

  <section class="prefs-sect">
    <div class="prefs-secthead">历史</div>
    <label class="prefs-line">
      <span class="prefs-line__label">记录网页历史</span>
      <input
        data-test="history-record-web"
        type="checkbox"
        :checked="historyPrefs.recordWeb"
        @change="setHistoryPatch({ recordWeb: $event.target.checked })"
      />
    </label>
    <label class="prefs-line">
      <span class="prefs-line__label">记录文件历史</span>
      <input
        data-test="history-record-files"
        type="checkbox"
        :checked="historyPrefs.recordFiles"
        @change="setHistoryPatch({ recordFiles: $event.target.checked })"
      />
    </label>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">网页历史</div>
        <div
          v-if="feedback.historyWeb"
          class="prefs-line__hint"
          :class="feedback.historyWeb.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.historyWeb.text }}
        </div>
      </div>
      <PrefsActionText label="清空" data-test="history-clear-web" @confirm="clearWebHistory" />
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">文件历史</div>
        <div
          v-if="feedback.historyFiles"
          class="prefs-line__hint"
          :class="feedback.historyFiles.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.historyFiles.text }}
        </div>
      </div>
      <PrefsActionText label="清空" data-test="history-clear-files" @confirm="clearFileHistory" />
    </div>
  </section>

  <section class="prefs-sect">
    <div class="prefs-secthead">系统</div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <label class="prefs-line__label" for="system-visibility">在任务栏 / Dock 中显示</label>
        <div
          v-if="feedback.visibility"
          class="prefs-line__hint"
          :class="feedback.visibility.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.visibility.text }}
        </div>
      </div>
      <input
        id="system-visibility"
        data-test="system-show-in-taskbar-or-dock"
        type="checkbox"
        :checked="systemPrefs.showInTaskbarOrDock"
        :disabled="maintenanceBusy"
        @change="setSystemVisibility($event.target.checked)"
      />
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <label class="prefs-line__label" for="diagnostic-enabled">诊断日志</label>
        <div v-if="feedback.diagnostic" class="prefs-line__hint is-success">
          {{ feedback.diagnostic.text }}
        </div>
      </div>
      <input
        id="diagnostic-enabled"
        data-test="diagnostic-enabled"
        type="checkbox"
        :checked="diagnosticPrefs.enabled"
        :disabled="maintenanceBusy"
        @change="setDiagnosticEnabled($event.target.checked)"
      />
    </div>
  </section>

  <section class="prefs-sect">
    <div class="prefs-secthead">维护</div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">应用缓存</div>
        <div v-if="activeConfirm === 'cache'" class="prefs-line__hint is-danger">
          {{ CONFIRM_HINT }}
        </div>
        <div
          v-else-if="feedback.cache"
          class="prefs-line__hint"
          :class="feedback.cache.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.cache.text }}
        </div>
      </div>
      <PrefsActionText
        label="清空…"
        confirm-label="确认清空"
        danger
        data-test="cache-clear"
        :disabled="maintenanceBusy"
        :confirming="activeConfirm === 'cache'"
        @update:confirming="setConfirming('cache', $event)"
        @confirm="clearAppCache"
      />
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">应用初始化</div>
        <div v-if="activeConfirm === 'initialize'" class="prefs-line__hint is-danger">
          {{ CONFIRM_HINT }}
        </div>
        <div
          v-else-if="feedback.initialize"
          class="prefs-line__hint"
          :class="feedback.initialize.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.initialize.text }}
        </div>
        <div v-else class="prefs-line__hint">恢复默认配置、历史与窗口位置</div>
      </div>
      <PrefsActionText
        label="初始化…"
        confirm-label="确认初始化"
        danger
        data-test="app-initialize"
        :disabled="maintenanceBusy"
        :confirming="activeConfirm === 'initialize'"
        @update:confirming="setConfirming('initialize', $event)"
        @confirm="initializeApp"
      />
    </div>
  </section>

  <section class="prefs-sect">
    <div class="prefs-secthead">配置</div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">配置文件</div>
        <div
          v-if="feedback.config"
          class="prefs-line__hint"
          :class="feedback.config.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.config.text }}
        </div>
      </div>
      <span class="prefs-line__actions" style="gap: 14px">
        <PrefsActionText label="导出…" data-test="prefs-export" @confirm="exportPrefs" />
        <PrefsActionText label="导入…" data-test="prefs-import" @confirm="importPrefs" />
      </span>
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <div class="prefs-line__label">恢复默认设置</div>
        <div v-if="activeConfirm === 'reset'" class="prefs-line__hint is-danger">
          {{ CONFIRM_HINT }}
        </div>
        <div
          v-else-if="feedback.reset"
          class="prefs-line__hint"
          :class="feedback.reset.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.reset.text }}
        </div>
      </div>
      <PrefsActionText
        label="恢复…"
        confirm-label="确认恢复"
        danger
        data-test="prefs-reset"
        :confirming="activeConfirm === 'reset'"
        @update:confirming="setConfirming('reset', $event)"
        @confirm="resetDefaults"
      />
    </div>
  </section>
</template>
