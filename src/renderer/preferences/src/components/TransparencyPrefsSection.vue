<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { logDiagnostic, logDiagnosticError } from '@renderer/composables/useDiagnosticLog.js'
import {
  DEFAULT_TRANSPARENCY_PREFS,
  normalizeTransparencyPrefs
} from '../../../../shared/transparencyPrefs.js'

const prefs = ref({ ...DEFAULT_TRANSPARENCY_PREFS })
const readiness = ref('loading')
const status = ref('')
let unlisten = null
let changeRevision = 0
let writeGeneration = 0
let disposed = true
const LOG_DEBOUNCE_MS = 150
const diagnosticTimers = new Map()

function applyPrefs(value) {
  prefs.value = normalizeTransparencyPrefs(value)
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

async function setPatch(patch, { debounceDiagnostic = false } = {}) {
  if (disposed || readiness.value !== 'ready') return null
  const generation = ++writeGeneration
  const startedAtRevision = changeRevision
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
    if (debounceDiagnostic) schedulePrefsDiagnostic(patch, patch, false, error)
    else sendPrefsDiagnostic(patch, patch, false, error)
    return null
  }
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}

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
      <span class="prefs-line__label">隐身阅读</span>
      <input
        type="checkbox"
        :checked="prefs.merged"
        :disabled="readiness !== 'ready'"
        @change="setPatch({ merged: $event.target.checked })"
      />
    </label>

    <label class="prefs-line">
      <span class="prefs-line__label">界面淡化强度</span>
      <span class="prefs-line__controls">
        <input
          class="prefs-range-new"
          type="range"
          min="0"
          max="0.95"
          step="0.01"
          :value="prefs.contentLevel"
          :style="{ '--fill-pct': `${(prefs.contentLevel / 0.95) * 100}%` }"
          :disabled="readiness !== 'ready'"
          @input="
            setPatch({ contentLevel: Number($event.target.value) }, { debounceDiagnostic: true })
          "
        />
        <span class="prefs-range-readout">{{ percent(prefs.contentLevel) }}</span>
      </span>
    </label>
  </section>
</template>
