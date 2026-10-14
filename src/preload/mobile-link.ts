import { ipcRenderer } from 'electron'
import {
  MOBILE_LINK_CHANNELS as channels,
  type MobileLinkApi
} from '../shared/mobile-link'
export const mobileLink: MobileLinkApi = {
  status: () => ipcRenderer.invoke(channels.status),
  enable: (value) => ipcRenderer.invoke(channels.enable, value),
  confirm: (id) => ipcRenderer.invoke(channels.confirm, id),
  revoke: (id) => ipcRenderer.invoke(channels.revoke, id)
}
