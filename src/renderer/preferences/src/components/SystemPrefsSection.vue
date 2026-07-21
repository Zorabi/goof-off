<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PrefsActionText from './base/PrefsActionText.vue'

const startupPrefs = ref({ restoreShellState: true })
const historyPrefs = ref({ recordWeb: true, recordFiles: true })
const diagnosticPrefs = ref({ enabled: true })
const systemPrefs = ref({ showInTaskbarOrDock: true })
const feedback = ref({})
const activeConfirm = ref('')
const maintenanceBusy = ref(false)
const readiness = ref('loading')
const loadError = ref('')
const writesDisabled = computed(() => readiness.value !== 'ready')
const sources = ['startup', 'history', 'diagnostic', 'system']
const sourceState = Object.fromEntries(
  sources.map((source) => [source, { revision: 0, done: false }])
)
const writeGeneration = Object.fromEntries(sources.map((source) => [source, 0]))
const sourceConfig = {
  startup: {
    get: () => window.api.startupPrefsGet(),
    listen: window.api.onStartupPrefsChange,
    apply: (next) => {
      startupPrefs.value = next
    }
  },
  history: {
    get: () => window.api.historyPrefsGet(),
    listen: window.api.onHistoryPrefsChange,
    apply: (next) => {
      historyPrefs.value = next
    }
  },
  diagnostic: {
    get: () => window.api.diagnosticPrefsGet(),
    listen: window.api.onDiagnosticPrefsChange,
    apply: (next) => {
      diagnosticPrefs.value = next
    }
  },
  system: {
    get: () => window.api.systemPrefsGet(),
    listen: window.api.onSystemPrefsChange,
    apply: (next) => {
      systemPrefs.value = next
    }
  }
}
let disposed = true
let unlisteners = []

const CONFIRM_HINT = '再点一次确认，3 秒后取消'

function setFeedback(row, kind, text) {
  feedback.value = { ...feedback.value, [row]: { kind, text } }
}

function clearFeedback(row) {
  const next = { ...feedback.value }
  delete next[row]
  feedback.value = next
}

function setConfirming(row, value) {
  activeConfirm.value = value ? row : activeConfirm.value === row ? '' : activeConfirm.value
}

function completeSource(source) {
  sourceState[source].done = true
  if (readiness.value !== 'failed' && sources.every((name) => sourceState[name].done)) {
    readiness.value = 'ready'
  }
}

function failSource(error) {
  if (disposed) return
  readiness.value = 'failed'
  loadError.value = error?.message || '读取失败'
}

function cleanupUnlisteners() {
  const registered = unlisteners
  unlisteners = []
  for (const unlisten of registered) {
    try {
      unlisten?.()
    } catch {
      // Listener cleanup must not mask the original registration failure.
    }
  }
}

function beginSourceWrite(source) {
  return {
    generation: ++writeGeneration[source],
    startedAtRevision: sourceState[source].revision
  }
}

function isCurrentSourceWrite(source, write) {
  return write.generation === writeGeneration[source]
}

function loadSource(source, startedAtRevision) {
  let request
  try {
    request = sourceConfig[source].get()
  } catch (error) {
    failSource(error)
    return
  }
  void Promise.resolve(request)
    .then((next) => {
      if (disposed) return
      if (sourceState[source].revision === startedAtRevision) sourceConfig[source].apply(next)
      completeSource(source)
    })
    .catch((error) => failSource(error))
}

onMounted(() => {
  disposed = false
  const startedAtRevision = Object.fromEntries(
    sources.map((source) => [source, sourceState[source].revision])
  )
  unlisteners = []
  let listenerFailed = false
  for (const source of sources) {
    if (listenerFailed) break
    const config = sourceConfig[source]
    const listen = config.listen
    if (typeof listen !== 'function') continue
    try {
      const unlisten = listen((next) => {
        if (disposed) return
        sourceState[source].revision += 1
        config.apply(next)
      })
      unlisteners.push(unlisten || null)
    } catch (error) {
      failSource(error)
      listenerFailed = true
      cleanupUnlisteners()
    }
  }

  for (const source of sources) loadSource(source, startedAtRevision[source])
})

onUnmounted(() => {
  disposed = true
  cleanupUnlisteners()
})

async function setStartupPatch(patch) {
  if (writesDisabled.value || disposed) return
  const write = beginSourceWrite('startup')
  try {
    const next = await window.api.startupPrefsSet(patch)
    if (disposed || !isCurrentSourceWrite('startup', write)) return
    if (sourceState.startup.revision === write.startedAtRevision) startupPrefs.value = next
    clearFeedback('startup')
  } catch (error) {
    if (!disposed && isCurrentSourceWrite('startup', write)) {
      setFeedback('startup', 'error', error?.message || '保存失败')
    }
  }
}

