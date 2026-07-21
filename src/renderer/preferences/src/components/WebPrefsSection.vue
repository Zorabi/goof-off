<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PrefsSegmented from './base/PrefsSegmented.vue'
import PrefsStepper from './base/PrefsStepper.vue'

const props = defineProps({
  contentMode: { type: String, default: 'home' }
})

const defaultWebPrefs = {
  ua: 'iphone',
  compat: false,
  zoom: 1,
  hideScrollbar: true,
  plainView: false,
  hideMedia: false,
  wheelSpeed: 1
}

const uaOptions = [
  { value: 'mac', label: 'macOS' },
  { value: 'win', label: 'Windows' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'ipad', label: 'iPad' }
]

const webPrefs = ref({ ...defaultWebPrefs })
const siteSnapshot = ref({ origin: null, override: null, effectivePrefs: null })
const webRevision = ref(0)
const siteRevision = ref(0)
const status = ref({ kind: '', text: '', scope: '' })
const readiness = ref('loading')
const sourceDone = { web: false, site: false }
const changeRevision = { web: 0, site: 0 }
const writeGeneration = { web: 0, site: 0 }
let unlistenWeb = null
let unlistenSite = null
let disposed = true

const writable = computed(() => readiness.value === 'ready')
const uaDisabled = computed(() => !writable.value || webPrefs.value.compat)
const siteSupported = computed(
  () => props.contentMode === 'web' && Boolean(siteSnapshot.value.origin)
)
const sitePrefs = computed(
  () => siteSnapshot.value.override || siteSnapshot.value.effectivePrefs || defaultWebPrefs
)

function applyWebPrefs(next) {
  webPrefs.value = { ...defaultWebPrefs, ...(next || {}) }
  webRevision.value += 1
}

function applySiteSnapshot(next) {
  siteSnapshot.value = next || { origin: null, override: null, effectivePrefs: null }
  siteRevision.value += 1
}

function showError(text, scope) {
  status.value = { kind: 'error', text, scope }
}

function clearError(scope) {
  if (status.value.scope === scope) status.value = { kind: '', text: '', scope: '' }
}

function completeSource(source) {
  sourceDone[source] = true
  if (readiness.value !== 'failed' && sourceDone.web && sourceDone.site) {
    readiness.value = 'ready'
  }
}

function failSection(error, scope) {
  if (disposed) return
  readiness.value = 'failed'
  showError(error?.message || '读取网页偏好失败', scope)
}

function beginWrite(source) {
  return {
    generation: ++writeGeneration[source],
    startedAtRevision: changeRevision[source]
  }
}

function isCurrentWrite(source, write) {
  return write.generation === writeGeneration[source]
}

function loadSource(source, get, startedAtRevision, apply, scope) {
  let request
  try {
    request = get()
  } catch (error) {
    failSection(error, scope)
    return
  }
  void Promise.resolve(request)
    .then((next) => {
      if (disposed) return
      if (changeRevision[source] === startedAtRevision) apply(next)
      completeSource(source)
    })
    .catch((error) => failSection(error, scope))
}

async function setGlobalPatch(patch) {
  if (!writable.value || disposed) return
  const write = beginWrite('web')
  try {
    const next = await window.api.setWebPrefs(patch)
    if (disposed || !isCurrentWrite('web', write)) return
    if (changeRevision.web === write.startedAtRevision) applyWebPrefs(next)
    status.value = { kind: '', text: '', scope: '' }
  } catch (err) {
    if (!disposed && isCurrentWrite('web', write)) {
      showError(err?.message || '保存网页偏好失败', 'global')
    }
  }
}

async function enableSiteOverride() {
  if (!writable.value || !siteSupported.value || disposed) return
  const write = beginWrite('site')
  try {
    const next = await window.api.setCurrentSiteWebPrefs({})
    if (disposed || !isCurrentWrite('site', write)) return
    if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
    else {
      if (changeRevision.site === write.startedAtRevision) applySiteSnapshot(next)
      clearError('site')
    }
  } catch (error) {
    if (!disposed && isCurrentWrite('site', write)) {
      showError(error?.message || '保存站点偏好失败', 'site')
    }
  }
}

async function setSitePatch(patch) {
  if (!writable.value || !siteSupported.value || !siteSnapshot.value.override || disposed) return
  const write = beginWrite('site')
  try {
    const next = await window.api.setCurrentSiteWebPrefs(patch)
    if (disposed || !isCurrentWrite('site', write)) return
    if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
    else {
      if (changeRevision.site === write.startedAtRevision) applySiteSnapshot(next)
      clearError('site')
    }
  } catch (error) {
    if (!disposed && isCurrentWrite('site', write)) {
      showError(error?.message || '保存站点偏好失败', 'site')
    }
  }
}

async function clearSiteOverride() {
  if (!writable.value || !siteSupported.value || disposed) return
  const write = beginWrite('site')
  try {
    const next = await window.api.clearCurrentSiteWebPrefs()
    if (disposed || !isCurrentWrite('site', write)) return
    if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
    else {
      if (changeRevision.site === write.startedAtRevision) applySiteSnapshot(next)
      clearError('site')
    }
  } catch (error) {
    if (!disposed && isCurrentWrite('site', write)) {
      showError(error?.message || '保存站点偏好失败', 'site')
    }
  }
}

function toggleSiteOverride(checked) {
  if (!writable.value || disposed) return
  if (checked) enableSiteOverride()
  else clearSiteOverride()
}

