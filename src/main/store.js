import Store from 'electron-store'
import { DEFAULT_TRANSPARENCY_PREFS } from '../shared/transparencyPrefs.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'
import {
  buildDefaultManagedPrefs,
  DEFAULT_DIAGNOSTIC_PREFS,
  DEFAULT_SYSTEM_PREFS
} from './preferencesModel.js'

const runtimePlatformPolicy = getRuntimePlatformPolicy()
const runtimeDefaults = buildDefaultManagedPrefs(runtimePlatformPolicy)

const store = new Store({
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
        pageKeys: { type: 'object' }
      }
    },
    epubProgress: {
      type: 'object',
      default: {}
    },
    pdfPrefs: {
      type: 'object',
      default: { defaultZoom: 'fit-width', pageDisplay: 'page', invertColors: false },
      properties: {
        defaultZoom: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        pageDisplay: { type: 'string', enum: ['page', 'percent', 'both'] },
        invertColors: { type: 'boolean' }
      }
    },
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

const PERSIST_DEBOUNCE_MS = 200
const pendingTimers = new Map()

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

export function persistDebounced(key, value) {
  const existing = pendingTimers.get(key)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    store.set(key, value)
    pendingTimers.delete(key)
  }, PERSIST_DEBOUNCE_MS)
  pendingTimers.set(key, { timer, value })
}

export function flushPending() {
  for (const [key, { timer, value }] of pendingTimers) {
    clearTimeout(timer)
    store.set(key, value)
  }
  pendingTimers.clear()
}

export function flushPendingKey(key) {
  const pending = pendingTimers.get(key)
  if (!pending) return false
  clearTimeout(pending.timer)
  store.set(key, pending.value)
  pendingTimers.delete(key)
  return true
}

export function cancelPendingKey(key) {
  const pending = pendingTimers.get(key)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingTimers.delete(key)
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
