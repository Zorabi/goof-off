import Store from 'electron-store'
import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_TRANSPARENCY_PREFS } from '../shared/transparencyPrefs.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import {
  buildDefaultManagedPrefs,
  DEFAULT_DIAGNOSTIC_PREFS,
  DEFAULT_SYSTEM_PREFS
} from './preferencesModel.js'
import { normalizeStoredPdfPrefs, PDF_PREFS_STORE_SCHEMA } from './pdfPrefsStore.js'

const runtimePlatformPolicy = getRuntimePlatformPolicy()
const runtimeDefaults = buildDefaultManagedPrefs(runtimePlatformPolicy)

const rawStore = new Store({
  watch: true,
  schema: {
    alwaysOnTop: { type: 'boolean', default: false },
    diagnosticPrefs: {
      type: 'object',
      default: DEFAULT_DIAGNOSTIC_PREFS,
      properties: {
        enabled: { type: 'boolean', default: true }
      }
    },
    systemPrefs: {
      type: 'object',
      default: DEFAULT_SYSTEM_PREFS,
      properties: {
        showInTaskbarOrDock: { type: 'boolean', default: true }
      }
    },
    transparencyPrefs: {
      type: 'object',
      default: DEFAULT_TRANSPARENCY_PREFS,
      properties: {
        merged: { type: 'boolean' },
        windowEnabled: { type: 'boolean' },
        contentEnabled: { type: 'boolean' },
        windowLevel: { type: 'number', minimum: 0.1, maximum: 0.95 },
        // Keep accepting legacy zero values long enough for
        // initTransparencyPrefs() to normalize and persist the safe floor.
        contentLevel: { type: 'number', minimum: 0, maximum: 0.95 }
      }
    },
    windowBounds: {
      type: 'object',
      default: { width: 420, height: 820 },
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', default: 420 },
        height: { type: 'number', default: 820 }
      }
    },
    customSites: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          url: { type: 'string' },
          icon: { type: 'string' }
        },
        required: ['id', 'name', 'url']
      }
    },
    sitePresetPrefs: {
      type: 'object',
      default: { hiddenIds: [], overrides: [] },
      properties: {
        hiddenIds: {
          type: 'array',
          items: { type: 'string' }
        },
        overrides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string' },
              icon: { type: 'string' }
            },
            required: ['id', 'name', 'url']
          }
        }
      }
    },
    siteOrder: {
      type: 'array',
      default: [],
      items: { type: 'string' }
    },
    appState: {
      type: 'object',
      default: { content: 'home', fileKind: null, form: 'normal' },
      properties: {
        content: { type: 'string', enum: ['home', 'history', 'web', 'file'] },
        fileKind: {
          anyOf: [{ type: 'string', enum: ['txt', 'epub', 'pdf'] }, { type: 'null' }]
        },
        form: { type: 'string', enum: ['normal', 'mini'] }
      }
    },
    bossKeys: {
      type: 'object',
      default: runtimeDefaults.bossKeys,
      properties: {
        hide: { type: 'string' },
        kill: { type: 'string' }
      }
    },
    webPrefs: {
      type: 'object',
      default: runtimeDefaults.webPrefs,
      properties: {
        ua: { type: 'string', enum: ['mac', 'win', 'iphone', 'ipad'] },
        compat: { type: 'boolean' },
        zoom: { type: 'number', minimum: 0.5, maximum: 2.0 },
        hideScrollbar: { type: 'boolean' },
        plainView: { type: 'boolean' },
        hideMedia: { type: 'boolean', default: false },
        wheelSpeed: { type: 'number', minimum: 0.1, maximum: 2.0, default: 1.0 }
      }
    },
    siteWebPrefs: {
      type: 'object',
      default: {}
    },
    webHistory: {
      type: 'array',
      default: []
    },
    fileHistory: {
      type: 'array',
      default: []
    },
    txtPrefs: {
      type: 'object',
      default: {
        fontSize: 16,
        lineHeight: 1.7,
        bgColor: null,
        autoTurnSec: 30,
        defaultEncoding: null,
        fontFamily: 'default',
        pageKeys: {
          next: 'Space',
          prev: 'Shift+Space'
        }
      },
      properties: {
        fontSize: { type: 'number', minimum: 12, maximum: 24 },
        lineHeight: { type: 'number', minimum: 1.4, maximum: 2.0 },
        bgColor: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        autoTurnSec: { type: 'number', minimum: 5, maximum: 180 },
        defaultEncoding: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        pageKeys: { type: 'object' }
      }
    },
    txtProgress: {
      type: 'object',
      default: {}
    },
    epubPrefs: {
      type: 'object',
      default: {
        defaultMode: 'scroll',
        fontSize: 16,
        lineHeight: 1.7,
        autoTurnSec: 30,
        fontFamily: 'default',
        hideImages: true,
        pageKeys: {
          next: 'Space',
          prev: 'Shift+Space'
        }
      },
      properties: {
        defaultMode: { type: 'string', enum: ['scroll', 'paginate'] },
        fontSize: { type: 'number', minimum: 12, maximum: 24 },
        lineHeight: { type: 'number', minimum: 1.4, maximum: 2.0 },
        autoTurnSec: { type: 'number', minimum: 5, maximum: 180 },
        hideImages: { type: 'boolean' },
        pageKeys: { type: 'object' }
      }
    },
    epubProgress: {
      type: 'object',
      default: {}
    },
    pdfPrefs: PDF_PREFS_STORE_SCHEMA,
    pdfProgress: {
      type: 'object',
      default: {}
    },
    fileVisualPrefs: {
      type: 'object',
      default: {
        gradientEnabled: false,
        gradientAngle: 135,
        gradientStops: ['#f6f6f6', '#eceff1'],
        textColor: null
      }
    },
    startupPrefs: {
      type: 'object',
      default: { restoreShellState: true }
    },
    startupRestoreIntent: {
      anyOf: [{ type: 'object' }, { type: 'null' }],
      default: null
    },
    historyPrefs: {
      type: 'object',
      default: { recordWeb: true, recordFiles: true }
    }
  }
})

