import { parentPort } from 'worker_threads'
import { loadFileSync } from './txtLoader.js'

parentPort.on('message', (msg) => {
  const { requestId, path, encodingOverride, defaultEncoding } = msg
  const opts = {}
  if (encodingOverride) opts.encodingOverride = encodingOverride
  if (defaultEncoding) opts.defaultEncoding = defaultEncoding
  const result = loadFileSync(path, opts)
  parentPort.postMessage({ requestId, result })
})
