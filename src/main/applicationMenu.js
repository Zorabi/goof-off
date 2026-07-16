import { app, Menu } from 'electron'
import * as preferencesWindow from './preferencesWindow.js'
import * as webviewManager from './webviewManager.js'
import { getMainWindow } from './windowManager.js'
import { getRuntimePlatformPolicy } from '../shared/platformPolicy.js'

function buildAppSubmenu(policy) {
  const submenu = [
    { role: 'about' },
    { type: 'separator' },
    {
      label: 'Preferences…',
      accelerator: policy.menu.preferencesAccelerator,
      click: () => preferencesWindow.open()
    },
    { type: 'separator' }
  ]
  if (policy.family === 'mac') {
    submenu.push(
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' }
    )
  }
  submenu.push({ role: 'quit' })
  return submenu
}

export function install() {
  const policy = getRuntimePlatformPolicy()
  const template = [
    {
      label: app.name,
      submenu: buildAppSubmenu(policy)
    },
    {
      label: 'File',
      submenu: [
        {
          label: '打开文件…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send('file:open-request')
            }
          }
        },
        {
          label: '打开 EPUB 文件…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send('epub:open-request')
            }
          }
        },
        {
          label: '打开 PDF 文件…',
          accelerator: 'CmdOrCtrl+Alt+O',
          click: () => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send('pdf:open-request')
            }
          }
        }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: '内嵌网页 DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => webviewManager.openDevTools()
        }
      ]
    },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
