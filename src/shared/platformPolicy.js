const MAC_MODIFIER_LABELS = Object.freeze({
  Command: '⌘',
  Cmd: '⌘',
  CmdOrCtrl: '⌘',
  CommandOrControl: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Meta: '⌘'
})

const WINDOWS_MODIFIER_LABELS = Object.freeze({
  Command: 'Win',
  Cmd: 'Win',
  CmdOrCtrl: 'Ctrl',
  CommandOrControl: 'Ctrl',
  Meta: 'Win',
  Control: 'Ctrl',
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Option: 'Alt',
  Shift: 'Shift'
})

const STANDALONE_MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'Command'])
const ALLOWED_PAGE_KEY_MODIFIERS = new Set(['Shift', 'Control', 'Alt'])

function normalizeEventKey(key) {
  if (key === ' ') return 'Space'
  if (key?.length === 1) return key.toUpperCase()
  return key
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function stealthAutoHideCapabilities(overrides = {}) {
  return {
    toolbarAutoHide: true,
    bodyFade: true,
    bodyClickThrough: false,
    bodyClickThroughReason: 'not-verified',
    ...overrides
  }
}

function macPolicy() {
  return {
    platform: 'darwin',
    family: 'mac',
    supported: true,
    productPlatformLabel: 'macOS',
    primaryModifier: 'Command',
    forbiddenPageKeyModifiers: ['Command', 'Meta', 'Cmd'],
    defaultBossKeys: { hide: 'Command+\\', kill: 'Shift+Command+\\' },
    defaultWebPrefs: { ua: 'iphone' },
    menu: { preferencesAccelerator: 'CmdOrCtrl+,' },
    window: {
      keepAlivePanelsAfterMainClose: true,
      maskTransparentPanelReveal: true,
      supportsVibrancy: true,
      supportsTrafficLights: false,
      supportsWindowButtonVisibility: false,
      shouldUseMacHiddenTitlebar: false,
      showCustomWindowControls: true,
      reserveTrafficLightSpacer: false,
      leadingDragRegionWidth: 56,
      stealthAutoHide: stealthAutoHideCapabilities({
        bodyFade: true,
        bodyClickThrough: true,
        bodyClickThroughReason: 'manual-pass-2026-06-29-macos'
      })
    },
    packaging: { winTargets: [], winArch: [] }
  }
}

function windowsPolicy() {
  return {
    platform: 'win32',
    family: 'windows',
    supported: true,
    productPlatformLabel: 'Windows 11',
    primaryModifier: 'Control',
    forbiddenPageKeyModifiers: ['Control', 'Command', 'Meta', 'Cmd'],
    defaultBossKeys: { hide: 'Control+\\', kill: 'Shift+Control+\\' },
    defaultWebPrefs: { ua: 'iphone' },
    menu: { preferencesAccelerator: 'CmdOrCtrl+,' },
    window: {
      keepAlivePanelsAfterMainClose: false,
      maskTransparentPanelReveal: true,
      supportsVibrancy: false,
      supportsTrafficLights: false,
      supportsWindowButtonVisibility: false,
      shouldUseMacHiddenTitlebar: false,
      showCustomWindowControls: true,
      reserveTrafficLightSpacer: false,
      leadingDragRegionWidth: 56,
      stealthAutoHide: stealthAutoHideCapabilities({
        bodyFade: true,
        bodyClickThrough: true,
        bodyClickThroughReason: 'manual-pass-2026-07-14-win11'
      })
    },
    packaging: { winTargets: ['nsis', 'zip'], winArch: ['x64'] }
  }
}

function unsupportedPolicy(platform, family) {
  return {
    ...windowsPolicy(),
    platform,
    family,
    supported: false,
    productPlatformLabel: family === 'linux' ? 'Linux' : 'Unsupported',
    defaultWebPrefs: { ua: 'iphone' },
    window: {
      ...windowsPolicy().window,
      maskTransparentPanelReveal: false,
      stealthAutoHide: stealthAutoHideCapabilities({
        bodyFade: false,
        bodyFadeReason: 'unsupported-platform',
        bodyClickThrough: false,
        bodyClickThroughReason: 'unsupported-platform'
      })
    },
    packaging: { winTargets: [], winArch: [] }
  }
}

export function resolvePlatformPolicy(platform = globalThis.process?.platform) {
  if (platform === 'darwin') return clone(macPolicy())
  if (platform === 'win32') return clone(windowsPolicy())
  if (platform === 'linux') return clone(unsupportedPolicy('linux', 'linux'))
  return clone(unsupportedPolicy('unknown', 'unknown'))
}

export function getRuntimePlatformPolicy() {
  return resolvePlatformPolicy(globalThis.process?.platform)
}

export function getPrimaryModifier(policy = getRuntimePlatformPolicy()) {
  return resolvePlatformPolicy(policy?.platform).primaryModifier
}

export function getDefaultBossKeys(policy = getRuntimePlatformPolicy()) {
  return { ...resolvePlatformPolicy(policy?.platform).defaultBossKeys }
}

export function getDefaultWebPrefs(policy = getRuntimePlatformPolicy()) {
  return { ...resolvePlatformPolicy(policy?.platform).defaultWebPrefs }
}

export function formatAccelerator(accelerator, policy = getRuntimePlatformPolicy()) {
  if (!accelerator) return ''
  const resolved = resolvePlatformPolicy(policy?.platform)
  const labels = resolved.family === 'mac' ? MAC_MODIFIER_LABELS : WINDOWS_MODIFIER_LABELS
  return String(accelerator)
    .split('+')
    .map((part) => labels[part] || part)
    .join(resolved.family === 'mac' ? '' : '+')
}

export function eventUsesPrimaryModifier(event, policy = getRuntimePlatformPolicy()) {
  const primary = getPrimaryModifier(policy)
  if (primary === 'Command') return event?.metaKey === true && event?.ctrlKey !== true
  return event?.ctrlKey === true && event?.metaKey !== true
}

export function eventHasForbiddenPageKeyModifier(event, policy = getRuntimePlatformPolicy()) {
  const forbidden = resolvePlatformPolicy(policy?.platform).forbiddenPageKeyModifiers
  const pressed = []
  if (event?.shiftKey) pressed.push('Shift')
  if (event?.ctrlKey) pressed.push('Control')
  if (event?.altKey) pressed.push('Alt')
  if (event?.metaKey) pressed.push('Command', 'Meta')
  return pressed.some((part) => forbidden.includes(part))
}

export function normalizePageKeyDescriptor(value, policy = getRuntimePlatformPolicy()) {
  const resolved = resolvePlatformPolicy(policy?.platform)
  if (typeof value !== 'string') return null
  const rawParts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!rawParts.length) return null
  const key = rawParts.at(-1)
  if (!key || STANDALONE_MODIFIER_KEYS.has(key)) return null
  const mods = rawParts.slice(0, -1)
  if (mods.some((part) => !ALLOWED_PAGE_KEY_MODIFIERS.has(part))) return null
  if (rawParts.some((part) => resolved.forbiddenPageKeyModifiers.includes(part))) return null
  return [...mods, key].join('+')
}

export function eventToPageKeyDescriptor(event, policy = getRuntimePlatformPolicy()) {
  const resolved = resolvePlatformPolicy(policy?.platform)
  if (!event?.key || STANDALONE_MODIFIER_KEYS.has(event.key)) return null
  const pressedModifiers = []
  if (event.shiftKey) pressedModifiers.push('Shift')
  if (event.ctrlKey) pressedModifiers.push('Control')
  if (event.altKey) pressedModifiers.push('Alt')
  if (event.metaKey) pressedModifiers.push('Command')
  if (pressedModifiers.some((part) => resolved.forbiddenPageKeyModifiers.includes(part))) {
    return { ok: false, reason: 'primary-modifier' }
  }
  const descriptor = [
    ...pressedModifiers.filter((part) => part !== 'Command'),
    normalizeEventKey(event.key)
  ].join('+')
  return { ok: true, value: descriptor }
}
