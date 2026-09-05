import { ipcRenderer } from 'electron'
import type { RuntimeRequestIpcApi } from '../shared/kun-gui-api-runtime-request'

export const runtimeRequestPreloadApi: RuntimeRequestIpcApi = {
  runtimeRequest: (path, method, body, options) =>
    ipcRenderer.invoke('runtime:request', { path, method, body, ...options }),
  cancelRuntimeRequest: (requestId) =>
    ipcRenderer.invoke('runtime:request:cancel', { requestId })
}
