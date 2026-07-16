<script setup>
import { ref, onMounted } from 'vue'

const props = defineProps({
  pageCount: { type: Number, required: true }
})
const emit = defineEmits(['close', 'submit'])
const input = ref(null)
const value = ref('')

onMounted(() => {
  input.value?.focus()
})

function submit() {
  const n = parseInt(value.value, 10)
  if (Number.isFinite(n)) {
    const clamped = Math.max(1, Math.min(n, props.pageCount))
    emit('submit', clamped)
  }
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Enter') submit()
}
</script>

<template>
  <div class="page-jump" data-gesture-inert>
    <input
      ref="input"
      v-model="value"
      type="text"
      inputmode="numeric"
      pattern="\d*"
      aria-label="跳转页码"
      :placeholder="`1-${pageCount}`"
      @keydown="onKeydown"
      @blur="emit('close')"
    />
  </div>
</template>

<style scoped>
.page-jump {
  position: absolute;
  right: 8px;
  bottom: 100%;
  margin-bottom: 4px;
  -webkit-app-region: no-drag;
}
.page-jump input {
  width: 60px;
  padding: 2px 6px;
  border: 1px solid var(--toolbar-border);
  border-radius: 3px;
  background: var(--panel-bg);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  -webkit-app-region: no-drag;
}
</style>
