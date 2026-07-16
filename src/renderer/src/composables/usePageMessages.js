import { ref, computed, onUnmounted } from 'vue'

const statusMsg = ref(null)
const idleMsg = ref(null)

let statusTimer = null
const STATUS_TTL = 3000

function truncate(s, max = 60) {
  s = String(s ?? '')
  return s.length > max ? s.slice(0, max) + '…' : s
}

const formatters = {
  alert: (m) => `页面提示:${truncate(m.msg)}`,
  'external-blocked': () => '已忽略外部链接',
  'load-error': (m) => truncate(m.description || '加载失败')
}

let bootstrapped = false
function bootstrap() {
  if (bootstrapped) return
  bootstrapped = true
  window.api?.onPageMessage?.((msg) => {
    const fmt = formatters[msg.kind]
    if (!fmt) return
    const text = fmt(msg)
    if (!text) return
    pushStatus(text)
  })
}

export function pushStatus(text, opts = {}) {
  if (!text) return
  statusMsg.value = { text }
  clearTimeout(statusTimer)
  const ttl = opts.ttl ?? STATUS_TTL
  statusTimer = setTimeout(() => {
    statusMsg.value = null
  }, ttl)
}

export function clearStatus() {
  clearTimeout(statusTimer)
  statusMsg.value = null
}

export function setIdle(text) {
  idleMsg.value = text ? { text } : null
}

const current = computed(() => statusMsg.value || idleMsg.value)

export function usePageMessages() {
  bootstrap()
  onUnmounted(() => clearTimeout(statusTimer))
  return { current, pushStatus, setIdle, clearStatus }
}
