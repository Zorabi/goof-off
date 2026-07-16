<script setup>
import { computed } from 'vue'
import BossKeySection from './BossKeySection.vue'
import KeyCaptureButton from './KeyCaptureButton.vue'
import { usePreferenceSection } from '../composables/usePreferenceSection.js'

const txtDefaults = {
  fontSize: 16,
  lineHeight: 1.7,
  bgColor: null,
  autoTurnSec: 30,
  defaultEncoding: null,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
}

const epubDefaults = {
  defaultMode: 'scroll',
  fontSize: 16,
  lineHeight: 1.7,
  autoTurnSec: 30,
  fontFamily: 'default',
  pageKeys: { next: 'Space', prev: 'Shift+Space' }
}

const platformPolicy = computed(() => window.api?.platformPolicy)
const primaryModifierLabel = computed(() =>
  platformPolicy.value?.family === 'windows'
    ? 'Ctrl'
    : platformPolicy.value?.primaryModifier || 'Command'
)

const txtSection = usePreferenceSection({
  defaults: txtDefaults,
  get: window.api.txtGetPrefs,
  set: window.api.txtSetPrefs,
  listen: window.api.onTxtPrefsChange
})

const epubSection = usePreferenceSection({
  defaults: epubDefaults,
  get: window.api.epubGetPrefs,
  set: window.api.epubSetPrefs,
  listen: window.api.onEpubPrefsChange
})

const configurableReaders = computed(() => [
  {
    id: 'txt',
    title: 'TXT',
    section: txtSection,
    defaults: txtDefaults
  },
  {
    id: 'epub',
    title: 'EPUB',
    section: epubSection,
    defaults: epubDefaults
  }
])

const readonlyGroups = [
  {
    title: '通用',
    items: [
      {
        keys: 'Esc',
        action: '收起当前最高优先级面板 / 菜单 / 输入 / 对话框'
      }
    ]
  },
  {
    title: 'TXT',
    items: [
      { keys: 'Cmd/Ctrl+F', action: '搜索' },
      { keys: 'T', action: '目录' },
      { keys: 'A', action: 'TXT 自动翻页开关' },
      { keys: 'Home / End', action: '跳到开头 / 结尾' },
      { keys: 'PageDown / ArrowRight / ArrowDown', action: '下一页' },
      { keys: 'PageUp / ArrowLeft / ArrowUp', action: '上一页' }
    ]
  },
  {
    title: 'EPUB',
    items: [
      { keys: 'Cmd/Ctrl+F', action: '搜索' },
      { keys: 'PageDown / PageUp', action: '翻页' },
      { keys: 'ArrowRight / ArrowLeft', action: '章节跳转' },
      { keys: 'ArrowDown / ArrowUp', action: '滚动' }
    ]
  },
  {
    title: 'PDF',
    items: [
      { keys: 'Cmd/Ctrl+= / Cmd/Ctrl++', action: '放大' },
      { keys: 'Cmd/Ctrl+-', action: '缩小' },
      { keys: 'Cmd/Ctrl+0', action: 'PDF 缩放重置' }
    ]
  }
]

function splitKeyChips(keys) {
  const chips = []
  for (const group of keys.split(' / ')) {
    for (const part of group.split('+')) {
      if (part !== '') chips.push(part)
    }
    if (group.endsWith('+')) chips.push('+')
  }
  return chips
}

function rejectKey(section, reason) {
  section.status.value = {
    kind: 'error',
    text:
      reason === 'primary-modifier' || reason === 'command'
        ? `主翻页键不能使用 ${primaryModifierLabel.value}`
        : '键位无效'
  }
}

function recordKey(reader, direction, value) {
  const section = reader.section
  const other = direction === 'next' ? 'prev' : 'next'
  if (section.prefs.value.pageKeys?.[other] === value) {
    section.status.value = { kind: 'error', text: '主翻页键不能与另一方向重复' }
    return
  }
  section.savePatch({ pageKeys: { [direction]: value } })
}

function resetPageKeys() {
  for (const reader of configurableReaders.value) {
    reader.section.savePatch({ pageKeys: { ...reader.defaults.pageKeys } })
  }
}
</script>

<template>
  <div data-test="shortcuts-section">
    <BossKeySection />

    <section class="prefs-sect">
      <div class="prefs-secthead">自定义翻页键</div>
      <div
        v-for="reader in configurableReaders"
        :key="reader.id"
        :data-test="`${reader.id}-shortcut-section`"
      >
        <div class="prefs-subhead">{{ reader.title }}</div>
        <div class="prefs-line" :data-test="`${reader.id}-shortcut-next`">
          <span class="prefs-line__label">下一页</span>
          <KeyCaptureButton
            :value="reader.section.prefs.value.pageKeys?.next || reader.defaults.pageKeys.next"
            @record="recordKey(reader, 'next', $event)"
            @reject="rejectKey(reader.section, $event)"
          />
        </div>
        <div class="prefs-line" :data-test="`${reader.id}-shortcut-prev`">
          <span class="prefs-line__label">上一页</span>
          <KeyCaptureButton
            :value="reader.section.prefs.value.pageKeys?.prev || reader.defaults.pageKeys.prev"
            @record="recordKey(reader, 'prev', $event)"
            @reject="rejectKey(reader.section, $event)"
          />
        </div>
        <div v-if="reader.section.status.value.text" class="prefs-line__hint is-danger">
          {{ reader.section.status.value.text }}
        </div>
      </div>
      <div class="prefs-line">
        <span class="prefs-line__label">键位设置</span>
        <button
          type="button"
          class="prefs-action"
          data-test="pagekeys-reset"
          @click="resetPageKeys"
        >
          恢复默认
        </button>
      </div>
    </section>

    <section class="prefs-sect" data-test="readonly-shortcuts">
      <div class="prefs-secthead">内置快捷键</div>
      <template v-for="group in readonlyGroups" :key="group.title">
        <div class="prefs-subhead">{{ group.title }}</div>
        <div
          v-for="item in group.items"
          :key="`${group.title}:${item.keys}`"
          class="prefs-line shortcut-readonly-row"
        >
          <span class="shortcut-action">{{ item.action }}</span>
          <span class="prefs-kbd-group">
            <kbd v-for="(chip, i) in splitKeyChips(item.keys)" :key="i" class="prefs-kbd">{{
              chip
            }}</kbd>
          </span>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.shortcut-readonly-row {
  align-items: flex-start;
}

.shortcut-action {
  flex: 1 1 auto;
  font-size: var(--prefs-fs-key);
  line-height: 1.5;
  color: var(--prefs-text-soft);
}
</style>
