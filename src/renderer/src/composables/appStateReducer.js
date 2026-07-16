export function initialState() {
  return {
    content: 'home',
    form: 'normal',
    hidden: false,
    fileKind: null,
    lastHomeEntrySource: null
  }
}

function isMiniFileKind(kind) {
  return kind === 'txt' || kind === 'epub'
}

function canEnterMini(state) {
  return state.content === 'file' && isMiniFileKind(state.fileKind)
}

function resolveHomeEntrySource(state) {
  if (state.content === 'web') return 'web'
  if (state.content === 'file') return 'files'
  return state.lastHomeEntrySource ?? null
}

export function reduce(state, action) {
  if (
    state.hidden &&
    action.type !== 'BOSS_RESTORE' &&
    !(action.type === 'MAINTENANCE_RESET_HOME' && action.meta?.trusted === true)
  ) {
    return state
  }

  switch (action.type) {
    case 'HYDRATE': {
      const p = action.payload || {}
      return {
        content: p.content === 'history' ? 'home' : (p.content ?? state.content),
        fileKind: p.fileKind ?? state.fileKind,
        form: 'normal',
        hidden: false,
        lastHomeEntrySource: state.lastHomeEntrySource ?? null
      }
    }
    case 'NAVIGATE_HOME':
      return {
        ...state,
        content: 'home',
        fileKind: null,
        form: 'normal',
        lastHomeEntrySource: resolveHomeEntrySource(state)
      }

    case 'MAINTENANCE_RESET_HOME':
      if (action.meta?.trusted !== true) return state
      return { ...state, content: 'home', fileKind: null, form: 'normal' }

    case 'OPEN_HISTORY':
      return { ...state, content: 'history', form: 'normal' }

    case 'LOAD_URL':
      return { ...state, content: 'web', fileKind: null, form: 'normal' }

    case 'OPEN_FILE': {
      const fileKind = action.payload?.kind ?? null
      return {
        ...state,
        content: 'file',
        fileKind,
        form: isMiniFileKind(fileKind) ? state.form : 'normal'
      }
    }

    case 'TOGGLE_MINI':
      if (!canEnterMini(state) && state.form !== 'mini') return state
      return { ...state, form: state.form === 'mini' ? 'normal' : 'mini' }

    case 'BOSS_HIDE':
      return { ...state, hidden: true }

    case 'BOSS_RESTORE':
      return { ...state, hidden: false }

    default:
      return state
  }
}
