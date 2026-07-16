<script setup>
defineProps({
  mini: { type: Boolean, default: false },
  solid: { type: Boolean, default: false }
})
</script>

<template>
  <div class="reader-bottom-chrome" :class="{ 'is-mini': mini, 'is-solid': solid }">
    <div class="reader-bottom-stealth" data-test="bottom-stealth">
      <slot name="stealth" />
    </div>
    <div v-if="!mini" class="reader-bottom-divider" aria-hidden="true"></div>
    <div v-if="!mini" class="reader-bottom-mode-tools" data-test="bottom-mode-tools">
      <slot name="mode-tools" />
    </div>
    <div v-if="!mini" class="reader-bottom-status" data-test="bottom-status">
      <slot name="status" />
    </div>
  </div>
</template>

<style scoped>
.reader-bottom-chrome {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 8px;
  background: var(--effective-toolbar-bg);
  backdrop-filter: var(--effective-toolbar-backdrop-filter);
  border-top: 1px solid var(--effective-toolbar-border);
  transition:
    background var(--motion-micro) ease,
    border-color var(--motion-micro) ease;
}

.reader-bottom-chrome:not(.is-mini) {
  -webkit-app-region: drag;
}

.reader-bottom-chrome.is-mini {
  padding: 0 6px;
}

.reader-bottom-chrome.is-solid,
.reader-bottom-chrome:hover,
.reader-bottom-chrome:focus-within {
  background: var(--effective-toolbar-solid-bg);
  border-top-color: var(--effective-toolbar-solid-border);
}

.reader-bottom-stealth,
.reader-bottom-mode-tools,
.reader-bottom-status {
  display: flex;
  align-items: center;
  min-width: 0;
}

.reader-bottom-stealth {
  flex-shrink: 0;
  gap: 2px;
}

.reader-bottom-divider {
  flex: 0 0 1px;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--color-divider);
  opacity: 0.7;
}

.reader-bottom-mode-tools {
  flex: 0 1 auto;
  gap: 2px;
}

.reader-bottom-status {
  flex: 1;
  justify-content: flex-end;
  gap: 8px;
  padding-left: 12px;
}
</style>
