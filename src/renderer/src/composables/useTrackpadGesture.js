import { inject, provide } from 'vue'
import {
  classifyWheelGesture,
  createWheelGestureRecognizer
} from '../../../shared/trackpadGesture.js'
import { logDiagnostic } from './useDiagnosticLog.js'

const TRACKPAD_GESTURE_KEY = Symbol('trackpadGesture')
const INERT_SELECTOR = '[data-gesture-inert], [role="dialog"], [role="menu"], [aria-modal="true"]'

function unrefValue(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value
}

function elementIsEditable(element) {
  return (
    element?.isContentEditable ||
    element?.contentEditable === 'true' ||
    element?.getAttribute?.('contenteditable') === 'true'
  )
}

function activeElementBlocksGesture(doc) {
  const active = doc?.activeElement
  if (!active) return false
  const tag = active.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || elementIsEditable(active)
}

function targetBlocksGesture(target) {
  if (!target || typeof target.closest !== 'function') return false
  if (target.closest(INERT_SELECTOR)) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || elementIsEditable(target)
}

function documentBlocksGesture(doc) {
  if (!doc) return false
  if (doc.querySelector?.('dialog[open]')) return true
  return activeElementBlocksGesture(doc)
}

function readerOverlayBlocksGesture({ appState, txtCtrl, epubCtrl }) {
  if (appState.content !== 'file') return false
  if (appState.fileKind === 'txt') {
    return Boolean(
      unrefValue(txtCtrl?.showToc) ||
      unrefValue(txtCtrl?.showTypography) ||
      unrefValue(txtCtrl?.showSearch) ||
      unrefValue(txtCtrl?.showAutoTurnPanel)
    )
  }
  if (appState.fileKind === 'epub') {
    return Boolean(
      unrefValue(epubCtrl?.showToc) ||
      unrefValue(epubCtrl?.showSearch) ||
      unrefValue(epubCtrl?.showTypography) ||
      unrefValue(epubCtrl?.showAutoTurnPanel)
    )
  }
  return false
}

function shouldHandleState(appState) {
  if (appState.hidden === true) return false
  if (appState.content === 'home') return true
  if (appState.content !== 'file') return false
  return appState.fileKind === 'txt' || appState.fileKind === 'epub'
}

function routeGesture(direction, { appState, dispatch, txtCtrl, epubCtrl }) {
  if (appState.content === 'home') {
    if (direction === 'right') dispatch({ type: 'OPEN_HISTORY' })
    return
  }

  if (appState.fileKind === 'txt') {
    if (direction === 'right') (txtCtrl?.guardedNextPage ?? txtCtrl?.nextPage)?.()
    else if (direction === 'left') (txtCtrl?.guardedPrevPage ?? txtCtrl?.prevPage)?.()
    return
  }

  if (appState.fileKind === 'epub') {
    const mode = unrefValue(epubCtrl?.mode)
    if (mode === 'paginate') {
      if (direction === 'left') epubCtrl?.guardedNextPage?.()
      else if (direction === 'right') epubCtrl?.guardedPrevPage?.()
    } else if (direction === 'left') {
      epubCtrl?.guardedPrevChapter?.()
    } else if (direction === 'right') {
      epubCtrl?.guardedNextChapter?.()
    }
  }
}

export function createTrackpadGestureService({ appState, dispatch, txtCtrl, epubCtrl }) {
  const recognizer = createWheelGestureRecognizer()

  function shouldIgnore(event) {
    if (!shouldHandleState(appState)) return true
    if (classifyWheelGesture(event).type === 'zoom') return true

    const target = event.target
    const doc = target?.ownerDocument || document
    if (documentBlocksGesture(doc)) return true
    if (targetBlocksGesture(target)) return true
    if (readerOverlayBlocksGesture({ appState, txtCtrl, epubCtrl })) return true
    return false
  }

  function handleWheel(event, source = 'window') {
    if (shouldIgnore(event, source)) return false
    const result = recognizer.push(event)
    if (!result.consumed) return false
    event.preventDefault?.()
    if (result.direction) {
      logDiagnostic('trackpad.gesture', {
        source,
        direction: result.direction,
        content: appState.content,
        fileKind: appState.fileKind
      })
      routeGesture(result.direction, { appState, dispatch, txtCtrl, epubCtrl })
    }
    return true
  }

  return {
    handleWheel,
    reset: recognizer.reset,
    shouldIgnore
  }
}

export function provideTrackpadGesture(service) {
  provide(TRACKPAD_GESTURE_KEY, service)
  return service
}

export function injectTrackpadGesture() {
  return inject(TRACKPAD_GESTURE_KEY, null)
}
