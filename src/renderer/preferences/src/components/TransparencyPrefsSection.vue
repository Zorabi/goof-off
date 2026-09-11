<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { logDiagnostic, logDiagnosticError } from '@renderer/composables/useDiagnosticLog.js'
import {
  DEFAULT_TRANSPARENCY_PREFS,
  MIN_INTERFACE_OPACITY,
  normalizeTransparencyPrefs
} from '../../../../shared/transparencyPrefs.js'
import { normalizeRangeProgress } from '../../../../shared/rangeMath.js'

const prefs = ref({ ...DEFAULT_TRANSPARENCY_PREFS })
const readiness = ref('loading')
const status = ref('')
let unlisten = null
let changeRevision = 0
let writeGeneration = 0
let disposed = true
let contentLevelWriteTimer = null
let contentLevelWriteInFlight = false
let pendingContentLevel = null
const LOG_DEBOUNCE_MS = 150
const CONTENT_LEVEL_WRITE_DELAY_MS = 50
const MAX_INTERFACE_OPACITY = 0.95
const diagnosticTimers = new Map()
const contentLevelDraft = ref(DEFAULT_TRANSPARENCY_PREFS.contentLevel)
const contentLevelAdjusting = ref(false)
const backgroundHiddenEnabled = computed(() => prefs.value.windowEnabled === true)
const interfaceFadeEnabled = computed(
  () => backgroundHiddenEnabled.value && prefs.value.contentEnabled === true
)

function applyPrefs(value) {
  prefs.value = normalizeTransparencyPrefs(value)
  if (!contentLevelAdjusting.value && pendingContentLevel == null && !contentLevelWriteInFlight) {
    contentLevelDraft.value = prefs.value.contentLevel
  }
}

function valuesForPatch(patch, source) {
  const values = {}
  for (const key of Object.keys(patch)) {
    values[key] = source?.[key] ?? patch[key]
  }
  return values
}

function sendPrefsDiagnostic(patch, source, ok, error = null) {
  const keys = Object.keys(patch)
  const values = valuesForPatch(patch, source)
  if (error) {
    return logDiagnosticError('transparency.prefs_change', error, {
      keys,
      values,
      source: 'preferences',
      ok
    })
  }
  return logDiagnostic('transparency.prefs_change', {
    keys,
    values,
    source: 'preferences',
    ok
  })
}

function schedulePrefsDiagnostic(patch, source, ok, error = null) {
  const key = Object.keys(patch).join(',')
  const current = diagnosticTimers.get(key)
  if (current) clearTimeout(current.timer)
  const pending = {
    patch,
    source,
    ok,
    error,
    timer: setTimeout(() => {
      diagnosticTimers.delete(key)
      sendPrefsDiagnostic(patch, source, ok, error)
    }, LOG_DEBOUNCE_MS)
  }
  diagnosticTimers.set(key, pending)
}

function flushPendingPrefsDiagnostics() {
  for (const pending of diagnosticTimers.values()) {
    clearTimeout(pending.timer)
    sendPrefsDiagnostic(pending.patch, pending.source, pending.ok, pending.error)
  }
  diagnosticTimers.clear()
}

async function setPatch(patch, { debounceDiagnostic = false, optimistic = false } = {}) {
  if (disposed || readiness.value !== 'ready') return null
  const generation = ++writeGeneration
  const startedAtRevision = changeRevision
  const previous = prefs.value
  if (optimistic) applyPrefs({ ...previous, ...patch })
  try {
    const next = await window.api.transparencyPrefsSet({ patch })
    if (disposed || generation !== writeGeneration) return null
    if (next && changeRevision === startedAtRevision) applyPrefs(next)
    const source = next || { ...prefs.value, ...patch }
    if (debounceDiagnostic) schedulePrefsDiagnostic(patch, source, true)
    else sendPrefsDiagnostic(patch, source, true)
    return next
  } catch (error) {
    if (disposed || generation !== writeGeneration) return null
    if (optimistic && changeRevision === startedAtRevision) applyPrefs(previous)
    if (debounceDiagnostic) schedulePrefsDiagnostic(patch, patch, false, error)
    else sendPrefsDiagnostic(patch, patch, false, error)
    return null
  }
}

function setBackgroundHidden(enabled) {
  return setPatch(
    {
      merged: false,
      windowEnabled: enabled
    },
    { optimistic: true }
  )
}

function setInterfaceFade(enabled) {
  return setPatch(
    {
      merged: false,
      contentEnabled: enabled
    },
    { optimistic: true }
  )
}

