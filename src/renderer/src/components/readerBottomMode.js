export function resolveReaderBottomMode(state = {}) {
  if (state.form === 'mini') return 'mini'
  if (state.content === 'web') return 'web'
  if (state.content === 'file') {
    if (state.fileKind === 'txt') return 'txt'
    if (state.fileKind === 'epub') return 'epub'
    if (state.fileKind === 'pdf') return 'pdf'
  }
  return 'shell'
}
