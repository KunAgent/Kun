import { ipcRenderer } from 'electron'
import type { StorageRelocationApi } from '../shared/storage-relocation'

export function createStorageRelocationWorkbenchApi(): StorageRelocationApi {
  return {
    getStatus: () => ipcRenderer.invoke('storage-relocation:status'),
    pickDestination: (defaultPath) =>
      ipcRenderer.invoke('storage-relocation:pick-destination', { defaultPath }),
    preflight: (destinationRoot) =>
      ipcRenderer.invoke('storage-relocation:preflight', { destinationRoot }),
    schedule: (input) => ipcRenderer.invoke('storage-relocation:schedule', input),
    restoreDefault: (interruptActiveWork) =>
      ipcRenderer.invoke('storage-relocation:restore-default', { interruptActiveWork }),
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
}
