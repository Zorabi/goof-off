import { onMounted, onUnmounted } from 'vue'
import { eventMatchesPageKeyDescriptor } from '../../../shared/pageKeyDescriptor.js'
import {
  eventHasForbiddenPageKeyModifier,
  eventUsesPrimaryModifier,
  resolvePlatformPolicy
} from '../../../shared/platformPolicy.js'

const DEFAULT_PAGE_KEYS = { next: 'Space', prev: 'Shift+Space' }

export function shouldIgnoreShortcut(e, ctrl) {
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (document.activeElement?.isContentEditable) return true
  if (document.querySelector('dialog[open]')) return true
  if (e.isComposing) return true
  if (ctrl.showSearch?.value) return true
  if (ctrl.showToc.value || ctrl.showTypography?.value || ctrl.showAutoTurnPanel?.value) return true
  return false
}

function resolvePlatformPolicyOption(options = {}) {
  return resolvePlatformPolicy(
    options.platformPolicy?.value?.platform ||
      options.platformPolicy?.platform ||
      window.api?.platformPolicy?.platform
  )
}

function isPrimaryF(e, policy) {
  return eventUsesPrimaryModifier(e, policy) && !e.altKey && String(e.key).toLowerCase() === 'f'
}

function isMiniOption(options) {
  return Boolean(options.isMini?.value ?? options.isMini)
}

function resolvePageKeys(pageKeys) {
  return pageKeys?.value || pageKeys || DEFAULT_PAGE_KEYS
}

export function createKeydownHandler(ctrl, options = {}) {
  const pageKeys = options.pageKeys || DEFAULT_PAGE_KEYS
  const platformPolicy = resolvePlatformPolicyOption(options)
  return function onKeydown(e) {
    if (isPrimaryF(e, platformPolicy)) {
      const blockedByModal = document.querySelector('dialog[open]') || e.isComposing
      if (!blockedByModal && !isMiniOption(options)) {
        e.preventDefault?.()
        ctrl.toggleSearch?.()
      }
      return
    }
    if (shouldIgnoreShortcut(e, ctrl)) return
    const key = e.key
    const keys = resolvePageKeys(pageKeys)
    const usesPrimaryModifier = eventUsesPrimaryModifier(e, platformPolicy)
    const canUseFixedNavigation =
      !eventHasForbiddenPageKeyModifier(e, platformPolicy) && !usesPrimaryModifier

    if (
      eventMatchesPageKeyDescriptor(e, keys.next, platformPolicy) ||
      (canUseFixedNavigation && key === 'PageDown')
    ) {
      e.preventDefault()
      ctrl.guardedNextPage()
    } else if (
      eventMatchesPageKeyDescriptor(e, keys.prev, platformPolicy) ||
      (canUseFixedNavigation && key === 'PageUp')
    ) {
      e.preventDefault()
      ctrl.guardedPrevPage()
    } else if (canUseFixedNavigation && key === 'ArrowDown') {
      e.preventDefault()
      ctrl.guardedScrollDown()
    } else if (canUseFixedNavigation && key === 'ArrowUp') {
      e.preventDefault()
      ctrl.guardedScrollUp()
    } else if (canUseFixedNavigation && key === 'ArrowRight') {
      e.preventDefault()
      ctrl.guardedNextChapter()
    } else if (canUseFixedNavigation && key === 'ArrowLeft') {
      e.preventDefault()
      ctrl.guardedPrevChapter()
    }
  }
}

export function useEpubKeyboard(ctrl, options = {}) {
  const handler = createKeydownHandler(ctrl, options)
  let rendition = null

  function attachToRendition(r) {
    rendition = r
    rendition.on('keydown', handler)
  }

  function detachFromRendition() {
    if (rendition) {
      rendition.off('keydown', handler)
      rendition = null
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handler)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handler)
    detachFromRendition()
  })

  return { attachToRendition, detachFromRendition }
}
