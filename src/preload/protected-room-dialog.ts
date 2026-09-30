import { contextBridge, ipcRenderer } from 'electron'

// This bridge is exclusive to the isolated consent window. It exposes no
// arbitrary channel, runtime call, settings access or workbench API.
contextBridge.exposeInMainWorld('kunProtectedRoom', Object.freeze({
  confirm: (confirmed: boolean, nonce: string): void => {
    if (typeof confirmed !== 'boolean' || typeof nonce !== 'string' || !/^[a-f0-9]{48}$/.test(nonce)) return
    ipcRenderer.send('protected-room:confirm', { confirmed, nonce })
  }
}))