async function setHistoryPatch(patch) {
  if (writesDisabled.value || disposed) return
  const write = beginSourceWrite('history')
  try {
    const next = await window.api.historyPrefsSet(patch)
    if (disposed || !isCurrentSourceWrite('history', write)) return
    if (sourceState.history.revision === write.startedAtRevision) historyPrefs.value = next
    clearFeedback('history')
  } catch (error) {
    if (!disposed && isCurrentSourceWrite('history', write)) {
      setFeedback('history', 'error', error?.message || '保存失败')
    }
  }
}

async function setDiagnosticEnabled(enabled) {
  if (writesDisabled.value || disposed) return
  const write = beginSourceWrite('diagnostic')
  try {
    const next = await window.api.diagnosticPrefsSet({ enabled })
    if (disposed || !isCurrentSourceWrite('diagnostic', write)) return
    const revisionUnchanged = sourceState.diagnostic.revision === write.startedAtRevision
    if (revisionUnchanged) {
      diagnosticPrefs.value = next
    } else if (diagnosticPrefs.value.enabled !== next?.enabled) {
      return
    }
    setFeedback('diagnostic', 'success', enabled ? '已启用诊断日志' : '已停用诊断日志')
  } catch (error) {
    if (
      !disposed &&
      isCurrentSourceWrite('diagnostic', write) &&
      sourceState.diagnostic.revision === write.startedAtRevision
    ) {
      setFeedback('diagnostic', 'error', error?.message || '保存失败')
    }
  }
}

async function setSystemVisibility(enabled) {
  if (writesDisabled.value || disposed) return
  const write = beginSourceWrite('system')
  const previous = systemPrefs.value
  systemPrefs.value = { showInTaskbarOrDock: enabled }
  try {
    const next = await window.api.systemPrefsSet({ showInTaskbarOrDock: enabled })
    if (disposed || !isCurrentSourceWrite('system', write)) return
    const normalized = {
      showInTaskbarOrDock:
        typeof next?.showInTaskbarOrDock === 'boolean'
          ? next.showInTaskbarOrDock
          : previous.showInTaskbarOrDock
    }
    const revisionUnchanged = sourceState.system.revision === write.startedAtRevision
    if (revisionUnchanged) {
      systemPrefs.value = normalized
    } else if (systemPrefs.value.showInTaskbarOrDock !== normalized.showInTaskbarOrDock) {
      return
    }
    if (normalized.showInTaskbarOrDock === enabled) {
      setFeedback(
        'visibility',
        'success',
        enabled ? '已显示任务栏 / Dock 图标' : '已隐藏任务栏 / Dock 图标'
      )
    } else {
      setFeedback('visibility', 'error', '任务栏 / Dock 图标状态未更改')
    }
  } catch (error) {
    if (
      !disposed &&
      isCurrentSourceWrite('system', write) &&
      sourceState.system.revision === write.startedAtRevision
    ) {
      systemPrefs.value = previous
      setFeedback('visibility', 'error', error?.message || '保存失败')
    }
  }
}

async function clearWebHistory() {
  if (writesDisabled.value || disposed) return
  try {
    await window.api.historyClearWeb()
    if (!disposed) setFeedback('historyWeb', 'success', '已清空网页历史')
  } catch (error) {
    if (!disposed) setFeedback('historyWeb', 'error', error?.message || '清空失败')
  }
}

async function clearFileHistory() {
  if (writesDisabled.value || disposed) return
  try {
    await window.api.historyClearFiles()
    if (!disposed) setFeedback('historyFiles', 'success', '已清空文件历史')
  } catch (error) {
    if (!disposed) setFeedback('historyFiles', 'error', error?.message || '清空失败')
  }
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
  if (writesDisabled.value || disposed) return
  try {
    const result = await window.api.preferencesExport()
    if (disposed || result?.reason === 'cancelled') return
    if (result?.ok) setFeedback('config', 'success', '已导出配置')
    else setFeedback('config', 'error', result?.message || '导出失败')
  } catch (error) {
    if (!disposed) setFeedback('config', 'error', error?.message || '导出失败')
  }
}

async function importPrefs() {
  if (writesDisabled.value || disposed) return
  try {
    const result = await window.api.preferencesImport()
    if (disposed || result?.reason === 'cancelled') return
    if (result?.ok) setFeedback('config', 'success', summarizeImport(result))
    else setFeedback('config', 'error', result?.message || '导入失败')
  } catch (error) {
    if (!disposed) setFeedback('config', 'error', error?.message || '导入失败')
  }
}

async function resetDefaults() {
  if (writesDisabled.value || disposed || maintenanceBusy.value) return
  maintenanceBusy.value = true
  try {
    const result = await window.api.preferencesResetDefaults()
    if (disposed) return
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
  } catch (error) {
    if (!disposed) setFeedback('reset', 'error', error?.message || '恢复默认失败')
  } finally {
    if (!disposed) maintenanceBusy.value = false
  }
}

