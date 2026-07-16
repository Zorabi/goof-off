import { ref } from 'vue'
import { useAppState } from './useAppState.js'
import { pushStatus } from './usePageMessages.js'
import {
  beginOpenRequest,
  clearOpenRequest,
  hasActiveOpenRequest,
  isCurrentOpenRequest
} from './openRequestGuard.js'
import {
  normalizeWebStateUrl,
  resolveWebStateUrl,
  shouldEnterWebState,
  urlsEqual
} from './webOpenResult.js'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'
import { extractAddressDomain, normalizeAddressInput } from './addressInputModel.js'

const url = ref('')
const title = ref('')
const loading = ref(false)
const canBack = ref(false)
const canForward = ref(false)

let appStateRef = null
let bootstrapped = false

function normalizeRecoverableWebIntentUrl(input) {
  try {
    const next = new URL(String(input || ''))
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return null
    const normalized = next.toString()
    return normalized && normalized !== 'about:blank' ? normalized : null
  } catch {
    return null
  }
}

async function writeWebIntent(nextUrl) {
  const intentUrl = normalizeRecoverableWebIntentUrl(nextUrl)
  if (!intentUrl) return
  await window.api.startupRestoreSet?.({ type: 'web', url: intentUrl })
}

function shouldShowRendererOpenFailure(result) {
  return result?.reason === 'invalid-url' || result?.reason === 'not-ready'
}

function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  window.api.onBrowserNavState((state) => {
    url.value = state.url
    title.value = state.title
    loading.value = state.loading
    canBack.value = state.canBack
    canForward.value = state.canForward
    if (
      state.restoreWritable === true &&
      appStateRef?.content === 'web' &&
      !hasActiveOpenRequest()
    ) {
      writeWebIntent(state.url).catch((e) => {
        console.warn('[useBrowser] web intent write failed:', e)
        logDiagnosticError('web.intent_write_failed', e, { url: state.url })
      })
    }
  })
}

export function normalize(input) {
  return normalizeAddressInput(input)
}

export function extractDomain(input) {
  return extractAddressDomain(input)
}

export function useBrowser() {
  const { state, dispatch } = useAppState()
  appStateRef = state
  bootstrap()

  async function openSite(siteUrl, opts = {}) {
    const requestId = beginOpenRequest('web')
    const requestedUrl = normalizeWebStateUrl(siteUrl)
    let openSettled = false
    let enteredRequestedState = false
    logDiagnostic('web.open.request', {
      url: siteUrl,
      silent: opts.silent === true
    })
    try {
      const openResult = Promise.resolve(
        window.api.browserOpen(siteUrl, {
          silentPageMessages: opts.silent === true
        })
      ).then((result) => {
        openSettled = true
        return result
      })
      if (requestedUrl) {
        await Promise.resolve()
        if (!openSettled && isCurrentOpenRequest(requestId)) {
          dispatch({ type: 'LOAD_URL', payload: { url: requestedUrl } })
          enteredRequestedState = true
        }
      }
      const result = (await openResult) || {
        ok: false,
        reason: 'load-error',
        message: '网页加载失败'
      }
      if (!isCurrentOpenRequest(requestId)) {
        const staleResult = { ok: false, reason: 'stale' }
        logDiagnostic('web.open.result', {
          ok: false,
          reason: staleResult.reason,
          url: undefined
        })
        return staleResult
      }
      if (shouldEnterWebState(result)) {
        const stateUrl = resolveWebStateUrl(result, siteUrl)
        if (
          !enteredRequestedState ||
          (requestedUrl && result?.ok && !urlsEqual(stateUrl, requestedUrl))
        ) {
          dispatch({ type: 'LOAD_URL', payload: { url: stateUrl } })
        }
        if (!result?.ok) {
          logDiagnostic('web.open.result', {
            ok: Boolean(result?.ok),
            reason: result?.reason,
            url: result?.url
          })
          return result
        }
        await writeWebIntent(result.url)
        logDiagnostic('web.open.result', {
          ok: Boolean(result?.ok),
          reason: result?.reason,
          url: result?.url
        })
        return result
      }
      if (!opts.silent && shouldShowRendererOpenFailure(result)) {
        pushStatus(result?.message || '网页加载失败')
      }
      logDiagnostic('web.open.result', {
        ok: Boolean(result?.ok),
        reason: result?.reason,
        url: result?.url
      })
      return result
    } finally {
      clearOpenRequest(requestId)
    }
  }
  async function openURL(input) {
    const norm = normalize(input)
    if (!norm) return
    await openSite(norm)
  }
  async function goHome() {
    dispatch({ type: 'NAVIGATE_HOME' })
    await window.api.browserHome()
  }
  async function goBack() {
    await window.api.browserBack()
  }
  async function goForward() {
    await window.api.browserForward()
  }
  async function reload() {
    await window.api.browserReload()
  }

  async function notifyPopover(open, height = 0) {
    await window.api.browserPopoverZone(open ? height : 0)
  }

  return {
    state,
    url,
    title,
    loading,
    canBack,
    canForward,
    openSite,
    openURL,
    goHome,
    goBack,
    goForward,
    reload,
    notifyPopover
  }
}
