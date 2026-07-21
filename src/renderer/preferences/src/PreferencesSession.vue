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

function closePreferences() {
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
          @click="activePage = page.id"
        >
          {{ page.label }}
        </button>
      </nav>
    </header>

    <main class="prefs-scroll">
      <template v-if="activePage === 'visual'">
        <ThemePrefsSection />
        <TransparencyPrefsSection />
        <FileVisualPrefsSection :disabled="contentMode === 'file' && fileKind === 'pdf'" />
      </template>
      <ModePrefsSection
        v-else-if="activePage === 'mode'"
        :initial-mode="recommendedMode"
        :content-mode="contentMode"
      />
      <ShortcutPrefsSection v-else-if="activePage === 'shortcuts'" />
      <SystemPrefsSection v-else />
    </main>
  </div>
</template>
