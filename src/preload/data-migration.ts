import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

export function createDataMigrationPreloadApi(): KunGuiApi['dataMigration'] {
  return {
    pickExportPackage: (defaultPath) => ipcRenderer.invoke('data-migration:pick-export', { defaultPath }),
    pickImportPackage: (defaultPath) => ipcRenderer.invoke('data-migration:pick-import', { defaultPath }),
    pickDestinationDirectory: (defaultPath) => ipcRenderer.invoke('data-migration:pick-destination', { defaultPath }),
    estimateExport: (input) => ipcRenderer.invoke('data-migration:estimate-export', input),
    inspectPackage: (input) => ipcRenderer.invoke('data-migration:inspect', input),
    planImport: (input) => ipcRenderer.invoke('data-migration:plan-import', input),
    startExport: (input) => ipcRenderer.invoke('data-migration:start-export', input),
    startImport: (input) => ipcRenderer.invoke('data-migration:start-import', input),
    cancel: (operationId) => ipcRenderer.invoke('data-migration:cancel', { operationId }),
    recover: (operationId, action) => ipcRenderer.invoke('data-migration:recover', { operationId, action }),
    getStatus: () => ipcRenderer.invoke('data-migration:status'),
    listReports: () => ipcRenderer.invoke('data-migration:reports:list'),
    getReport: (operationId) => ipcRenderer.invoke('data-migration:reports:get', { operationId }),
    deleteReport: (operationId) => ipcRenderer.invoke('data-migration:reports:delete', { operationId }),
    onProgress: (handler) => {
      let latest: Parameters<typeof handler>[0] | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      const flush = () => {
        timer = null
        if (!latest) return
        const value = latest
        latest = null
        handler(value)
      }
      const wrapped = (_: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => {
        latest = payload
        if (!timer) timer = setTimeout(flush, 100)
      }
      ipcRenderer.on('data-migration:progress', wrapped)
      return () => {
        ipcRenderer.removeListener('data-migration:progress', wrapped)
        if (timer) clearTimeout(timer)
        timer = null
        latest = null
      }
    },
    onRendererRequest: (handler) => {
      const wrapped = (_: Electron.IpcRendererEvent, request: Parameters<typeof handler>[0]) => handler(request)
      ipcRenderer.on('data-migration:renderer-request', wrapped)
      return () => ipcRenderer.removeListener('data-migration:renderer-request', wrapped)
    },
    respondRendererRequest: (response) => ipcRenderer.invoke('data-migration:renderer-response', response)
  }
}
