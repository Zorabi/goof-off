import { extractDomain } from '../composables/useBrowser.js'

const GROUP_ORDER = [
  { key: 'today', title: '今天' },
  { key: 'yesterday', title: '昨天' },
  { key: 'this_week', title: '本周' },
  { key: 'earlier', title: '更早' }
]

const FILE_KIND_LABELS = {
  txt: 'TXT',
  epub: 'EPUB',
  pdf: 'PDF'
}

const WEB_TONES = ['tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f']

function toFiniteTimestamp(value) {
  const ts = Number(value)
  return Number.isFinite(ts) ? ts : 0
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function startOfLocalDay(ts) {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfLocalWeek(ts) {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()
  const diff = day === 0 ? 6 : day - 1
  date.setDate(date.getDate() - diff)
  return date.getTime()
}

export function historyGroupKey(ts, now = Date.now()) {
  const value = toFiniteTimestamp(ts)
  if (value <= 0) return 'earlier'
  const day = startOfLocalDay(value)
  const today = startOfLocalDay(toFiniteTimestamp(now) || Date.now())
  if (day === today) return 'today'
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === yesterday.getTime()) return 'yesterday'
  const weekStart = startOfLocalWeek(today)
  if (day >= weekStart) return 'this_week'
  return 'earlier'
}

function formatClock(ts) {
  const date = new Date(ts)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function formatShortDate(ts) {
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function formatHistoryRight(ts, now = Date.now()) {
  const value = toFiniteTimestamp(ts)
  if (value <= 0) return ''
  const groupKey = historyGroupKey(value, now)
  return groupKey === 'today' || groupKey === 'yesterday'
    ? formatClock(value)
    : formatShortDate(value)
}

export function filePathTail(path, name = '') {
  const parts =
    typeof path === 'string'
      ? path
          .split(/[\\/]+/)
          .map((part) => part.trim())
          .filter(Boolean)
      : []
  if (!parts.length) return name || ''
  const tail = parts.slice(-2).join('/')
  return parts.length > 2 ? `.../${tail}` : tail
}

function webTitle(item) {
  return item?.title || extractDomain(item?.url)
}

function webMarkerLabel(domain) {
  const normalized = String(domain || '').replace(/^www\./i, '')
  return (normalized[0] || 'W').toUpperCase()
}

function toneForText(text) {
  const source = String(text || '')
  const sum = Array.from(source).reduce((total, char) => total + char.charCodeAt(0), 0)
  return WEB_TONES[sum % WEB_TONES.length]
}

function fileBaseName(path) {
  if (typeof path !== 'string') return ''
  const parts = path
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.at(-1) || ''
}

function stripFileExtension(name) {
  const normalized = String(name || '').trim()
  const dotIndex = normalized.lastIndexOf('.')
  return dotIndex > 0 ? normalized.slice(0, dotIndex) : normalized
}

function fileMainTitle(item, fallback) {
  return stripFileExtension(item?.name || fileBaseName(item?.path) || fallback)
}

function createWebRow(item, now) {
  const domain = extractDomain(item?.url)
  return {
    id: item?.id || `web:${item?.url || ''}:${item?.lastOpenedAt || ''}`,
    type: 'web',
    item,
    title: webTitle(item),
    subtitle: domain,
    right: formatHistoryRight(item?.lastOpenedAt, now),
    markerLabel: webMarkerLabel(domain),
    markerTone: toneForText(domain)
  }
}

function createFileRow(item, now) {
  const kind = String(item?.kind || '').toLowerCase()
  const label = FILE_KIND_LABELS[kind] || 'FILE'
  const title = fileMainTitle(item, label)
  return {
    id: item?.id || `file:${item?.path || ''}:${item?.lastOpenedAt || ''}`,
    type: 'files',
    item,
    title,
    subtitle: filePathTail(item?.path, title),
    right: formatHistoryRight(item?.lastOpenedAt, now),
    markerLabel: label,
    markerTone: `file-${kind || 'unknown'}`
  }
}

export function createHistoryGroups(items, type, options = {}) {
  const now = toFiniteTimestamp(options.now) || Date.now()
  const rows = (Array.isArray(items) ? items : []).map((item) =>
    type === 'files' ? createFileRow(item, now) : createWebRow(item, now)
  )
  const groups = GROUP_ORDER.map((group) => ({
    ...group,
    rows: rows.filter((row) => historyGroupKey(row.item?.lastOpenedAt, now) === group.key)
  }))
  return groups.filter((group) => group.rows.length > 0)
}
