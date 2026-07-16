import { eventMatchesPageKeyDescriptor } from '../../../shared/pageKeyDescriptor.js'
import {
  eventHasForbiddenPageKeyModifier,
  eventUsesPrimaryModifier,
  resolvePlatformPolicy
} from '../../../shared/platformPolicy.js'

const DEFAULT_PAGE_KEYS = { next: 'Space', prev: 'Shift+Space' }

export function shouldIgnoreShortcut(e, ctrl) {
  const tag = document.activeElement?.tagName
  if (document.querySelector('dialog[open]')) return true
  if (e.isComposing) return true
  if (ctrl.showSearch?.value) return true
  if (ctrl.showToc.value || ctrl.showTypography?.value || ctrl.showAutoTurnPanel?.value) {
    if (e.key === 't' || e.key === 'T') return false
    return true
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (document.activeElement?.isContentEditable) return true
  return false
}

function resolvePageKeys(pageKeys) {
  return pageKeys?.value || pageKeys || DEFAULT_PAGE_KEYS
}

function resolveMaybeRef(value) {
  return value?.value ?? value
}

function resolvePlatformPolicyOption(options = {}) {
  return resolvePlatformPolicy(
    options.platformPolicy?.value?.platform ||
      options.platformPolicy?.platform ||
      window.api?.platformPolicy?.platform
  )
}

function isSearchShortcut(event, policy) {
  return (
    eventUsesPrimaryModifier(event, policy) &&
    !event.altKey &&
    String(event.key || '').toLowerCase() === 'f'
  )
}

export function createKeydownHandler(ctrl, options = {}) {
  const {
    nextPage,
    prevPage,
    goToTop,
    goToEnd,
    pageKeys = DEFAULT_PAGE_KEYS,
    isMini = false
  } = options
  const platformPolicy = resolvePlatformPolicyOption(options)
  return function onKeydown(e) {
    const key = e.key
    const isPrimarySearchShortcut = isSearchShortcut(e, platformPolicy)
    const usesPrimaryModifier = eventUsesPrimaryModifier(e, platformPolicy)
    const canUseFixedNavigation =
      !eventHasForbiddenPageKeyModifier(e, platformPolicy) && !usesPrimaryModifier
    if (isPrimarySearchShortcut) {
      const blockedByModal = document.querySelector('dialog[open]') || e.isComposing
      if (!blockedByModal && !resolveMaybeRef(isMini)) {
        e.preventDefault()
        ctrl.toggleSearch?.()
      }
      return
    }

    if (shouldIgnoreShortcut(e, ctrl)) return
    const keys = resolvePageKeys(pageKeys)

    if (
      eventMatchesPageKeyDescriptor(e, keys.next, platformPolicy) ||
      (canUseFixedNavigation && (key === 'PageDown' || key === 'ArrowRight' || key === 'ArrowDown'))
    ) {
      e.preventDefault()
      nextPage()
    } else if (
      eventMatchesPageKeyDescriptor(e, keys.prev, platformPolicy) ||
      (canUseFixedNavigation && (key === 'PageUp' || key === 'ArrowLeft' || key === 'ArrowUp'))
    ) {
      e.preventDefault()
      prevPage()
    } else if (key === 'Home') {
      e.preventDefault()
      goToTop()
    } else if (key === 'End') {
      e.preventDefault()
      goToEnd()
    } else if (key === 't' || key === 'T') {
      e.preventDefault()
      ctrl.toggleToc()
    } else if (key === 'a' || key === 'A') {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('txt:toggle-auto-turn'))
    }
  }
}
