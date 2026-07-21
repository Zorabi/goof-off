import { appendFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'

const KINDS = new Set(['popover', 'preferences'])
const OUTCOMES = new Set([
  'shown',
  'reveal-degraded',
  'already-visible',
  'cancelled',
  'load-failed',
  'renderer-gone',
  'destroyed'
])
const REVEAL_PATHS = Object.freeze({
  popover: new Set(['measure-ready', 'measure-fallback']),
  preferences: new Set(['ready-to-show', 'first-frame-fallback'])
})
const configuredOutput = process.env.GOOF_OFF_WINDOW_LATENCY_OUTPUT
const outputPath = typeof configuredOutput === 'string' ? configuredOutput.trim() : ''
const ownedSamples = new WeakSet()
const pendingFinishedRecords = new Map()

let sequence = 0
let fused = false
let warned = false
let writeQueue = Promise.resolve()
let nextSequenceToWrite = 1

function warnAndFuse(message) {
  fused = true
  if (warned) return
  warned = true
  console.warn(`[windowOpenLatencyProbe] ${message}`)
}

function enabledOutputPath() {
  if (!outputPath || fused) return null
  if (!isAbsolute(outputPath)) {
    warnAndFuse('GOOF_OFF_WINDOW_LATENCY_OUTPUT must be an absolute path; probe disabled')
    return null
  }
  return outputPath
}

function validBegin(kind, options) {
  return KINDS.has(kind) && typeof options?.reused === 'boolean'
}

function validFinish(sample, result) {
  if (!sample || typeof sample !== 'object' || !ownedSamples.has(sample) || sample.finished) {
    return false
  }
  if (!OUTCOMES.has(result?.outcome)) return false
  if (result.outcome !== 'shown') return true
  return REVEAL_PATHS[sample.kind].has(result.revealPath)
}

function enqueue(record, targetPath) {
  let line
  try {
    line = `${JSON.stringify(record)}\n`
  } catch {
    warnAndFuse('failed to serialize latency sample; probe disabled')
    return
  }
  writeQueue = writeQueue
    .then(async () => {
      if (fused) return
      await appendFile(targetPath, line, 'utf8')
    })
    .catch(() => {
      warnAndFuse('failed to append latency sample; probe disabled')
    })
}

function drainFinishedRecords() {
  while (pendingFinishedRecords.has(nextSequenceToWrite)) {
    const { record, targetPath } = pendingFinishedRecords.get(nextSequenceToWrite)
    pendingFinishedRecords.delete(nextSequenceToWrite)
    nextSequenceToWrite += 1
    enqueue(record, targetPath)
  }
}

export function beginWindowOpenSample(kind, options) {
  const targetPath = enabledOutputPath()
  if (!targetPath || !validBegin(kind, options)) return null
  const sample = {
    kind,
    sequence: ++sequence,
    reused: options.reused,
    startTime: performance.now(),
    finished: false
  }
  ownedSamples.add(sample)
  return sample
}

export function finishWindowOpenSample(sample, result) {
  const targetPath = enabledOutputPath()
  if (!targetPath || !validFinish(sample, result)) return undefined
  sample.finished = true
  const durationMs = Math.max(0, performance.now() - sample.startTime)
  const record = {
    kind: sample.kind,
    sequence: sample.sequence,
    reused: sample.reused,
    outcome: result.outcome,
    revealPath: result.outcome === 'shown' ? result.revealPath : null,
    durationMs: Number(durationMs.toFixed(3))
  }
  pendingFinishedRecords.set(sample.sequence, { record, targetPath })
  drainFinishedRecords()
  return undefined
}
