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
let unlistenWeb = null
let unlistenSite = null

const uaDisabled = computed(() => webPrefs.value.compat)
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

async function setGlobalPatch(patch) {
  try {
    const next = await window.api.setWebPrefs(patch)
    applyWebPrefs(next)
    status.value = { kind: '', text: '', scope: '' }
  } catch (err) {
    showError(err?.message || '保存网页偏好失败', 'global')
  }
}

async function enableSiteOverride() {
  if (!siteSupported.value) return
  const next = await window.api.setCurrentSiteWebPrefs({})
  if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
  else applySiteSnapshot(next)
}

async function setSitePatch(patch) {
  if (!siteSupported.value || !siteSnapshot.value.override) return
  const next = await window.api.setCurrentSiteWebPrefs(patch)
  if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
  else applySiteSnapshot(next)
}

async function clearSiteOverride() {
  if (!siteSupported.value) return
  const next = await window.api.clearCurrentSiteWebPrefs()
  if (next?.ok === false) showError('当前页面不支持站点覆盖', 'site')
  else applySiteSnapshot(next)
}

function toggleSiteOverride(checked) {
  if (checked) enableSiteOverride()
  else clearSiteOverride()
}

onMounted(async () => {
  try {
    applyWebPrefs(await window.api.getWebPrefs())
    applySiteSnapshot(await window.api.getCurrentSiteWebPrefs())
    unlistenWeb = window.api.onWebPrefsChange?.(applyWebPrefs) || null
    unlistenSite = window.api.onCurrentSiteWebPrefsChange?.(applySiteSnapshot) || null
  } catch (err) {
    showError(err?.message || '读取网页偏好失败', 'global')
  }
})

onUnmounted(() => {
  unlistenWeb?.()
  unlistenSite?.()
})
</script>

<template>
  <div>
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
          @change="setGlobalPatch({ compat: $event.target.checked })"
        />
      </label>

      <label class="prefs-line">
        <span class="prefs-line__label">隐藏滚动条</span>
        <input
          type="checkbox"
          :checked="webPrefs.hideScrollbar"
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
          :disabled="!siteSupported"
          @change="toggleSiteOverride($event.target.checked)"
        />
      </label>

      <div class="prefs-line">
        <span class="prefs-line__label">站点用户代理</span>
        <PrefsSegmented
          :options="uaOptions"
          :model-value="sitePrefs.ua"
          :disabled="!siteSupported || !siteSnapshot.override || sitePrefs.compat"
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
          :disabled="!siteSupported || !siteSnapshot.override"
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
          :disabled="!siteSupported || !siteSnapshot.override"
          data-test="site-zoom"
          @update:model-value="setSitePatch({ zoom: $event })"
        />
      </div>

      <label class="prefs-line">
        <span class="prefs-line__label">站点隐藏滚动条</span>
        <input
          type="checkbox"
          :checked="sitePrefs.hideScrollbar"
          :disabled="!siteSupported || !siteSnapshot.override"
          @change="setSitePatch({ hideScrollbar: $event.target.checked })"
        />
      </label>
    </section>
  </div>
</template>
