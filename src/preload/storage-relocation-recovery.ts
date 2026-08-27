import { contextBridge, ipcRenderer } from 'electron'
import type { StorageRelocationRecoveryApi } from '../shared/storage-relocation'

export type { StorageRelocationRecoveryApi }

const api: StorageRelocationRecoveryApi = {
  getStatus: () => ipcRenderer.invoke('storage-relocation:status'),
  cancel: (operationId) => ipcRenderer.invoke('storage-relocation:cancel', { operationId }),
  retry: (operationId) => ipcRenderer.invoke('storage-relocation:retry', { operationId }),
  rollback: (operationId) => ipcRenderer.invoke('storage-relocation:rollback', { operationId }),
  onProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('storage-relocation:progress', wrapped)
    return () => ipcRenderer.removeListener('storage-relocation:progress', wrapped)
  }
}

contextBridge.exposeInMainWorld('kunStorageRelocationRecovery', api)
