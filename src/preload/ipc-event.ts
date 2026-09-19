import { ipcRenderer, type IpcRendererEvent } from 'electron'

export function onIpcEvent(channel: string, handler: () => void): () => void {
  const wrapped = (_event: IpcRendererEvent) => handler()
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}
