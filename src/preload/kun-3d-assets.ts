import { ipcRenderer } from 'electron'
import type { Kun3dAssetsBridge } from '../shared/kun-3d-assets'

export const kun3dAssets: Kun3dAssetsBridge = {
  list: () => ipcRenderer.invoke('kun3d:list'),
  read: (key) => ipcRenderer.invoke('kun3d:read', { key }),
  openFolder: () => ipcRenderer.invoke('kun3d:open-folder')
}
