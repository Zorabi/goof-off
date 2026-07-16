import { ref } from 'vue'

const current = ref(null) // { id, kind, msg, defaultVal } | null

let bootstrapped = false
function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  window.api?.onDialogRequest?.((payload) => {
    current.value = payload
  })
}

function respond(result) {
  if (!current.value) return
  const id = current.value.id
  current.value = null
  window.api?.dialogRespond?.({ id, result })
}

export function useDialogPrompt() {
  bootstrap()
  return { current, respond }
}
