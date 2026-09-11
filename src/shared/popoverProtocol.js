import { MIN_INTERFACE_OPACITY } from './transparencyPrefs.js'

export const POPOVER_IDS = ['visual', 'encoding', 'pdf-zoom', 'address-suggestions', 'more-menu']
export const POPUP_PLACEMENTS = ['top', 'bottom', 'left', 'right']
export const POPOVER_SHIFT_TOLERANCE_DIP = 8
const MORE_MENU_READING_PANEL_CONTENT_WIDTH = 112
const MORE_MENU_READING_PANEL_HORIZONTAL_CHROME = 10

export const POPOVER_DESIRED_SIZE = Object.freeze({
  visual: Object.freeze({ width: 252, height: 252 }),
  encoding: Object.freeze({ width: 112, height: 132 }),
  'pdf-zoom': Object.freeze({ width: 132, height: 188 }),
  'address-suggestions': Object.freeze({ width: 220, height: 260 }),
  'more-menu': Object.freeze({
    width: MORE_MENU_READING_PANEL_CONTENT_WIDTH + MORE_MENU_READING_PANEL_HORIZONTAL_CHROME,
    // Six 44px rows plus the separator and shell padding. The child window
    // still measures and shrinks to the actual item count after rendering.
    height: 292
  })
})

const ENCODINGS = ['UTF-8', 'GBK', 'GB2312', 'Big5']
const ADDRESS_SOURCES = ['site', 'history']
const ADDRESS_ITEM_KEYS = ['id', 'source', 'label', 'displayUrl']
const ADDRESS_ITEM_ID_PATTERN = /^address-item-\d+$/
const PRIVATE_ADDRESS_FIELD_KEYS = ['targetUrl', 'query', 'hash', 'url', 'href', 'rawUrl']
const ADDRESS_ACTION_KEYS = Object.freeze({
  close: ['id', 'action', 'requestToken'],
  'set-active-index': ['id', 'action', 'index', 'itemId', 'requestToken'],
  'commit-suggestion': ['id', 'action', 'index', 'itemId', 'requestToken']
})
const MENU_COMMANDS = [
  'pin',
  'mini',
  'toolbar-auto-hide',
  'body-auto-hide',
  'body-follow-pointer',
  'preferences'
]
const MENU_CHECKBOX_COMMANDS = ['toolbar-auto-hide', 'body-auto-hide', 'body-follow-pointer']
const CLOSE_REASONS = ['closed', 'escape', 'focus-lost', 'replaced', 'open-failed', 'crashed']

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isPopoverId(value) {
  return POPOVER_IDS.includes(value)
}

function isPlacement(value) {
  return POPUP_PLACEMENTS.includes(value)
}

function isPositiveSize(value) {
  return (
    value &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  )
}

function isRect(value) {
  return (
    value &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width >= 0 &&
    value.height >= 0
  )
}

function isString(value) {
  return typeof value === 'string'
}

function validOptionalRequestToken(payload) {
  return payload.requestToken === undefined || isString(payload.requestToken)
}

