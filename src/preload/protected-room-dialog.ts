import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('kunProtectedRoom', Object.freeze({
  confirm: (value: boolean) => { if (typeof value === 'boolean') ipcRenderer.send('protected-room:confirm', value) }
}))
