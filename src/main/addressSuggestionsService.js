import { canonicalizeWebUrl } from '../shared/webUrlCanonical.js'

function asText(value) {
  return String(value || '').trim()
}

function displayUrlFor(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return `${url.host.replace(/^www\./, '')}${url.pathname || '/'}`
  } catch {
    return ''
  }
}

function targetUrlForNavigation(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function hostFor(input) {
  try {
    const url = new URL(String(input || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.host.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function matchesQuery(candidate, query) {
  const q = query.toLowerCase()
  return (
    candidate.label.toLowerCase().includes(q) ||
    candidate.displayUrl.toLowerCase().includes(q) ||
    candidate.host.toLowerCase().includes(q)
  )
}

function siteCandidate(site) {
  const rawUrl = asText(site?.url)
  const canonicalUrl = canonicalizeWebUrl(rawUrl)
  if (!canonicalUrl) return null
  const targetUrl = targetUrlForNavigation(rawUrl)
  const label = asText(site?.name) || displayUrlFor(targetUrl)
  return {
    id: `site:${site.id || canonicalUrl}`,
    source: 'site',
    label,
    displayUrl: displayUrlFor(targetUrl),
    targetUrl,
    host: hostFor(targetUrl),
    canonicalUrl,
    lastOpenedAt: Number.MAX_SAFE_INTEGER
  }
}

function historyCandidate(item) {
  const rawUrl = asText(item?.url)
  const canonicalUrl = canonicalizeWebUrl(rawUrl)
  if (!canonicalUrl) return null
  const targetUrl = targetUrlForNavigation(rawUrl)
  return {
    id: `history:${item.id || canonicalUrl}`,
    source: 'history',
    label: asText(item?.title) || displayUrlFor(targetUrl),
    displayUrl: displayUrlFor(targetUrl),
    targetUrl,
    host: hostFor(targetUrl),
    canonicalUrl,
    lastOpenedAt: Number.isFinite(item?.lastOpenedAt) ? item.lastOpenedAt : 0
  }
}

function matchKind(candidate, query) {
  const q = query.toLowerCase()
  const fields = [
    candidate.label.toLowerCase(),
    candidate.displayUrl.toLowerCase(),
    candidate.host.toLowerCase()
  ]
  if (fields.some((field) => field === q)) return 'exact'
  if (fields.some((field) => field.startsWith(q))) return 'starts'
  return 'contains'
}

function score(candidate, query) {
  const kind = matchKind(candidate, query)
  if (candidate.source === 'site') {
    if (kind === 'exact') return 600
    if (kind === 'starts') return 500
    return 350
  }
  if (kind === 'exact') return 550
  if (kind === 'starts') return 300
  return 200
}

export function getAddressSuggestions({ query, limit = 5, historyService, sitesService }) {
  const cleanQuery = asText(query)
  const cappedLimit = Math.min(5, Math.max(0, Number(limit) || 5))
  if (!cleanQuery || cappedLimit <= 0) {
    return { ok: true, items: [], meta: { historyCount: 0, siteCount: 0 } }
  }

  const siteItems = (sitesService.list() || []).map(siteCandidate).filter(Boolean)
  const historyItems = (historyService.list()?.web || []).map(historyCandidate).filter(Boolean)
  const candidates = [...siteItems, ...historyItems]
    .filter((candidate) => matchesQuery(candidate, cleanQuery))
    .sort((a, b) => {
      const scoreDiff = score(b, cleanQuery) - score(a, cleanQuery)
      if (scoreDiff) return scoreDiff
      return b.lastOpenedAt - a.lastOpenedAt
    })

  const seen = new Set()
  const items = []
  for (const candidate of candidates) {
    if (seen.has(candidate.canonicalUrl)) continue
    seen.add(candidate.canonicalUrl)
    items.push({
      id: candidate.id,
      source: candidate.source,
      label: candidate.label,
      displayUrl: candidate.displayUrl,
      targetUrl: candidate.targetUrl
    })
    if (items.length >= cappedLimit) break
  }

  return {
    ok: true,
    items,
    meta: {
      historyCount: items.filter((item) => item.source === 'history').length,
      siteCount: items.filter((item) => item.source === 'site').length
    }
  }
}
