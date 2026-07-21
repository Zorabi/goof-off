<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PrefsStepper from './base/PrefsStepper.vue'
import {
  DEFAULT_FILE_VISUAL_PREFS,
  normalizeFileVisualPrefs
} from '../../../../shared/fileVisualPrefs.js'

const props = defineProps({
  disabled: { type: Boolean, default: false }
})

const prefs = ref({ ...DEFAULT_FILE_VISUAL_PREFS })
const revision = ref(0)
const readiness = ref('loading')
const status = ref('')
let unlisten = null
let changeRevision = 0
let writeGeneration = 0
let disposed = true

const textColorValue = computed(() => prefs.value.textColor || '#2a2a2a')
const writesDisabled = computed(() => props.disabled || readiness.value !== 'ready')

function applyPrefs(value) {
  prefs.value = normalizeFileVisualPrefs(value)
  revision.value += 1
}

async function setPatch(patch) {
  if (writesDisabled.value || disposed) return
  const generation = ++writeGeneration
  const startedAtRevision = changeRevision
  let next
  try {
    next = await window.api.fileVisualPrefsSet(patch)
  } catch (error) {
    if (!disposed && generation === writeGeneration) {
      status.value = error?.message || '保存失败'
    }
    return
  }
  if (disposed || generation !== writeGeneration) return
  if (next && changeRevision === startedAtRevision) applyPrefs(next)
  status.value = ''
}

function setStop(index, color) {
  if (writesDisabled.value || disposed) return
  const stops = [...prefs.value.gradientStops]
  stops[index] = color
  setPatch({ gradientStops: stops })
}

function addStop() {
  if (writesDisabled.value || disposed) return
  if (prefs.value.gradientStops.length >= 3) return
  const stops = [...prefs.value.gradientStops, prefs.value.gradientStops.at(-1)]
  setPatch({ gradientStops: stops })
}

function removeStop(index) {
  if (writesDisabled.value || disposed) return
  if (prefs.value.gradientStops.length <= 2) return
  const stops = prefs.value.gradientStops.filter((_, i) => i !== index)
  setPatch({ gradientStops: stops })
}

function onSwatchKeydown(index, event) {
  if (writesDisabled.value || disposed) return
  if (event.key === 'Delete') removeStop(index)
}

onMounted(() => {
  disposed = false
  const startedAtRevision = changeRevision
  try {
    unlisten =
      window.api.onFileVisualPrefsChange?.((next) => {
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
    request = window.api.fileVisualPrefsGet()
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
  unlisten?.()
  unlisten = null
})
</script>

<template>
  <section
    class="prefs-sect"
    :class="{ 'is-disabled': writesDisabled }"
    :aria-busy="readiness === 'loading' ? 'true' : undefined"
  >
    <div class="prefs-secthead">文件阅读背景</div>
    <div class="prefs-sectdesc">TXT / EPUB 生效；PDF 不应用背景与文字颜色</div>
    <div v-if="status" class="prefs-line__hint is-danger">{{ status }}</div>

    <div class="prefs-line">
      <span class="prefs-line__label">文字颜色</span>
      <span class="prefs-line__actions" style="gap: 10px">
        <span class="prefs-swatch" :style="{ background: textColorValue }">
          <input
            data-test="text-color"
            type="color"
            :value="textColorValue"
            :disabled="writesDisabled"
            @change="setPatch({ textColor: $event.target.value })"
          />
        </span>
        <button
          type="button"
          class="prefs-action"
          data-test="auto-text-color"
          :disabled="writesDisabled || prefs.textColor === null"
          @click="setPatch({ textColor: null })"
        >
          恢复自动
        </button>
      </span>
    </div>

    <label class="prefs-line">
      <span class="prefs-line__label">渐变背景</span>
      <input
        type="checkbox"
        :checked="prefs.gradientEnabled"
        :disabled="writesDisabled"
        @change="setPatch({ gradientEnabled: $event.target.checked })"
      />
    </label>

    <div class="prefs-line">
      <span class="prefs-line__label">渐变方向</span>
      <PrefsStepper
        :model-value="prefs.gradientAngle"
        :min="0"
        :max="360"
        :step="1"
        :sync-key="revision"
        suffix="°"
        :disabled="writesDisabled"
        data-test="gradient-angle"
        @update:model-value="setPatch({ gradientAngle: $event })"
      />
    </div>

    <div class="prefs-line">
      <span class="prefs-line__label">颜色点</span>
      <div class="prefs-swatch-row">
        <span
          v-for="(stop, index) in prefs.gradientStops"
          :key="index"
          class="prefs-swatch"
          :style="{ background: stop }"
          tabindex="0"
          @keydown="onSwatchKeydown(index, $event)"
        >
          <input
            type="color"
            :data-test="`gradient-stop-${index}`"
            :value="stop"
            :disabled="writesDisabled"
            @change="setStop(index, $event.target.value)"
          />
          <button
            v-if="prefs.gradientStops.length > 2"
            type="button"
            class="prefs-swatch__remove"
            :data-test="`remove-stop-${index}`"
            :disabled="writesDisabled"
            aria-label="删除颜色点"
            @click="removeStop(index)"
          >
            ×
          </button>
        </span>
        <button
          v-if="prefs.gradientStops.length < 3"
          type="button"
          class="prefs-swatch--add"
          data-test="add-stop"
          :disabled="writesDisabled"
          aria-label="添加颜色点"
          @click="addStop"
        >
          +
        </button>
      </div>
    </div>

    <div class="prefs-line">
      <span class="prefs-line__label">背景设置</span>
      <button
        type="button"
        class="prefs-action"
        data-test="reset-defaults"
        :disabled="writesDisabled"
        @click="setPatch(DEFAULT_FILE_VISUAL_PREFS)"
      >
        恢复默认
      </button>
    </div>
  </section>
</template>

<style scoped>
.is-disabled {
  opacity: var(--opacity-disabled);
}
</style>
