import { computed, unref } from 'vue'
import { CHROME_HOT_ZONE_HEIGHT } from '../../../shared/chromeLayoutModel.js'

export { CHROME_HOT_ZONE_HEIGHT }

function getValue(source, key, fallback) {
  const value = unref(source)
  return value?.[key] ?? fallback
}

function isNormalReadingContent(appState) {
  const content = getValue(appState, 'content', 'home')
  const form = getValue(appState, 'form', 'normal')
  return form === 'normal' && (content === 'web' || content === 'file')
}

function isMiniEligibleFileKind(appState) {
  const fileKind = getValue(appState, 'fileKind', null)
  return fileKind === 'txt' || fileKind === 'epub'
}

export function useChromeVisibility({
  appState,
  windowSize,
  pointer,
  webHotZones,
  topLocked,
  bottomLocked,
  toolbarAutoHideEnabled
}) {
  const isWeb = computed(() => getValue(appState, 'content', 'home') === 'web')
  const isMiniFile = computed(() => {
    return (
      getValue(appState, 'content', 'home') === 'file' &&
      getValue(appState, 'form', 'normal') === 'mini' &&
      isMiniEligibleFileKind(appState)
    )
  })
  const normalToolbarAutoHide = computed(
    () => isNormalReadingContent(appState) && unref(toolbarAutoHideEnabled) === true
  )
  const stealthEnabled = computed(() => normalToolbarAutoHide.value || isMiniFile.value)
  const usesDomHotZones = computed(
    () => (isWeb.value && normalToolbarAutoHide.value) || isMiniFile.value
  )
  const pointerInside = computed(() => getValue(pointer, 'inside', true))

  const inFileTopHotZone = computed(() => {
    if (!pointerInside.value) return false
    return getValue(pointer, 'y', Number.POSITIVE_INFINITY) < CHROME_HOT_ZONE_HEIGHT
  })

  const inFileBottomHotZone = computed(() => {
    if (!pointerInside.value) return false
    const height = getValue(windowSize, 'height', 0)
    return getValue(pointer, 'y', Number.NEGATIVE_INFINITY) >= height - CHROME_HOT_ZONE_HEIGHT
  })

  const inTopHotZone = computed(() => {
    if (!stealthEnabled.value) return true
    if (usesDomHotZones.value) return Boolean(getValue(webHotZones, 'top', false))
    return inFileTopHotZone.value
  })

  const inBottomHotZone = computed(() => {
    if (!stealthEnabled.value) return true
    if (usesDomHotZones.value) return Boolean(getValue(webHotZones, 'bottom', false))
    return inFileBottomHotZone.value
  })

  const topVisible = computed(() => {
    if (!stealthEnabled.value) return true
    return Boolean(unref(topLocked)) || inTopHotZone.value
  })

  const bottomVisible = computed(() => {
    if (!stealthEnabled.value) return true
    return Boolean(unref(bottomLocked)) || inBottomHotZone.value
  })

  const topInteractive = computed(() => topVisible.value)
  const bottomInteractive = computed(() => bottomVisible.value)
  const topSolid = computed(() => {
    if (!stealthEnabled.value) return false
    return Boolean(unref(topLocked)) || inTopHotZone.value
  })
  const bottomSolid = computed(() => {
    if (!stealthEnabled.value) return false
    return Boolean(unref(bottomLocked)) || inBottomHotZone.value
  })

  return {
    stealthEnabled,
    topVisible,
    bottomVisible,
    topInteractive,
    bottomInteractive,
    topSolid,
    bottomSolid,
    inTopHotZone,
    inBottomHotZone
  }
}