onMounted(() => {
  disposed = false
  const webStarted = changeRevision.web
  const siteStarted = changeRevision.site
  let listenerFailed = false
  try {
    unlistenWeb =
      window.api.onWebPrefsChange?.((next) => {
        if (disposed) return
        changeRevision.web += 1
        applyWebPrefs(next)
      }) || null
  } catch (error) {
    unlistenWeb = null
    failSection(error, 'global')
    listenerFailed = true
  }
  if (!listenerFailed) {
    try {
      unlistenSite =
        window.api.onCurrentSiteWebPrefsChange?.((next) => {
          if (disposed) return
          changeRevision.site += 1
          applySiteSnapshot(next)
        }) || null
    } catch (error) {
      unlistenWeb?.()
      unlistenWeb = null
      unlistenSite = null
      failSection(error, 'site')
      listenerFailed = true
    }
  }
  if (listenerFailed) {
    unlistenWeb?.()
    unlistenSite?.()
    unlistenWeb = null
    unlistenSite = null
  }

  loadSource('web', () => window.api.getWebPrefs(), webStarted, applyWebPrefs, 'global')
  loadSource(
    'site',
    () => window.api.getCurrentSiteWebPrefs(),
    siteStarted,
    applySiteSnapshot,
    'site'
  )
})

onUnmounted(() => {
  disposed = true
  unlistenWeb?.()
  unlistenSite?.()
  unlistenWeb = null
  unlistenSite = null
})
</script>

<template>
  <div data-test="web-section-root" :aria-busy="readiness === 'loading' ? 'true' : undefined">
    <section class="prefs-sect">
      <div class="prefs-secthead">网页全局</div>
      <div v-if="status.text && status.scope === 'global'" class="prefs-line__hint is-danger">
        {{ status.text }}
      </div>

      <div class="prefs-line">
        <span class="prefs-line__label">用户代理</span>
        <PrefsSegmented
          :options="uaOptions"
          :model-value="webPrefs.ua"
          :disabled="uaDisabled"
          aria-label="用户代理"
          data-test="web-ua"
          @update:model-value="setGlobalPatch({ ua: $event })"
        />
      </div>

      <label class="prefs-line">
        <span class="prefs-line__label">兼容模式</span>
        <input
          type="checkbox"
          :checked="webPrefs.compat"
          :disabled="!writable"
          @change="setGlobalPatch({ compat: $event.target.checked })"
        />
      </label>

      <label class="prefs-line">
        <span class="prefs-line__label">隐藏滚动条</span>
        <input
          type="checkbox"
          :checked="webPrefs.hideScrollbar"
          :disabled="!writable"
          @change="setGlobalPatch({ hideScrollbar: $event.target.checked })"
        />
      </label>

      <div class="prefs-line">
        <span class="prefs-line__label">默认缩放</span>
        <PrefsStepper
          :model-value="webPrefs.zoom"
          :min="0.5"
          :max="2"
          :step="0.05"
          :scale="100"
          :sync-key="webRevision"
          suffix="%"
          :disabled="!writable"
          data-test="web-zoom"
          @update:model-value="setGlobalPatch({ zoom: $event })"
        />
      </div>
    </section>

    <section class="prefs-sect">
      <div class="prefs-secthead">当前站点</div>
      <div class="prefs-sectdesc">
        {{ siteSupported ? siteSnapshot.origin : '当前页面不支持站点覆盖' }}
      </div>
      <div v-if="status.text && status.scope === 'site'" class="prefs-line__hint is-danger">
        {{ status.text }}
      </div>

      <label class="prefs-line">
        <span class="prefs-line__label">站点覆盖</span>
        <input
          data-test="site-override"
          type="checkbox"
          :checked="Boolean(siteSnapshot.override)"
          :disabled="!writable || !siteSupported"
          @change="toggleSiteOverride($event.target.checked)"
        />
      </label>

      <div class="prefs-line">
        <span class="prefs-line__label">站点用户代理</span>
        <PrefsSegmented
          :options="uaOptions"
          :model-value="sitePrefs.ua"
          :disabled="!writable || !siteSupported || !siteSnapshot.override || sitePrefs.compat"
          aria-label="站点用户代理"
          data-test="site-ua"
          @update:model-value="setSitePatch({ ua: $event })"
        />
      </div>

      <label class="prefs-line">
        <span class="prefs-line__label">站点兼容模式</span>
        <input
          data-test="site-compat"
          type="checkbox"
          :checked="sitePrefs.compat"
          :disabled="!writable || !siteSupported || !siteSnapshot.override"
          @change="setSitePatch({ compat: $event.target.checked })"
        />
      </label>

      <div class="prefs-line">
        <span class="prefs-line__label">站点缩放</span>
        <PrefsStepper
          :model-value="sitePrefs.zoom"
          :min="0.5"
          :max="2"
          :step="0.05"
          :scale="100"
          :sync-key="siteRevision"
          suffix="%"
          :disabled="!writable || !siteSupported || !siteSnapshot.override"
          data-test="site-zoom"
          @update:model-value="setSitePatch({ zoom: $event })"
        />
      </div>

      <label class="prefs-line">
        <span class="prefs-line__label">站点隐藏滚动条</span>
        <input
          type="checkbox"
          :checked="sitePrefs.hideScrollbar"
          :disabled="!writable || !siteSupported || !siteSnapshot.override"
          @change="setSitePatch({ hideScrollbar: $event.target.checked })"
        />
      </label>
    </section>
  </div>
</template>