function hasOnlyKeys(payload, allowedKeys) {
  return Object.keys(payload).every((key) => allowedKeys.includes(key))
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function hasPrivateAddressField(item) {
  return PRIVATE_ADDRESS_FIELD_KEYS.some((key) => hasOwn(item, key))
}

function validAddressChildItemId(value) {
  return isString(value) && ADDRESS_ITEM_ID_PATTERN.test(value)
}

function validAddressSuggestionItem(item) {
  if (!item || typeof item !== 'object') return false
  if (hasPrivateAddressField(item)) return 'private-url'
  if (!hasOnlyKeys(item, ADDRESS_ITEM_KEYS)) return false
  if (!validAddressChildItemId(item.id)) return 'invalid-id'
  if (isString(item.displayUrl) && /[?#]/.test(item.displayUrl)) return 'private-url'
  return ADDRESS_SOURCES.includes(item.source) && isString(item.label) && isString(item.displayUrl)
}

function validMenuItem(item) {
  if (!item || !MENU_COMMANDS.includes(item.id)) return false
  if (!isString(item.label) || !isString(item.icon)) return false
  if (typeof item.enabled !== 'boolean') return false
  if (item.title !== undefined && !isString(item.title)) return false
  if (item.active !== undefined && typeof item.active !== 'boolean') return false
  if (item.separatorBefore !== undefined && typeof item.separatorBefore !== 'boolean') return false
  if (item.checked !== undefined) {
    if (!MENU_CHECKBOX_COMMANDS.includes(item.id)) return false
    if (typeof item.checked !== 'boolean') return false
  }
  return true
}

function validTheme(theme) {
  return (
    theme &&
    typeof theme.isDark === 'boolean' &&
    typeof theme.cssVars?.panelBg === 'string' &&
    typeof theme.cssVars?.toolbarBorder === 'string' &&
    typeof theme.cssVars?.textPrimary === 'string' &&
    typeof theme.cssVars?.textSecondary === 'string'
  )
}

function ok() {
  return { ok: true }
}

function fail(reason) {
  return { ok: false, reason }
}

export function validatePopoverSnapshot(snapshot) {
  if (!snapshot || !isPopoverId(snapshot.id) || !validTheme(snapshot.theme))
    return fail('invalid-snapshot')

  if (snapshot.id === 'visual') {
    if (typeof snapshot.merged !== 'boolean') return fail('invalid-merged')
    if (typeof snapshot.windowEnabled !== 'boolean') return fail('invalid-window-enabled')
    if (typeof snapshot.contentEnabled !== 'boolean') return fail('invalid-content-enabled')
    if (typeof snapshot.contentToggleDisabled !== 'boolean') {
      return fail('invalid-content-toggle-disabled')
    }
    if (
      !isFiniteNumber(snapshot.contentLevel) ||
      snapshot.contentLevel < MIN_INTERFACE_OPACITY ||
      snapshot.contentLevel > 0.95
    ) {
      return fail('invalid-content-level')
    }
    if (!isFiniteNumber(snapshot.zoom) || snapshot.zoom < 0.5 || snapshot.zoom > 2)
      return fail('invalid-zoom')
    if (
      !isFiniteNumber(snapshot.wheelSpeed) ||
      snapshot.wheelSpeed < 0.1 ||
      snapshot.wheelSpeed > 2
    )
      return fail('invalid-wheel-speed')
    if (typeof snapshot.plainView !== 'boolean') return fail('invalid-plain-view')
    if (typeof snapshot.hideMedia !== 'boolean') return fail('invalid-hide-media')
    return ok()
  }

  if (snapshot.id === 'encoding') {
    if (typeof snapshot.currentEncoding !== 'string' || !snapshot.currentEncoding)
      return fail('invalid-current-encoding')
    if (!isFiniteNumber(snapshot.confidence) || snapshot.confidence < 0 || snapshot.confidence > 1)
      return fail('invalid-confidence')
    if (
      !Array.isArray(snapshot.options) ||
      snapshot.options.some((item) => !ENCODINGS.includes(item))
    )
      return fail('invalid-options')
    return ok()
  }

  if (snapshot.id === 'pdf-zoom') {
    if (typeof snapshot.currentLabel !== 'string') return fail('invalid-current-label')
    if (!Array.isArray(snapshot.presets) || snapshot.presets.length === 0)
      return fail('invalid-presets')
    const invalidPreset = snapshot.presets.some((preset) => {
      if (!preset || typeof preset.label !== 'string') return true
      return preset.value !== 'fit-width' && !isFiniteNumber(preset.value)
    })
    if (invalidPreset) return fail('invalid-presets')
    return ok()
  }

  if (snapshot.id === 'address-suggestions') {
    if (!Array.isArray(snapshot.items) || snapshot.items.length > 5)
      return fail('invalid-address-items')
    for (const item of snapshot.items) {
      const itemValidation = validAddressSuggestionItem(item)
      if (itemValidation === 'invalid-id') return fail('invalid-address-item-id')
      if (itemValidation === 'private-url') return fail('invalid-address-item-private-url')
      if (!itemValidation) return fail('invalid-address-items')
    }
    if (!Number.isInteger(snapshot.activeIndex)) return fail('invalid-address-active-index')
    if (snapshot.activeIndex < -1 || snapshot.activeIndex >= snapshot.items.length)
      return fail('invalid-address-active-index')
    if (!isString(snapshot.fontSize) || !isString(snapshot.fontWeight))
      return fail('invalid-address-font')
    return ok()
  }

  if (snapshot.id === 'more-menu') {
    if (!Array.isArray(snapshot.items) || snapshot.items.length === 0)
      return fail('invalid-menu-items')
    if (snapshot.items.some((item) => !validMenuItem(item))) return fail('invalid-menu-items')
    return ok()
  }

  return fail('invalid-id')
}

export function validatePopoverAction(payload) {
  if (!payload || !isPopoverId(payload.id) || typeof payload.action !== 'string')
    return fail('invalid-action')
  if (!validOptionalRequestToken(payload)) return fail('invalid-request-token')

  if (payload.id === 'visual') {
    if (payload.closeAfter === true) return fail('invalid-close-after')
    if (payload.action === 'toggle-transparency') {
      const validKind = ['window', 'content', 'unified'].includes(payload.kind)
      return validKind && typeof payload.value === 'boolean'
        ? ok()
        : fail('invalid-transparency-toggle')
    }
    if (payload.action === 'set-zoom') {
      return isFiniteNumber(payload.value) && payload.value >= 0.5 && payload.value <= 2
        ? ok()
        : fail('invalid-zoom')
    }
    if (payload.action === 'set-content-level') {
      return isFiniteNumber(payload.value) &&
        payload.value >= MIN_INTERFACE_OPACITY &&
        payload.value <= 0.95
        ? ok()
        : fail('invalid-content-level')
    }
    if (payload.action === 'set-wheel-speed') {
      return isFiniteNumber(payload.value) && payload.value >= 0.1 && payload.value <= 2
        ? ok()
        : fail('invalid-wheel-speed')
    }
    if (payload.action === 'set-plain-view') {
      return typeof payload.value === 'boolean' ? ok() : fail('invalid-plain-view')
    }
    if (payload.action === 'set-hide-media') {
      return typeof payload.value === 'boolean' ? ok() : fail('invalid-hide-media')
    }
    if (payload.action === 'commit') return ok()
    return fail('invalid-visual-action')
  }

  if (payload.id === 'encoding') {
    if (payload.action !== 'select-encoding' || payload.closeAfter !== true)
      return fail('invalid-encoding-action')
    return typeof payload.value === 'string' && payload.value.length > 0
      ? ok()
      : fail('invalid-encoding')
  }

  if (payload.id === 'pdf-zoom') {
    if (payload.action !== 'select-preset' || payload.closeAfter !== true)
      return fail('invalid-pdf-action')
    return payload.value === 'fit-width' || isFiniteNumber(payload.value)
      ? ok()
      : fail('invalid-preset')
  }

  if (payload.id === 'address-suggestions') {
    if (payload.action === 'close') {
      return hasOnlyKeys(payload, ADDRESS_ACTION_KEYS.close)
        ? ok()
        : fail('invalid-address-action-fields')
    }
    if (payload.action === 'set-active-index' || payload.action === 'commit-suggestion') {
      if (!hasOnlyKeys(payload, ADDRESS_ACTION_KEYS[payload.action]))
        return fail('invalid-address-action-fields')
      if (!validAddressChildItemId(payload.itemId)) return fail('invalid-address-item-id')
      return Number.isInteger(payload.index) && payload.index >= 0
        ? ok()
        : fail('invalid-address-index')
    }
    return fail('invalid-address-action')
  }

  if (payload.id === 'more-menu') {
    if (payload.action === 'close') return ok()
    if (payload.action === 'command') {
      return MENU_COMMANDS.includes(payload.command) ? ok() : fail('invalid-menu-command')
    }
    return fail('invalid-menu-action')
  }

  return fail('invalid-id')
}

export function validateOpenPopoverPayload(payload) {
  if (!payload || !isPopoverId(payload.id)) return fail('invalid-id')
  if (!validOptionalRequestToken(payload)) return fail('invalid-request-token')
  if (!isPlacement(payload.placement)) return fail('invalid-placement')
  if (!isRect(payload.triggerRectDip)) return fail('invalid-trigger-rect')
  if (!isPositiveSize(payload.desiredSizeDip)) return fail('invalid-desired-size')
  if (!isPositiveSize(payload.mainWindowSizeDip)) return fail('invalid-main-size')
  const snapshotValidation = validatePopoverSnapshot(payload.snapshot)
  if (!snapshotValidation.ok) return snapshotValidation
  if (payload.snapshot.id !== payload.id) return fail('id-mismatch')
  return ok()
}

export function validateClosePopoverPayload(payload) {
  if (!payload || !isPopoverId(payload.id)) return fail('invalid-id')
  if (!validOptionalRequestToken(payload)) return fail('invalid-request-token')
  if (payload.reason !== undefined && !CLOSE_REASONS.includes(payload.reason))
    return fail('invalid-close-reason')
  return ok()
}

export function validateMeasureReadyPayload(payload) {
  if (!payload || !isPopoverId(payload.id)) return fail('invalid-id')
  if (!isPositiveSize(payload.sizeDip)) return fail('invalid-size')
  return ok()
}

export function validateUpdatePopoverPayload(payload) {
  if (payload?.snapshot) {
    if (!payload || !isPopoverId(payload.id)) return fail('invalid-id')
    if (payload.snapshot?.id !== payload.id) return fail('id-mismatch')
    return validateOpenPopoverPayload(payload)
  }
  return validatePopoverSnapshot(payload)
}
