import { ipcRenderer } from 'electron'
import type { KunGuiBrowserUseApi } from '../shared/browser-use'

export const browserUsePreloadApi: KunGuiBrowserUseApi = {
  getBrowserUseState: (threadId, expectedTurnId) =>
    ipcRenderer.invoke('browser-use:state:get', { threadId, expectedTurnId }),
  mountBrowserUse: (input) =>
    ipcRenderer.invoke('browser-use:mount', input),
  decideBrowserUseOrigin: (input) =>
    ipcRenderer.invoke('browser-use:origin:decide', input),
  decideBrowserUseAction: (input) =>
    ipcRenderer.invoke('browser-use:action:decide', input),
  setBrowserUseControl: (input) =>
    ipcRenderer.invoke('browser-use:control', input),
  navigateBrowserUse: (input) =>
    ipcRenderer.invoke('browser-use:navigate', input),
  setBrowserUseZoom: (input) =>
    ipcRenderer.invoke('browser-use:zoom', input),
  stopBrowserUse: (threadId, expectedTurnId) =>
    ipcRenderer.invoke('browser-use:stop', { threadId, expectedTurnId }),
  clearBrowserUse: (threadId, expectedTurnId) =>
    ipcRenderer.invoke('browser-use:clear', { threadId, expectedTurnId }),
  onBrowserUseState: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('browser-use:state', wrapped)
    return () => ipcRenderer.removeListener('browser-use:state', wrapped)
  }
}
