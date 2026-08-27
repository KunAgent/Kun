import { contextBridge, ipcRenderer } from 'electron'
import type { RuntimeDataRecoveryWindowApi } from '../shared/runtime-data-recovery'

export type { RuntimeDataRecoveryWindowApi }

const api: RuntimeDataRecoveryWindowApi = {
  getStatus: () => ipcRenderer.invoke('runtime-data-recovery:status'),
  execute: (input) => ipcRenderer.invoke('runtime-data-recovery:execute', input)
}

contextBridge.exposeInMainWorld('kunRuntimeDataRecovery', api)
