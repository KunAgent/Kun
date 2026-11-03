import { ipcRenderer } from 'electron'
import {
  APP_SANDBOX_CHANNELS,
  type AppSandboxClosedEvent,
  type AppSandboxMessageEvent,
  type KunGuiAppSandboxApi
} from '../shared/app-sandbox'

/** Workbench side of the app sandbox; spread into `window.kunGui`. */
export const appSandboxPreloadApi: KunGuiAppSandboxApi = {
  appSandbox: {
    createGenUi: (request) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.createGenUi, request),
    createMcpApp: (request) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.createMcpApp, request),
    dispose: (instanceId) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.dispose, { instanceId }),
    post: (instanceId, message) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.post, { instanceId, message }),
    consumeGesture: (instanceId) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.consumeGesture, { instanceId }),
    openExternal: (instanceId, url) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.openExternal, { instanceId, url }),
    capture: (instanceId) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.capture, { instanceId }),
    saveFile: (instanceId, file) => ipcRenderer.invoke(APP_SANDBOX_CHANNELS.saveFile, { instanceId, file }),
    onMessage: (handler) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: AppSandboxMessageEvent) => handler(payload)
      ipcRenderer.on(APP_SANDBOX_CHANNELS.message, wrapped)
      return () => ipcRenderer.removeListener(APP_SANDBOX_CHANNELS.message, wrapped)
    },
    onClosed: (handler) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: AppSandboxClosedEvent) => handler(payload)
      ipcRenderer.on(APP_SANDBOX_CHANNELS.closed, wrapped)
      return () => ipcRenderer.removeListener(APP_SANDBOX_CHANNELS.closed, wrapped)
    }
  }
}
