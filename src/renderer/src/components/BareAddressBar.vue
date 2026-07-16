<script setup>
import { onMounted, ref, watch } from 'vue'
import { useAddressInput } from '../composables/useAddressInput.js'
import { useBookmark } from '../composables/useBookmark.js'
import { useBrowser } from '../composables/useBrowser.js'
import AddressInput from './AddressInput.vue'
import IconButton from './base/IconButton.vue'
import Icon from './icons/Icon.vue'

const props = defineProps({
  chromeVisible: { type: Boolean, default: true },
  bodyHidden: { type: Boolean, default: false }
})

const { state, url, canBack, canForward, openURL, goBack, goForward, reload, goHome } = useBrowser()
const { isBookmarked, canBookmark, toggleBookmark, refresh: refreshBookmarkSites } = useBookmark()

const controller = useAddressInput({
  mode: 'web',
  currentUrl: url,
  appState: state,
  onCommit: async (targetUrl) => {
    await openURL(targetUrl)
  },
  onEmptySubmit: async () => {
    await goHome()
  }
})
const isEditingAddress = ref(false)

watch(
  controller.editing,
  (editing) => {
    isEditingAddress.value = editing
  },
  { immediate: true, flush: 'sync' }
)

// 编辑态星标仅视觉隐去但保留命中区：点击先退出编辑（失焦、关联想），再对当前页执行收藏切换
async function onBookmarkClick() {
  if (controller.editing.value) {
    controller.cancelDeferredBlur?.()
    await controller.escape()
  }
  toggleBookmark()
}

onMounted(refreshBookmarkSites)
</script>

<template>
  <div class="bare-address-bar">
    <IconButton
      data-testid="back-btn"
      icon="chevron-left"
      aria-label="后退"
      :disabled="!canBack"
      @click="goBack"
    />
    <IconButton
      data-testid="forward-btn"
      icon="chevron-right"
      aria-label="前进"
      :disabled="!canForward"
      @click="goForward"
    />
    <IconButton data-testid="reload-btn" icon="refresh" aria-label="刷新" @click="reload" />

    <div class="bare-address-shell" :class="{ 'is-editing': isEditingAddress }">
      <AddressInput
        class="bare-address-input"
        :controller="controller"
        suggestions-host="child"
        :chrome-visible="props.chromeVisible"
        :body-hidden="props.bodyHidden"
        placeholder="输入网址或搜索"
        aria-label="网页地址或搜索"
      />
      <button
        v-if="state.content === 'web'"
        data-testid="bookmark-btn"
        type="button"
        class="bookmark-button"
        :class="{ 'is-edit-veiled': isEditingAddress }"
        :tabindex="isEditingAddress ? -1 : 0"
        :disabled="!canBookmark"
        :aria-label="isBookmarked ? '取消收藏' : '收藏当前网址'"
        @click="onBookmarkClick"
      >
        <Icon v-if="isBookmarked" name="star-filled" />
        <Icon v-else name="star" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.bare-address-bar {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  -webkit-app-region: drag;
}

.bare-address-bar :deep(.icon-button) {
  -webkit-app-region: no-drag;
}

.bare-address-shell {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.bare-address-input :deep(.address-input__field) {
  height: 26px;
  padding-right: 32px;
  color: var(--color-text-primary);
  font-size: var(--text-address-size);
  font-weight: var(--text-address-weight);
  text-align: center;
}

/* 编辑态星标隐藏，回收其预留并恢复输入习惯的左对齐；切换须保持 0ms 无过渡 */
.bare-address-shell.is-editing .bare-address-input :deep(.address-input__field) {
  padding-right: 10px;
  text-align: left;
}

.bookmark-button {
  position: absolute;
  top: 50%;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: none;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  line-height: 1;
  transform: translateY(-50%);
  -webkit-app-region: no-drag;
}

.bookmark-button:hover:not(:disabled) {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
}

.bookmark-button:disabled {
  cursor: not-allowed;
  opacity: var(--opacity-disabled);
}

.bookmark-button:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 1px;
}

/* 编辑态星标视觉隐去（0ms 无过渡）但保留命中区，点击走先失焦再收藏的手势 */
.bookmark-button.is-edit-veiled {
  opacity: 0;
}
</style>
