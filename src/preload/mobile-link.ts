import { ipcRenderer } from 'electron'
import {
  MOBILE_LINK_CHANNELS as channels,
  type MobileLinkApi
} from '../shared/mobile-link'
export const mobileLink: MobileLinkApi = {
  reconnect: () => ipcRenderer.invoke(channels.reconnect),
  entitlements: () => ipcRenderer.invoke(channels.entitlements),
  status: () => ipcRenderer.invoke(channels.status),
  enable: (value) => ipcRenderer.invoke(channels.enable, value),
  resetIdentity: () => ipcRenderer.invoke(channels.resetIdentity),
  confirm: (id, scopes) => ipcRenderer.invoke(channels.confirm, id, scopes),
  setScopes: (id, scopes) => ipcRenderer.invoke(channels.setScopes, id, scopes),
  desktopStatus: () => ipcRenderer.invoke(channels.desktopStatus),
  desktopConfigure: value => ipcRenderer.invoke(channels.desktopConfigure, value),
  desktopStop: () => ipcRenderer.invoke(channels.desktopStop),
  revoke: (id) => ipcRenderer.invoke(channels.revoke, id)
}
