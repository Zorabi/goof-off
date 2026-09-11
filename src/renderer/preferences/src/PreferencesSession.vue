<script setup>
import { ref } from 'vue'
import ThemePrefsSection from './components/ThemePrefsSection.vue'
import TransparencyPrefsSection from './components/TransparencyPrefsSection.vue'
import FileVisualPrefsSection from './components/FileVisualPrefsSection.vue'
import ModePrefsSection from './components/ModePrefsSection.vue'
import ShortcutPrefsSection from './components/ShortcutPrefsSection.vue'
import SystemPrefsSection from './components/SystemPrefsSection.vue'
import { usePrefsContext } from './composables/usePrefsContext.js'

const topPages = [
  { id: 'visual', label: '视觉' },
  { id: 'mode', label: '模式' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'system', label: '系统' }
]

const activePage = ref('mode')
const { contentMode, fileKind, recommendedMode } = usePrefsContext()
const isWindows = window.api?.platformPolicy?.family === 'windows'

function selectPage(pageId, event) {
  if (event?.button != null && event.button !== 0) return
  event?.preventDefault?.()
  event?.stopPropagation?.()
  activePage.value = pageId
}

function closePreferences() {
  document.activeElement?.blur?.()
  window.api.closePreferences?.()
}
</script>

<template>
  <div
    class="prefs-shell"
    :class="{ 'is-windows': isWindows, dark: true }"
    data-test="preferences-session"
  >
    <header class="prefs-header">
      <div class="prefs-title-row">
        <div class="prefs-title">偏好设置</div>
        <button
          type="button"
          class="prefs-close"
          data-test="prefs-close"
          aria-label="关闭偏好设置"
          @click="closePreferences"
        >
          ×
        </button>
      </div>
      <nav class="prefs-nav" aria-label="偏好设置分类">
        <button
          v-for="page in topPages"
          :key="page.id"
          type="button"
          class="prefs-nav__item"
          :class="{ active: activePage === page.id }"
          :data-test="`top-page-${page.id}`"
          :aria-current="activePage === page.id ? 'page' : undefined"
          @click="selectPage(page.id, $event)"
        >
          {{ page.label }}
        </button>
      </nav>
    </header>

    <main class="prefs-scroll">
      <div v-show="activePage === 'visual'" class="prefs-page" data-test="page-visual">
        <ThemePrefsSection />
        <TransparencyPrefsSection />
        <FileVisualPrefsSection :disabled="contentMode === 'file' && fileKind === 'pdf'" />
      </div>
      <div v-show="activePage === 'mode'" class="prefs-page" data-test="page-mode">
        <ModePrefsSection :initial-mode="recommendedMode" :content-mode="contentMode" />
      </div>
      <div v-show="activePage === 'shortcuts'" class="prefs-page" data-test="page-shortcuts">
        <ShortcutPrefsSection />
      </div>
      <div v-show="activePage === 'system'" class="prefs-page" data-test="page-system">
        <SystemPrefsSection />
      </div>
    </main>
  </div>
</template>
