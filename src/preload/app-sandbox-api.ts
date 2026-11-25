import { ipcRenderer } from 'electron'
import { WIDGET_APP_CHANNELS as apps, type WidgetAppFollowUp } from '../shared/widget-apps'
import {
  APP_SANDBOX_CHANNELS,
  type AppSandboxClosedEvent,
  type AppSandboxMessageEvent,
  type KunGuiAppSandboxApi
} from '../shared/app-sandbox'

/** Workbench side of the app sandbox; spread into `window.kunGui`. */
export const appSandboxPreloadApi: KunGuiAppSandboxApi = {
  widgetApps: {
    list: () => ipcRenderer.invoke(apps.list),
    info: id => ipcRenderer.invoke(apps.info, id),
    open: id => ipcRenderer.invoke(apps.open, id),
    install: source => ipcRenderer.invoke(apps.install, source),
    save: (id, widgetId, state) => ipcRenderer.invoke(apps.save, { id, widgetId, state }),
    followUp: (id, prompt) => ipcRenderer.invoke(apps.followUp, { id, prompt }),
    composed: (requestId, sent) => ipcRenderer.send(apps.composed, { requestId, sent }),
    onCompose: handler => {
      const wrapped = (_event: Electron.IpcRendererEvent, request: WidgetAppFollowUp) => handler(request)
      ipcRenderer.on(apps.compose, wrapped)
      return () => ipcRenderer.removeListener(apps.compose, wrapped)
    }
  },
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
