export function resolveFramePolicy({
  effectiveOpacity,
  shellBackgroundHidden,
  interfaceOpacity,
  borderlessActive = false
} = {}) {
  const windowOpacity = effectiveOpacity?.windowOpacity ?? 1
  const resolvedShellBackgroundHidden =
    shellBackgroundHidden ?? effectiveOpacity?.shellBackgroundHidden ?? false
  const resolvedInterfaceOpacity =
    interfaceOpacity ?? effectiveOpacity?.interfaceOpacity ?? effectiveOpacity?.contentOpacity ?? 1
  const legacyOpacityActive = windowOpacity < 1
  const transparencyActive =
    resolvedShellBackgroundHidden === true || resolvedInterfaceOpacity < 1 || legacyOpacityActive
  return {
    shouldHideShadow: transparencyActive || borderlessActive,
    frameAlpha: transparencyActive ? 0.025 * resolvedInterfaceOpacity : 0.05
  }
}
