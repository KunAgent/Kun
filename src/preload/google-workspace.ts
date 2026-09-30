import type { IpcRenderer } from 'electron'
import { GOOGLE_WORKSPACE_CHANNELS, type GoogleWorkspaceApi } from '../shared/google-workspace'

export function createGoogleWorkspacePreloadApi(ipcRenderer: IpcRenderer): GoogleWorkspaceApi {
  return {
    status: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.status),
    login: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.login),
    setup: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.setup),
    test: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.test),
    logout: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.logout),
    cancel: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.cancel),
    openAuthorization: () => ipcRenderer.invoke(GOOGLE_WORKSPACE_CHANNELS.openAuthorization)
  }
}
