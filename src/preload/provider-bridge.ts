import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

/**
 * Provider-related IPC bridges (probe, protocol detection, external import,
 * icons, `kun://` import links, quotas, catalog). Kept in a sibling module so
 * `index.ts` stays under the file-size gate.
 */
export const providerBridge = {
  probeModelProvider: (payload) => ipcRenderer.invoke('provider:probe', payload),
  detectProviderProtocols: (payload) =>
    ipcRenderer.invoke('provider:detect-protocol', payload),
  scanExternalProviders: () => ipcRenderer.invoke('provider:external-scan'),
  importExternalProvider: (payload) => ipcRenderer.invoke('provider:external-import', payload),
  importProviderIcon: (payload) => ipcRenderer.invoke('provider:icon:import', payload),
  providerIconDataUrl: (payload) => ipcRenderer.invoke('provider:icon:data', payload),
  stageProviderImportLink: (payload) => ipcRenderer.invoke('provider:import-link:stage', payload),
  commitProviderImportLink: (payload) => ipcRenderer.invoke('provider:import-link:commit', payload),
  onProviderImportLink: (handler) => {
    const wrapped = (_: Electron.IpcRendererEvent, staged: Parameters<typeof handler>[0]) =>
      handler(staged)
    ipcRenderer.on('provider:import-link', wrapped)
    return () => ipcRenderer.removeListener('provider:import-link', wrapped)
  },
  listProviderQuotas: () => ipcRenderer.invoke('provider:quota:list'),
  fetchModelsDevCatalog: (payload) => ipcRenderer.invoke('provider:models-dev-catalog', payload)
} satisfies Pick<
  KunGuiApi,
  | 'probeModelProvider'
  | 'detectProviderProtocols'
  | 'scanExternalProviders'
  | 'importExternalProvider'
  | 'importProviderIcon'
  | 'providerIconDataUrl'
  | 'stageProviderImportLink'
  | 'commitProviderImportLink'
  | 'onProviderImportLink'
  | 'listProviderQuotas'
  | 'fetchModelsDevCatalog'
>
