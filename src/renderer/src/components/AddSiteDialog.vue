<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import TextInput from './base/TextInput.vue'
import StatusText from './base/StatusText.vue'
import { injectChromeLockRegistry } from '../composables/useChromeLockRegistry.js'
import { SITE_NAME_MAX_LENGTH } from '../../../shared/siteLimits.js'

const props = defineProps({
  initial: { type: Object, default: null }, // { name, url, icon }; icon is legacy-only
  externalError: { type: String, default: '' },
  focusRestoreTarget: { type: [Object, null], default: null }
})
const emit = defineEmits(['submit', 'cancel'])

const chromeLocks = injectChromeLockRegistry()
const ownerId = 'content.add-site-dialog'
const name = ref('')
const url = ref('')
const error = ref('')

function cancel() {
  error.value = ''
  chromeLocks.releaseLock(ownerId, { restoreFocus: true, reason: 'cancel' })
  emit('cancel')
}

chromeLocks.registerLock({
  ownerId,
  kind: 'dialog',
  scope: 'global',
  appliesTo: { content: ['home'], form: ['normal'] },
  focusRestore: { mode: 'trigger', target: props.focusRestoreTarget },
  onEscape: () => cancel()
})

onBeforeUnmount(() => {
  chromeLocks.releaseLock(ownerId)
})

watch(
  () => props.initial,
  (v) => {
    name.value = v?.name || ''
    url.value = v?.url || ''
    error.value = ''
  },
  { immediate: true }
)

function onSubmit() {
  error.value = ''
  if (!name.value.trim()) {
    error.value = '请输入名称'
    return
  }
  if (!url.value.trim()) {
    error.value = '请输入网址'
    return
  }
  let normalizedUrl = url.value.trim()
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl
  try {
    new URL(normalizedUrl)
  } catch {
    error.value = '网址格式无效'
    return
  }
  emit('submit', { name: name.value.trim(), url: normalizedUrl })
}
</script>

<template>
  <div class="overlay" data-gesture-inert role="dialog" aria-modal="true" @click.self="cancel">
    <div class="dialog">
      <div class="title">{{ initial ? '编辑站点' : '添加站点' }}</div>
      <div class="field">
        <label>名称</label>
        <TextInput
          v-model="name"
          :maxlength="SITE_NAME_MAX_LENGTH"
          placeholder="如：知乎"
          aria-label="名称"
        />
      </div>
      <div class="field">
        <label>网址</label>
        <TextInput v-model="url" placeholder="https://example.com" aria-label="网址" />
      </div>
      <StatusText v-if="error || externalError" class="error" tone="error">
        {{ error || externalError }}
      </StatusText>
      <div class="actions">
        <button class="btn-secondary" @click="cancel">取消</button>
        <button class="btn-primary" data-test="save-site" @click="onSubmit">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.32);
  z-index: var(--z-dialog);
  animation: overlay-fade-in var(--motion-micro) ease;
}

.dialog {
  width: min(360px, calc(100vw - 32px));
  padding: var(--space-xl);
  background: var(--panel-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-float);
  animation: dialog-pop-in var(--motion-micro) ease;
}

.title {
  margin-bottom: var(--space-lg);
  color: var(--color-text-primary);
  font-size: var(--text-section-size);
  font-weight: var(--text-section-weight);
}

.field {
  margin-bottom: var(--space-lg);
}

.field label {
  display: block;
  margin-bottom: var(--space-xs);
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
}

.error {
  display: block;
  margin: calc(var(--space-xs) * -1) 0 var(--space-md);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-md);
  margin-top: var(--space-xl);
}

.btn-primary,
.btn-secondary {
  min-height: var(--hit-min);
  padding: 0 var(--space-lg);
  border: 1px solid var(--color-divider);
  border-radius: var(--radius-button);
  font-size: var(--text-meta-size);
  cursor: pointer;
}

.btn-primary {
  background: var(--color-active-icon-bg);
  color: var(--color-text-primary);
}

.btn-primary:hover,
.btn-secondary:hover {
  background: var(--color-hover-bg);
}

.btn-secondary {
  background: transparent;
  color: var(--color-text-secondary);
}
@keyframes overlay-fade-in {
  from {
    opacity: 0;
  }
}
@keyframes dialog-pop-in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
</style>
