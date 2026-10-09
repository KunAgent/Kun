import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { KUN_ACCOUNT_CHANNELS as channels, type KunAccountApi, type KunAccountState } from '../shared/kun-account'
import { KUN_ACCOUNT_WARDROBE_CHANNELS as wardrobe } from '../shared/kun-account-economy'

export const kunAccountApi: KunAccountApi = {
  getState: () => ipcRenderer.invoke(channels.get),
  login: () => ipcRenderer.invoke(channels.login),
  reopenLogin: () => ipcRenderer.invoke(channels.reopen),
  cancelLogin: () => ipcRenderer.invoke(channels.cancel),
  refresh: () => ipcRenderer.invoke(channels.refresh),
  logout: () => ipcRenderer.invoke(channels.logout),
  openAccountCenter: () => ipcRenderer.invoke(channels.manage),
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: KunAccountState) => handler(state)
    ipcRenderer.on(channels.state, listener)
    return () => ipcRenderer.removeListener(channels.state, listener)
  },
  wardrobe: {
    sync: () => ipcRenderer.invoke(wardrobe.sync),
    open: (dropIds) => ipcRenderer.invoke(wardrobe.open, dropIds),
    stash: (dropIds) => ipcRenderer.invoke(wardrobe.stash, dropIds),
    seen: (keys) => ipcRenderer.invoke(wardrobe.seen, keys),
    settings: (settings) => ipcRenderer.invoke(wardrobe.settings, settings),
    exchange: (key) => ipcRenderer.invoke(wardrobe.exchange, key),
    setLook: (parts) => ipcRenderer.invoke(wardrobe.setLook, parts),
    shop: () => ipcRenderer.invoke(wardrobe.shop),
    purchase: (offerId) => ipcRenderer.invoke(wardrobe.purchase, offerId),
    invites: () => ipcRenderer.invoke(wardrobe.invites),
    claimInvite: (code) => ipcRenderer.invoke(wardrobe.claimInvite, code)
  }
}
