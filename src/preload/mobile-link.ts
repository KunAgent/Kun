import { CONTROL_PACKAGE_CHANNELS as control } from '../shared/control-package'
import { ipcRenderer } from 'electron'
import { COMPUTER_ACCESS_CHANNELS as computers } from '../shared/computer-access'
import { DIRECT_LINK_CHANNELS as direct } from '../shared/direct-link'
import {
  MOBILE_LINK_CHANNELS as channels,
  type MobileLinkApi
} from '../shared/mobile-link'
export const mobileLink: MobileLinkApi = {
  computers: {
    status: () => ipcRenderer.invoke(computers.status), refresh: () => ipcRenderer.invoke(computers.refresh),
    pair: id => ipcRenderer.invoke(computers.pair, id), open: id => ipcRenderer.invoke(computers.open, id),
    close: () => ipcRenderer.invoke(computers.close), confirmClosed: () => ipcRenderer.invoke(computers.confirmClosed),
    enableHost: value => ipcRenderer.invoke(computers.host, value)
  },
  controlPackage: {
    status: () => ipcRenderer.invoke(control.status),
    check: () => ipcRenderer.invoke(control.check),
    install: () => ipcRenderer.invoke(control.install),
    apply: () => ipcRenderer.invoke(control.apply)
  },
  direct: {
    retry: () => ipcRenderer.invoke(direct.retry),
    status: () => ipcRenderer.invoke(direct.status),
    configure: value => ipcRenderer.invoke(direct.configure, value),
    pair: scopes => ipcRenderer.invoke(direct.pair, scopes),
    revoke: id => ipcRenderer.invoke(direct.revoke, id)
  },
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
