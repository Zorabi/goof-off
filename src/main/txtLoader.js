import { readFileSync, statSync } from 'fs'
import { parse, resolve } from 'path'
import { createHash } from 'crypto'
import jschardet from 'jschardet'
import iconv from 'iconv-lite'
import { fileAccessFailure } from './fileAccessFailure.js'
import { detect as detectChapters } from './txtChapters.js'

const MAX_SIZE = 30 * 1024 * 1024

function detectBOM(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { encoding: 'UTF-8', offset: 3 }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { encoding: 'UTF-16LE', offset: 2 }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return { encoding: 'UTF-16BE', offset: 2 }
  return null
}

function makeFileId(absPath, size, mtimeMs) {
  return createHash('sha1')
    .update(absPath + size + mtimeMs)
    .digest('hex')
    .slice(0, 16)
}

function resolveEncoding(buffer, opts = {}) {
  if (opts.encodingOverride) {
    return { encoding: opts.encodingOverride, bomOffset: 0 }
  }

  const bom = detectBOM(buffer)
  if (bom) {
    return { encoding: bom.encoding, bomOffset: bom.offset }
  }

  if (opts.defaultEncoding) {
    return { encoding: opts.defaultEncoding, bomOffset: 0 }
  }

  const sample = buffer.slice(0, 4096)
  const detected = jschardet.detect(sample)
  if (detected && detected.confidence > 0) {
    let enc = detected.encoding.toUpperCase()
    if (enc === 'ASCII' || enc === 'WINDOWS-1252') enc = 'UTF-8'
    return { encoding: enc, bomOffset: 0 }
  }

  return { encoding: 'UTF-8', bomOffset: 0 }
}

function decodeBuffer(buffer, encoding, bomOffset) {
  const data = bomOffset > 0 ? buffer.slice(bomOffset) : buffer
  if (encoding === 'UTF-8') {
    return data.toString('utf8')
  }
  return iconv.decode(data, encoding)
}

export function loadFileSync(filePath, opts = {}) {
  let stat
  try {
    stat = statSync(filePath)
  } catch (error) {
    return fileAccessFailure(error)
  }

  const size = opts._mockSize ?? stat.size
  if (size > MAX_SIZE) {
    return { ok: false, reason: 'too-large', message: '文件过大（>30MB），暂不支持' }
  }

  let buffer
  try {
    buffer = readFileSync(filePath)
  } catch (error) {
    return fileAccessFailure(error)
  }

  const { encoding, bomOffset } = resolveEncoding(buffer, opts)
  let text = decodeBuffer(buffer, encoding, bomOffset)
  text = text.replace(/\r\n?/g, '\n')

  const chapters = detectChapters(text)
  const absPath = resolve(filePath)
  const fileId = makeFileId(absPath, stat.size, stat.mtimeMs)
  const displayName = parse(filePath).name

  const sample = buffer.slice(0, 4096)
  const detected = jschardet.detect(sample)
  const confidence = detected?.confidence ?? 0

  return {
    ok: true,
    data: { fileId, displayName, text, chapters, encoding, confidence, sizeBytes: stat.size }
  }
}

export { detectBOM, makeFileId, resolveEncoding, decodeBuffer, MAX_SIZE }
