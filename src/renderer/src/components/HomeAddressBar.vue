<script setup>
import { ref } from 'vue'
import { useBrowser } from '../composables/useBrowser.js'
import { useAddressInput } from '../composables/useAddressInput.js'
import AddressInput from './AddressInput.vue'

const { state, openSite } = useBrowser()
const currentUrl = ref('')

const controller = useAddressInput({
  mode: 'home',
  currentUrl,
  appState: state,
  reserveTop: false,
  onCommit: async (url) => {
    await openSite(url)
    currentUrl.value = ''
  },
  onEmptySubmit: async () => {}
})
</script>

<template>
  <AddressInput class="home-address-bar" :controller="controller" placeholder="输入网址或搜索" />
</template>

<style scoped>
.home-address-bar {
  flex: 1;
  min-width: 0;
  font-size: var(--text-address-size);
}

.home-address-bar :deep(.address-input__field) {
  height: 24px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--color-surface-panel);
  color: var(--text-primary);
  outline: none;
}

.home-address-bar :deep(.address-input__field:focus) {
  border-color: var(--color-accent);
  background: var(--panel-bg);
}
</style>
