function cssVarFrom(element, name) {
  if (!element) return ''
  return getComputedStyle(element).getPropertyValue(name).trim()
}

function firstCssVar(name, elements) {
  for (const element of elements) {
    const value = cssVarFrom(element, name)
    if (value) return value
  }
  return ''
}

export function buildThemeSnapshot(isDark = document.documentElement.classList.contains('dark')) {
  const root = document.documentElement
  const appContainer = document.querySelector('.app-container')
  const body = document.body
  const effectiveSources = [
    ...(body?.classList.contains('goof-off-main-window-surface') ? [body] : []),
    appContainer,
    root
  ].filter(Boolean)
  const legacySources = [root, document.body, appContainer].filter(Boolean)
  const panelMaterialBlur = firstCssVar('--panel-material-blur', legacySources)

  return {
    isDark,
    cssVars: {
      panelBg: firstCssVar('--panel-bg', legacySources),
      toolbarBorder: firstCssVar('--toolbar-border', legacySources),
      textPrimary: firstCssVar('--text-primary', legacySources),
      textSecondary: firstCssVar('--text-secondary', legacySources),
      effectivePopoverBg:
        firstCssVar('--effective-popover-bg', effectiveSources) ||
        firstCssVar('--panel-bg', legacySources),
      effectivePopoverBorder:
        firstCssVar('--effective-popover-border', effectiveSources) ||
        firstCssVar('--toolbar-border', legacySources),
      effectivePopoverHoverBg:
        firstCssVar('--effective-popover-hover-bg', effectiveSources) ||
        firstCssVar('--color-hover-bg', legacySources),
      effectivePopoverShadow:
        firstCssVar('--effective-popover-shadow', effectiveSources) ||
        firstCssVar('--shadow-float', legacySources),
      effectivePopoverBackdropFilter:
        firstCssVar('--effective-popover-backdrop-filter', effectiveSources) ||
        (panelMaterialBlur ? `blur(${panelMaterialBlur})` : '')
    }
  }
}

export function createVisualActionScheduler(applyAction, delay = 50) {
  let timer = null
  let pending = null

  function schedule(action) {
    pending = action
    if (timer) return
    timer = setTimeout(commit, delay)
  }

  function commit() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return
    const action = pending
    pending = null
    applyAction(action)
  }

  function dispose() {
    commit()
  }

  return { schedule, commit, dispose }
}
