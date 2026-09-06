'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kunGui', {
  runDesktopCommand: (command) => ipcRenderer.invoke('mini-command', command),
  getWindowMiniMode: async () => (await ipcRenderer.invoke('mini-state')).mini,
  getTestState: () => ipcRenderer.invoke('mini-state'),
  onWindowMiniMode: (handler) => {
    const listener = (_event, mini) => handler(mini)
    ipcRenderer.on('mini-state-changed', listener)
    return () => ipcRenderer.removeListener('mini-state-changed', listener)
  }
})