async function flushContentLevelWrite() {
  if (contentLevelWriteTimer != null) clearTimeout(contentLevelWriteTimer)
  contentLevelWriteTimer = null
  if (contentLevelWriteInFlight || pendingContentLevel == null) return
  const value = pendingContentLevel
  pendingContentLevel = null
  contentLevelWriteInFlight = true
  await setPatch({ contentLevel: value }, { debounceDiagnostic: true })
  contentLevelWriteInFlight = false
  if (pendingContentLevel != null) {
    void flushContentLevelWrite()
  } else if (!contentLevelAdjusting.value) {
    contentLevelDraft.value = prefs.value.contentLevel
  }
}

function queueContentLevel(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return
  const next = Math.min(MAX_INTERFACE_OPACITY, Math.max(MIN_INTERFACE_OPACITY, numeric))
  contentLevelAdjusting.value = true
  contentLevelDraft.value = next
  pendingContentLevel = next
  if (contentLevelWriteTimer != null) return
  contentLevelWriteTimer = setTimeout(() => {
    void flushContentLevelWrite()
  }, CONTENT_LEVEL_WRITE_DELAY_MS)
}

function commitContentLevel(value) {
  queueContentLevel(value)
  contentLevelAdjusting.value = false
  void flushContentLevelWrite()
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}

const contentLevelFillPercent = computed(
  () =>
    `${
      normalizeRangeProgress(
        contentLevelDraft.value,
        MIN_INTERFACE_OPACITY,
        MAX_INTERFACE_OPACITY
      ) * 100
    }%`
)

onMounted(() => {
  disposed = false
  const startedAtRevision = changeRevision
  try {
    unlisten =
      window.api.onTransparencyPrefsChange?.((next) => {
        if (disposed) return
        changeRevision += 1
        applyPrefs(next)
      }) || null
  } catch (error) {
    unlisten = null
    readiness.value = 'failed'
    status.value = error?.message || '读取失败'
  }

  let request
  try {
    request = window.api.transparencyPrefsGet()
  } catch (error) {
    readiness.value = 'failed'
    status.value = error?.message || '读取失败'
    return
  }
  void Promise.resolve(request)
    .then((next) => {
      if (disposed) return
      if (changeRevision === startedAtRevision) applyPrefs(next)
      if (readiness.value !== 'failed') {
        readiness.value = 'ready'
        status.value = ''
      }
    })
    .catch((error) => {
      if (disposed) return
      readiness.value = 'failed'
      status.value = error?.message || '读取失败'
    })
})

onUnmounted(() => {
  void flushContentLevelWrite()
  disposed = true
  flushPendingPrefsDiagnostics()
  unlisten?.()
  unlisten = null
})
</script>

<template>
  <section class="prefs-sect" :aria-busy="readiness === 'loading' ? 'true' : undefined">
    <div class="prefs-secthead">透明</div>
    <div v-if="status" class="prefs-line__hint is-danger">{{ status }}</div>

    <label class="prefs-line">
      <span class="prefs-line__label">背景隐去</span>
      <input
        type="checkbox"
        :checked="backgroundHiddenEnabled"
        :disabled="readiness !== 'ready'"
        @change="setBackgroundHidden($event.target.checked)"
      />
    </label>

    <label class="prefs-line">
      <span class="prefs-line__label">界面淡化</span>
      <input
        type="checkbox"
        :checked="prefs.contentEnabled"
        :disabled="readiness !== 'ready' || !backgroundHiddenEnabled"
        :title="backgroundHiddenEnabled ? '' : '开启背景隐去后可用'"
        @change="setInterfaceFade($event.target.checked)"
      />
    </label>

    <label class="prefs-line">
      <span class="prefs-line__label">界面淡化强度</span>
      <span class="prefs-line__controls">
        <input
          class="prefs-range-new"
          type="range"
          :min="MIN_INTERFACE_OPACITY"
          :max="MAX_INTERFACE_OPACITY"
          step="0.01"
          :value="contentLevelDraft"
          :style="{ '--fill-pct': contentLevelFillPercent }"
          :disabled="readiness !== 'ready' || !interfaceFadeEnabled"
          :title="interfaceFadeEnabled ? '' : '开启背景隐去和界面淡化后可调'"
          aria-label="界面淡化强度"
          @input="queueContentLevel($event.target.value)"
          @change="commitContentLevel($event.target.value)"
          @pointercancel="commitContentLevel($event.target.value)"
        />
        <span class="prefs-range-readout" aria-live="polite">{{ percent(contentLevelDraft) }}</span>
      </span>
    </label>
  </section>
</template>
