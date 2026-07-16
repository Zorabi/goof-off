import { computed, ref } from 'vue'
import { canonicalizeWebUrl, webUrlsMatch } from '../../../shared/webUrlCanonical.js'
import { useAppState } from './useAppState.js'
import { useBrowser, extractDomain } from './useBrowser.js'
import { logDiagnostic, logDiagnosticError } from './useDiagnosticLog.js'
import { pushStatus } from './usePageMessages.js'
import { useSites } from './useSites.js'

const sitesLoaded = ref(false)
let refreshPromise = null

function bookmarkNameFor(title, url) {
  const pageTitle = String(title || '').trim()
  return pageTitle || extractDomain(url)
}

function firstMatchingSite(sites, url) {
  return sites.find((site) => webUrlsMatch(site?.url, url)) || null
}

function siteValidationDiagnosticUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { invalidUrl: true }
    }
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return { invalidUrl: true }
  }
}

export function useBookmark() {
  const { state } = useAppState()
  const { url, title } = useBrowser()
  const { customSites, refresh: refreshSites, add, remove } = useSites()
  const inFlight = ref(false)

  async function refresh() {
    if (sitesLoaded.value) return
    if (!refreshPromise) {
      refreshPromise = Promise.resolve(refreshSites())
        .then(() => {
          sitesLoaded.value = true
        })
        .catch((error) => {
          sitesLoaded.value = false
          logDiagnosticError('bookmark.refresh_result', error, {
            ok: false,
            reason: 'refresh-failed'
          })
        })
        .finally(() => {
          refreshPromise = null
        })
    }
    await refreshPromise
  }

  const canonicalUrl = computed(() => canonicalizeWebUrl(url.value))
  const matchedSite = computed(() => {
    if (!canonicalUrl.value) return null
    return firstMatchingSite(customSites.value, url.value)
  })
  const isBookmarked = computed(() => Boolean(matchedSite.value))
  const canBookmark = computed(
    () =>
      state.content === 'web' && Boolean(canonicalUrl.value) && sitesLoaded.value && !inFlight.value
  )

  async function toggleBookmark() {
    if (!canBookmark.value) return

    const currentUrl = url.value
    const currentTitle = title.value
    const site = matchedSite.value
    const removing = Boolean(site)
    inFlight.value = true

    try {
      if (removing) {
        await remove(site.id)
        pushStatus(`已取消收藏：${site.name}`)
        logDiagnostic('bookmark.toggle_result', {
          action: 'remove',
          ok: true,
          url: currentUrl,
          siteId: site.id
        })
        return
      }

      const created = await add({
        name: bookmarkNameFor(currentTitle, currentUrl),
        url: currentUrl
      })
      logDiagnostic('bookmark.toggle_result', {
        action: 'add',
        ok: true,
        url: currentUrl,
        siteId: created?.id
      })
    } catch (error) {
      if (!removing && error?.reason === 'invalid-url-scheme') {
        pushStatus('收藏失败：站点地址仅支持 http/https')
        logDiagnostic('sites.url_validation_result', {
          ok: false,
          reason: 'invalid-url-scheme',
          source: 'bookmark',
          url: siteValidationDiagnosticUrl(currentUrl)
        })
      } else {
        pushStatus(removing ? '取消收藏失败' : '收藏失败')
      }
      logDiagnosticError('bookmark.toggle_result', error, {
        action: removing ? 'remove' : 'add',
        ok: false,
        url: currentUrl,
        siteId: site?.id
      })
    } finally {
      inFlight.value = false
    }
  }

  return {
    isBookmarked,
    canBookmark,
    toggleBookmark,
    refresh
  }
}
