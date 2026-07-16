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
let unlisten = null

const textColorValue = computed(() => prefs.value.textColor || '#2a2a2a')

function applyPrefs(value) {
  prefs.value = normalizeFileVisualPrefs(value)
  revision.value += 1
}

async function setPatch(patch) {
  if (props.disabled) return
  const next = await window.api.fileVisualPrefsSet(patch)
  if (next) applyPrefs(next)
}

function setStop(index, color) {
  const stops = [...prefs.value.gradientStops]
  stops[index] = color
  setPatch({ gradientStops: stops })
}

function addStop() {
  if (prefs.value.gradientStops.length >= 3) return
  const stops = [...prefs.value.gradientStops, prefs.value.gradientStops.at(-1)]
  setPatch({ gradientStops: stops })
}

function removeStop(index) {
  if (prefs.value.gradientStops.length <= 2) return
  const stops = prefs.value.gradientStops.filter((_, i) => i !== index)
  setPatch({ gradientStops: stops })
}

function onSwatchKeydown(index, event) {
  if (event.key === 'Delete') removeStop(index)
}

onMounted(async () => {
  applyPrefs(await window.api.fileVisualPrefsGet())
  unlisten = window.api.onFileVisualPrefsChange?.(applyPrefs) || null
})

onUnmounted(() => {
  unlisten?.()
})
</script>

<template>
  <section class="prefs-sect" :class="{ 'is-disabled': props.disabled }">
    <div class="prefs-secthead">文件阅读背景</div>
    <div class="prefs-sectdesc">TXT / EPUB 生效；PDF 不应用背景与文字颜色</div>

    <div class="prefs-line">
      <span class="prefs-line__label">文字颜色</span>
      <span class="prefs-line__actions" style="gap: 10px">
        <span class="prefs-swatch" :style="{ background: textColorValue }">
          <input
            data-test="text-color"
            type="color"
            :value="textColorValue"
            :disabled="props.disabled"
            @change="setPatch({ textColor: $event.target.value })"
          />
        </span>
        <button
          type="button"
          class="prefs-action"
          data-test="auto-text-color"
          :disabled="props.disabled || prefs.textColor === null"
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
        :disabled="props.disabled"
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
        :disabled="props.disabled"
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
            :disabled="props.disabled"
            @change="setStop(index, $event.target.value)"
          />
          <button
            v-if="prefs.gradientStops.length > 2"
            type="button"
            class="prefs-swatch__remove"
            :data-test="`remove-stop-${index}`"
            :disabled="props.disabled"
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
          :disabled="props.disabled"
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
        :disabled="props.disabled"
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
