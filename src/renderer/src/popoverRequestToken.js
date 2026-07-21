const rendererNonce = globalThis.crypto.randomUUID()
let requestSequence = 0

export function createPopoverRequestToken(id) {
  return `${id}:${rendererNonce}:${++requestSequence}`
}
