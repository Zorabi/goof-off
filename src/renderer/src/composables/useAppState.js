import { reactive, inject, provide } from 'vue'
import { initialState, reduce } from './appStateReducer.js'
import { logDiagnostic } from './useDiagnosticLog.js'

const KEY = Symbol('appState')

function stateSummary(state) {
  return {
    content: state.content,
    fileKind: state.fileKind,
    form: state.form,
    hidden: state.hidden,
    lastHomeEntrySource: state.lastHomeEntrySource
  }
}

function actionSummary(action = {}) {
  const summary = { type: action.type }
  if (action.type === 'LOAD_URL') summary.url = action.payload?.url
  if (action.type === 'OPEN_FILE') summary.kind = action.payload?.kind
  if (action.type === 'HYDRATE') summary.payload = stateSummary(action.payload || {})
  return summary
}

export function provideAppState() {
  const state = reactive(initialState())

  function dispatch(action) {
    const before = stateSummary(state)
    const next = reduce(state, action)
    const changed = next !== state
    if (changed) Object.assign(state, next)
    logDiagnostic('state.dispatch', {
      action: actionSummary(action),
      changed,
      before,
      after: stateSummary(state)
    })
  }

  const api = { state, dispatch }
  provide(KEY, api)
  return api
}

export function useAppState() {
  const api = inject(KEY)
  if (!api) {
    throw new Error('useAppState() called outside provideAppState() root')
  }
  return api
}
