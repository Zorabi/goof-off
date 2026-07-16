// BrowserView preload — 必须在 contextIsolation:false + sandbox:false 下运行,
// 才能直接覆盖 window.alert/confirm/prompt
const { ipcRenderer } = require('electron')

const ORIGINAL = {
  alert: null,
  confirm: null,
  prompt: null
}

function saveOriginals() {
  if (typeof window !== 'undefined') {
    ORIGINAL.alert = window.alert?.bind(window)
    ORIGINAL.confirm = window.confirm?.bind(window)
    ORIGINAL.prompt = window.prompt?.bind(window)
  }
}

function overrideDialogs() {
  if (typeof window === 'undefined') return

  saveOriginals()

  window.alert = function (msg) {
    try {
      ipcRenderer.send('page:dialog', { kind: 'alert', msg: String(msg ?? '') })
    } catch {
      if (ORIGINAL.alert) ORIGINAL.alert(msg)
    }
  }

  window.confirm = function (msg) {
    try {
      return ipcRenderer.sendSync('page:dialog-sync', {
        kind: 'confirm',
        msg: String(msg ?? '')
      })
    } catch {
      return ORIGINAL.confirm ? ORIGINAL.confirm(msg) : false
    }
  }

  window.prompt = function (msg, defaultVal) {
    try {
      return ipcRenderer.sendSync('page:dialog-sync', {
        kind: 'prompt',
        msg: String(msg ?? ''),
        defaultVal: String(defaultVal ?? '')
      })
    } catch {
      return ORIGINAL.prompt ? ORIGINAL.prompt(msg, defaultVal) : null
    }
  }
}

overrideDialogs()
