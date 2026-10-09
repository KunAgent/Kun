import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { KUN_ACCOUNT_CHANNELS as channels, type KunAccountApi, type KunAccountState } from '../shared/kun-account'

export const kunAccountApi: KunAccountApi = {
  getState: () => ipcRenderer.invoke(channels.get),
  login: () => ipcRenderer.invoke(channels.login),
  cancelLogin: () => ipcRenderer.invoke(channels.cancel),
  refresh: () => ipcRenderer.invoke(channels.refresh),
  logout: () => ipcRenderer.invoke(channels.logout),
  openAccountCenter: () => ipcRenderer.invoke(channels.manage),
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: KunAccountState) => handler(state)
    ipcRenderer.on(channels.state, listener)
    return () => ipcRenderer.removeListener(channels.state, listener)
  }
}