async function clearAppCache() {
  if (writesDisabled.value || disposed || maintenanceBusy.value) return
  maintenanceBusy.value = true
  try {
    const result = await window.api.appCacheClear()
    if (disposed) return
    setFeedback(
      'cache',
      result?.ok ? 'success' : 'error',
      result?.ok ? '已清空应用缓存' : '缓存已部分清理'
    )
  } catch (error) {
    if (!disposed) setFeedback('cache', 'error', error?.message || '清空缓存失败')
  } finally {
    if (!disposed) maintenanceBusy.value = false
  }
}

async function initializeApp() {
  if (writesDisabled.value || disposed || maintenanceBusy.value) return
  maintenanceBusy.value = true
  try {
    const result = await window.api.appInitialize()
    if (disposed) return
    setFeedback(
      'initialize',
      result?.ok ? 'success' : 'error',
      result?.ok ? '已完成应用初始化' : '初始化部分失败'
    )
  } catch (error) {
    if (!disposed) setFeedback('initialize', 'error', error?.message || '初始化失败')
  } finally {
    if (!disposed) maintenanceBusy.value = false
  }
}
</script>

<template>
  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
    <div class="prefs-secthead">启动</div>
    <div
      v-if="feedback.startup"
      class="prefs-line__hint"
      :class="feedback.startup.kind === 'success' ? 'is-success' : 'is-danger'"
    >
      {{ feedback.startup.text }}
    </div>
    <div v-if="loadError" class="prefs-line__hint is-danger">{{ loadError }}</div>
    <label class="prefs-line">
      <span class="prefs-line__label">启动时恢复上次阅读</span>
      <input
        data-test="startup-restore"
        type="checkbox"
        :checked="startupPrefs.restoreShellState"
        :disabled="writesDisabled"
        @change="setStartupPatch({ restoreShellState: $event.target.checked })"
      />
    </label>
  </section>

  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
    <div class="prefs-secthead">历史</div>
    <div
      v-if="feedback.history"
      class="prefs-line__hint"
      :class="feedback.history.kind === 'success' ? 'is-success' : 'is-danger'"
    >
      {{ feedback.history.text }}
    </div>
    <label class="prefs-line">
      <span class="prefs-line__label">记录网页历史</span>
      <input
        data-test="history-record-web"
        type="checkbox"
        :checked="historyPrefs.recordWeb"
        :disabled="writesDisabled"
        @change="setHistoryPatch({ recordWeb: $event.target.checked })"
      />
    </label>
    <label class="prefs-line">
      <span class="prefs-line__label">记录文件历史</span>
      <input
        data-test="history-record-files"
        type="checkbox"
        :checked="historyPrefs.recordFiles"
        :disabled="writesDisabled"
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
      <PrefsActionText
        label="清空"
        data-test="history-clear-web"
        :disabled="writesDisabled"
        @confirm="clearWebHistory"
      />
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
      <PrefsActionText
        label="清空"
        data-test="history-clear-files"
        :disabled="writesDisabled"
        @confirm="clearFileHistory"
      />
    </div>
  </section>

  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
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
        :disabled="writesDisabled || maintenanceBusy"
        @change="setSystemVisibility($event.target.checked)"
      />
    </div>
    <div class="prefs-line">
      <div class="prefs-line__text">
        <label class="prefs-line__label" for="diagnostic-enabled">诊断日志</label>
        <div
          v-if="feedback.diagnostic"
          class="prefs-line__hint"
          :class="feedback.diagnostic.kind === 'success' ? 'is-success' : 'is-danger'"
        >
          {{ feedback.diagnostic.text }}
        </div>
      </div>
      <input
        id="diagnostic-enabled"
        data-test="diagnostic-enabled"
        type="checkbox"
        :checked="diagnosticPrefs.enabled"
        :disabled="writesDisabled || maintenanceBusy"
        @change="setDiagnosticEnabled($event.target.checked)"
      />
    </div>
  </section>

  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
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
        :disabled="writesDisabled || maintenanceBusy"
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
        :disabled="writesDisabled || maintenanceBusy"
        :confirming="activeConfirm === 'initialize'"
        @update:confirming="setConfirming('initialize', $event)"
        @confirm="initializeApp"
      />
    </div>
  </section>

  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
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
        <PrefsActionText
          label="导出…"
          data-test="prefs-export"
          :disabled="writesDisabled"
          @confirm="exportPrefs"
        />
        <PrefsActionText
          label="导入…"
          data-test="prefs-import"
          :disabled="writesDisabled"
          @confirm="importPrefs"
        />
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
        :disabled="writesDisabled || maintenanceBusy"
        :confirming="activeConfirm === 'reset'"
        @update:confirming="setConfirming('reset', $event)"
        @confirm="resetDefaults"
      />
    </div>
  </section>
</template>
