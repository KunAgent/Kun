import type { IpcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

export function createGitHubMcpAuthorizationPreloadApi(
  ipcRenderer: IpcRenderer
): Pick<KunGuiApi,
  | 'preflightBuiltinGitHubMcpAuthorization'
  | 'startBuiltinGitHubMcpLogin'
  | 'disableBuiltinGitHubMcp'
  | 'confirmBuiltinGitHubMcpAuthorization'
> {
  return {
    preflightBuiltinGitHubMcpAuthorization: (host) =>
      ipcRenderer.invoke('github-mcp:authorization:preflight', host),
    startBuiltinGitHubMcpLogin: (host) =>
      ipcRenderer.invoke('github-mcp:authorization:login', host),
    disableBuiltinGitHubMcp: () =>
      ipcRenderer.invoke('github-mcp:authorization:disable'),
    confirmBuiltinGitHubMcpAuthorization: (request) =>
      ipcRenderer.invoke('github-mcp:authorization:confirm', request)
  }
}