normalizeStoredPdfPrefs(rawStore)

// 内存缓存层：conf 的 get/set 每次都对整个配置文件做同步 readFileSync + JSON.parse + AJV 校验，
// 而滚轮缩放、诊断日志、进度保存等高频路径都会触发读取。读走内存缓存；写透传底层
// （保留 AJV 校验与同步落盘语义）后使缓存失效，下次读取回填底层的规范值
// （conf 校验时可能注入 schema 嵌套默认值，直接缓存写入值会与磁盘产生偏差）。
const memoryCache = new Map()

function cacheClone(value) {
  if (value === null || typeof value !== 'object') return value
  return structuredClone(value)
}

const PERSIST_DEBOUNCE_MS = 200
const pendingTimers = new Map()

function resolvePendingValue(key, pending) {
  if (!pending.resolveValue) return pending.value
  return pending.resolveValue(cacheClone(rawStore.get(key)))
}

// 失效必须按「配置根段」对齐，而不是字面 key：set-config IPC 允许
// 'windowBounds.width' 这类点号/方括号子路径与对象式批量写入，仅删字面 key
// 会留下过期的根对象缓存（或反之，根写入后残留子路径缓存）。
function configRootOf(key) {
  return String(key).split(/[.[]/, 1)[0]
}

// electron-store 的文件监听会同时覆盖其他实例和本实例的落盘。只失效实际变化的
// 根段，且让仍在防抖窗口内的本地值继续优先可见，直到其定时写完成。
rawStore.onDidAnyChange((nextStore = {}, previousStore = {}) => {
  const roots = new Set([...Object.keys(previousStore), ...Object.keys(nextStore)])
  for (const root of roots) {
    if (isDeepStrictEqual(previousStore[root], nextStore[root])) continue
    for (const cachedKey of memoryCache.keys()) {
      if (configRootOf(cachedKey) === root) memoryCache.delete(cachedKey)
    }
    for (const [pendingKey, pending] of pendingTimers) {
      if (configRootOf(pendingKey) === root) {
        const visibleValue = pending.resolveValue
          ? resolvePendingValue(pendingKey, pending)
          : pending.value
        memoryCache.set(pendingKey, cacheClone(visibleValue))
      }
    }
  }
})

function isConfigPathAtOrUnder(key, parentPath) {
  const k = String(key)
  const p = String(parentPath)
  return k === p || k.startsWith(`${p}.`) || k.startsWith(`${p}[`)
}

// 直写前废弃/结清同根的挂起防抖写，并清掉同根的全部缓存条目：
// - 挂起 key 等于本次直写 key 或是其子路径 → 直接废弃（否则「清空历史」等
//   一次性直写会在防抖窗口结束时被旧值覆盖）；
// - 挂起的是更浅的根对象而直写子路径 → 挂起值先落盘，子路径写叠加其上，
//   避免挂起数据丢失或在超时后复活。
function invalidateConfigKey(key) {
  const root = configRootOf(key)
  for (const [pendingKey, pending] of pendingTimers) {
    if (configRootOf(pendingKey) !== root) continue
    clearTimeout(pending.timer)
    pendingTimers.delete(pendingKey)
    if (!isConfigPathAtOrUnder(pendingKey, key)) {
      rawStore.set(pendingKey, resolvePendingValue(pendingKey, pending))
    }
  }
  for (const cachedKey of memoryCache.keys()) {
    if (configRootOf(cachedKey) === root) memoryCache.delete(cachedKey)
  }
}

const store = {
  get(key) {
    if (!memoryCache.has(key)) {
      memoryCache.set(key, rawStore.get(key))
    }
    return cacheClone(memoryCache.get(key))
  },
  set(key, value) {
    if (key !== null && typeof key === 'object') {
      // electron-store 对象式批量写：逐 key 失效后整体透传
      for (const k of Object.keys(key)) invalidateConfigKey(k)
      rawStore.set(key)
      return
    }
    invalidateConfigKey(key)
    rawStore.set(key, value)
  },
  delete(key) {
    invalidateConfigKey(key)
    rawStore.delete(key)
  }
}

export function ensurePlatformDefaults(policy = runtimePlatformPolicy) {
  const defaults = buildDefaultManagedPrefs(policy)
  const currentBossKeys = store.get('bossKeys') || {}
  const nextBossKeys = { ...defaults.bossKeys, ...currentBossKeys }
  if (nextBossKeys.hide !== currentBossKeys.hide || nextBossKeys.kill !== currentBossKeys.kill) {
    store.set('bossKeys', nextBossKeys)
  }

  const currentWebPrefs = store.get('webPrefs') || {}
  const nextWebPrefs = { ...defaults.webPrefs, ...currentWebPrefs }
  const isMissingWebPref = Object.keys(defaults.webPrefs).some((key) => !(key in currentWebPrefs))
  if (isMissingWebPref) {
    store.set('webPrefs', nextWebPrefs)
  }

  const currentSystemPrefs = store.get('systemPrefs') || {}
  const isMissingSystemPref = Object.keys(defaults.systemPrefs).some(
    (key) => !(key in currentSystemPrefs)
  )
  if (isMissingSystemPref) {
    store.set('systemPrefs', { ...defaults.systemPrefs, ...currentSystemPrefs })
  }
}

function commitPending(key, pending) {
  if (pendingTimers.get(key) !== pending) return false
  clearTimeout(pending.timer)
  pendingTimers.delete(key)
  store.set(key, resolvePendingValue(key, pending))
  return true
}

export function persistDebounced(key, value, resolveValue) {
  // 缓存立即可见（读方在防抖窗口内拿到最新值），磁盘写延后。
  // 可选 resolver 表示增量写：窗口内按序组合，并基于底层最新值重算。
  memoryCache.set(key, cacheClone(value))
  const existing = pendingTimers.get(key)
  if (existing) clearTimeout(existing.timer)
  let pendingResolver = typeof resolveValue === 'function' ? resolveValue : null
  if (pendingResolver && existing?.resolveValue) {
    const previousResolver = existing.resolveValue
    const nextResolver = pendingResolver
    pendingResolver = (latest) => nextResolver(previousResolver(latest))
  }
  const pending = { timer: null, value, resolveValue: pendingResolver }
  pending.timer = setTimeout(() => commitPending(key, pending), PERSIST_DEBOUNCE_MS)
  pendingTimers.set(key, pending)
}

export function flushPending() {
  for (const [key, pending] of pendingTimers) commitPending(key, pending)
}

export function flushPendingKey(key) {
  const pending = pendingTimers.get(key)
  if (!pending) return false
  return commitPending(key, pending)
}

export function cancelPendingKey(key) {
  const pending = pendingTimers.get(key)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingTimers.delete(key)
  // 挂起值已进缓存但永远不会落盘，失效后让读方回退到磁盘上的旧值。
  memoryCache.delete(key)
  return true
}

export function cancelPendingKeys(keys = []) {
  const cancelled = []
  for (const key of keys) {
    if (cancelPendingKey(key)) cancelled.push(key)
  }
  return cancelled
}

export default store
