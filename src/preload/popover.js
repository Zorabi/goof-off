import { contextBridge, ipcRenderer } from 'electron'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

const platformPolicy = getRuntimePlatformPolicy()

const api = {
  platformPolicy,
  onSnapshot(callback) {
    const handler = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('popover:snapshot', handler)
    return () => ipcRenderer.removeListener('popover:snapshot', handler)
  },
  sendAction(payload) {
    return ipcRenderer.invoke('popover:action', payload)
  },
  measureReady(payload) {
    return ipcRenderer.invoke('popover:measure-ready', payload)
  },
  requestClose(payload) {
    return ipcRenderer.invoke('popover:request-close', payload)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('popoverApi', api)
} else {
  window.popoverApi = api
}
