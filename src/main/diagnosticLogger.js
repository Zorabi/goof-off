import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { sanitizeDiagnosticEvent } from './diagnosticSanitizer.js'
import { normalizeDiagnosticPrefs } from './preferencesModel.js'

const require = createRequire(import.meta.url)
const MB = 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 5 * MB
const DEFAULT_MAX_DAILY_FILES = 3
const DEFAULT_MAX_TOTAL_BYTES = 30 * MB
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

function getDefaultLogsDir() {
  try {
    const electron = require('electron')
    if (electron?.app?.getPath) return path.join(electron.app.getPath('userData'), 'logs')
  } catch {
    // Tests and non-Electron tooling fall back to a local logs directory.
  }
  return path.join(process.cwd(), 'logs')
}

function localDateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)

  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  )
}

function offsetFor(date, parts) {
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    date.getMilliseconds()
  )
  return Math.round((localAsUtc - date.getTime()) / 60000)
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(minutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const remainder = String(absolute % 60).padStart(2, '0')
  return `${sign}${hours}:${remainder}`
}

function formatLocalTimestamp(date, timeZone) {
  const parts = localDateTimeParts(date, timeZone)
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}${formatOffset(offsetFor(date, parts))}`
}

function dateKey(date, timeZone) {
  const parts = localDateTimeParts(date, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function fileNameFor(date, shard = 0) {
  return shard === 0 ? `diagnostic-${date}.log` : `diagnostic-${date}.${shard}.log`
}

function dateFromLogName(name) {
  return /^diagnostic-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.log$/.exec(name)?.[1] || null
}

async function safeStat(fsApi, filePath) {
  try {
    return await fsApi.stat(filePath)
  } catch {
    return null
  }
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function clipDegradedString(value, maxString = 240) {
  if (!value) return undefined
  const text = String(value)
  return text.length > maxString ? `${text.slice(0, maxString)}...[truncated]` : text
}

function summarizeDegradedError(error) {
  if (!error || typeof error !== 'object') return undefined
  return compactObject({
    name: clipDegradedString(error.name || 'Error', 80),
    message: clipDegradedString(error.message, 240),
    stack: clipDegradedString(error.stack, 360)
  })
}

function buildDegradedData(data = {}) {
  return compactObject({
    ok: data.ok,
    reason: clipDegradedString(data.reason, 160),
    error: summarizeDegradedError(data.error)
  })
}

async function isStoreDiagnosticLoggingEnabled() {
  const { default: store } = await import('./store.js')
  return normalizeDiagnosticPrefs(store.get('diagnosticPrefs')).enabled
}

export function createDiagnosticLogger(options = {}) {
  const fsApi = options.fsApi || fsp
  const now = options.now || (() => new Date())
  const projectRoot = options.projectRoot || process.cwd()
  const sessionId = options.sessionId || crypto.randomUUID()
  const logsDir = options.logsDir || getDefaultLogsDir()
  const timeZone = options.timeZone || DEFAULT_TIME_ZONE
  const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES
  const maxDailyFiles = options.maxDailyFiles || DEFAULT_MAX_DAILY_FILES
  const maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES
  const isEnabled = options.isEnabled || (() => true)
  let droppedInfoCount = 0
  let writeChain = Promise.resolve()
  let activeDate = dateKey(now(), timeZone)
  let activeShard = 0
  // 目录只需保证一次；文件大小仍须逐次探测，因为其它应用实例可能写入同一分片。
  let ensuredDir = false

  async function ensureDir() {
    if (ensuredDir) return
    await fsApi.mkdir(logsDir, { recursive: true })
    ensuredDir = true
  }

  function activeLogPath() {
    return path.join(logsDir, fileNameFor(activeDate, activeShard))
  }

  function buildLine(safe, extra = {}) {
    return (
      JSON.stringify({
        ts: formatLocalTimestamp(now(), timeZone),
        sessionId,
        process: safe.process,
        level: safe.level,
        event: safe.event,
        data: compactObject(safe.data || {}),
        truncated: safe.truncated,
        dropped: extra.dropped,
        degraded: extra.degraded
      }) + '\n'
    )
  }

  function buildDegradedLine(safe, dropped) {
    return buildLine(
      {
        process: safe.process,
        level: safe.level,
        event: safe.event,
        data: buildDegradedData(safe.data),
        truncated: true
      },
      { dropped, degraded: true }
    )
  }

  async function chooseWritablePath(bytes) {
    const today = dateKey(now(), timeZone)
    if (today !== activeDate) {
      activeDate = today
      activeShard = 0
    }

    const startShard = activeShard
    let candidateShard = activeShard
    while (candidateShard < maxDailyFiles) {
      const candidate = path.join(logsDir, fileNameFor(activeDate, candidateShard))
      const stat = await safeStat(fsApi, candidate)
      if (!stat && bytes <= maxFileBytes) {
        activeShard = candidateShard
        return candidate
      }
      if (stat && stat.size + bytes <= maxFileBytes) {
        activeShard = candidateShard
        return candidate
      }
      candidateShard += 1
    }
    activeShard = startShard
    return null
  }

  async function appendIfCapacity(line) {
    const target = await chooseWritablePath(Buffer.byteLength(line))
    if (!target) return null
    await fsApi.appendFile(target, line)
    return target
  }

  async function cleanup() {
    await ensureDir()
    const names = (await fsApi.readdir(logsDir)).filter((name) =>
      /^diagnostic-\d{4}-\d{2}-\d{2}(\.\d+)?\.log$/.test(name)
    )
    const cutoff = now().getTime() - 7 * 24 * 60 * 60 * 1000
    const cutoffDate = dateKey(new Date(cutoff), timeZone)
    const entries = []
    for (const name of names) {
      const filePath = path.join(logsDir, name)
      const stat = await safeStat(fsApi, filePath)
      if (!stat) continue
      if (dateFromLogName(name) < cutoffDate || stat.mtimeMs < cutoff) {
        await fsApi.unlink(filePath)
        continue
      }
      entries.push({ name, filePath, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    for (const entry of entries.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= maxTotalBytes) break
      await fsApi.unlink(entry.filePath)
      total -= entry.size
    }
  }

  async function attemptAppend(safe, dropped) {
    await ensureDir()
    const line = buildLine(safe, { dropped })
    let target = await appendIfCapacity(line)
    let degraded = false
    if (!target && (safe.level === 'warn' || safe.level === 'error')) {
      const degradedLine = buildDegradedLine(safe, dropped)
      target = await appendIfCapacity(degradedLine)
      degraded = Boolean(target)
    }
    if (!target) {
      if (safe.level !== 'warn' && safe.level !== 'error') droppedInfoCount += 1
      return { ok: false, reason: 'capacity' }
    }
    if (dropped) droppedInfoCount = 0
    if (degraded) return { ok: true, degraded: true }
    return { ok: true, path: target }
  }

  function invalidateDirectoryCache() {
    ensuredDir = false
  }

  async function writeEvent(level, eventName, data = {}, processName = 'main') {
    try {
      if (!(await isEnabled())) return { ok: false, reason: 'disabled' }
      const safe = sanitizeDiagnosticEvent(
        { level, event: eventName, process: processName, data },
        { projectRoot }
      )
      const dropped = droppedInfoCount > 0 ? { info: droppedInfoCount } : undefined
      try {
        return await attemptAppend(safe, dropped)
      } catch {
        // 目录可能被外部删除：重置后重试一次，避免丢这条事件。
        invalidateDirectoryCache()
        return await attemptAppend(safe, dropped)
      }
    } catch (error) {
      invalidateDirectoryCache()
      console.warn('[diagnosticLogger] write failed:', error?.message || error)
      return { ok: false, reason: 'write-failed' }
    }
  }

  function event(level, eventName, data = {}, processName = 'main') {
    const write = writeChain.then(() => writeEvent(level, eventName, data, processName))
    writeChain = write.catch(() => {})
    return write
  }

  return {
    sessionId,
    getLogPath: () => activeLogPath(),
    cleanup,
    event,
    debug: (eventName, data, processName) => event('debug', eventName, data, processName),
    info: (eventName, data, processName) => event('info', eventName, data, processName),
    warn: (eventName, data, processName) => event('warn', eventName, data, processName),
    error: (eventName, data, processName) => event('error', eventName, data, processName)
  }
}

export const diagnosticLogger = createDiagnosticLogger({
  isEnabled: isStoreDiagnosticLoggingEnabled
})
