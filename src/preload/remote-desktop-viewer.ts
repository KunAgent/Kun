import { contextBridge, ipcRenderer } from 'electron'
import type { ComputerViewerBridge, ComputerViewerEvent } from '../shared/computer-access'
import { COMPUTER_VIEWER_CHANNELS as channels } from '../shared/computer-viewer-channels'

const bridge: ComputerViewerBridge = {
  configuration: () => ipcRenderer.invoke(channels.configuration),
  ready: api => ipcRenderer.send(channels.ready, api),
  invoke: (method, params) => ipcRenderer.invoke(channels.invoke, method, params),
  ice: () => ipcRenderer.invoke(channels.ice),
  restart: () => ipcRenderer.invoke(channels.restart),
  onEvent(listener) {
    const receive = (_event: Electron.IpcRendererEvent, value: ComputerViewerEvent) => listener(value)
    ipcRenderer.on(channels.event, receive)
    return () => ipcRenderer.removeListener(channels.event, receive)
  },
  heartbeat: () => ipcRenderer.send(channels.heartbeat),
  close: () => ipcRenderer.invoke(channels.close),
  fullscreen: () => ipcRenderer.invoke(channels.fullscreen)
}
contextBridge.exposeInMainWorld('kunComputerViewer', bridge)
