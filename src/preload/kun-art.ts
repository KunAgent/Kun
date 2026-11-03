import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { ART_CHANNELS as channels, type KunArtApi, type ArtState } from '../shared/kun-art'
export const kunArtApi: KunArtApi = {
  getState: () => ipcRenderer.invoke(channels.get),
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: ArtState) => handler(state)
    ipcRenderer.on(channels.state, listener)
    return () => ipcRenderer.removeListener(channels.state, listener)
  }
}
