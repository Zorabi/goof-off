<script setup>
defineProps({
  tone: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'muted', 'error'].includes(value)
  }
})
</script>

<template>
  <span class="status-text" :class="`tone-${tone}`">
    <slot />
  </span>
</template>

<style scoped>
.status-text {
  display: inline-block;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-meta-size);
  line-height: 1.4;
}

.tone-muted {
  color: var(--color-text-muted);
}

.tone-error {
  color: var(--color-danger);
}
</style>
