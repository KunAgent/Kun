import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ColabStateSnapshot } from '../shared/colab/colab-types'
import type { KunGuiColabApi } from '../shared/colab/kun-gui-api-colab'

/**
 * Colab cloud compute bridge methods. Spread into `kunGui` in `index.ts`
 * using only sandbox-supported Electron imports.
 */
export const colabApi: KunGuiColabApi = {
  colabGetSnapshot: () => ipcRenderer.invoke('colab:get-snapshot'),
  colabEnsureCliRuntime: (options) => ipcRenderer.invoke('colab:ensure-cli', options),
  colabStartOAuthLogin: (input) => ipcRenderer.invoke('colab:oauth:start', input),
  colabSubmitOAuthManualCode: (input) => ipcRenderer.invoke('colab:oauth:manual-code', input),
  colabPromoteMismatchedToken: (input) => ipcRenderer.invoke('colab:oauth:promote-mismatch', input),
  colabCancelOAuthLogin: (input) => ipcRenderer.invoke('colab:oauth:cancel', input),
  colabReopenOAuthUrl: (input) => ipcRenderer.invoke('colab:oauth:reopen', input),
  colabClearLastLoginOutcome: () => ipcRenderer.invoke('colab:oauth:clear-outcome'),
  colabSelectWorkspaceConnection: (input) => ipcRenderer.invoke('colab:connection:select-workspace', input),
  colabRenameConnection: (input) => ipcRenderer.invoke('colab:connection:rename', input),
  colabRefreshBalances: (input) => ipcRenderer.invoke('colab:connection:refresh-balances', input),
  colabOpenBrowser: (input) => ipcRenderer.invoke('colab:connection:open-browser', input),
  colabSignOutConnection: (input) => ipcRenderer.invoke('colab:connection:sign-out', input),
  colabInspectWorkspaceSync: (input) => ipcRenderer.invoke('colab:workspace:inspect-sync', input),
  colabSaveWorkspaceConfig: (input) => ipcRenderer.invoke('colab:workspace:save-config', input),
  colabStartRun: (input) => ipcRenderer.invoke('colab:session:start', input),
  colabStopSession: (input) => ipcRenderer.invoke('colab:session:stop', input),
  colabReconnectSession: (input) => ipcRenderer.invoke('colab:session:reconnect', input),
  colabUploadToSession: (input) => ipcRenderer.invoke('colab:session:upload', input),
  colabDownloadFromSession: (input) => ipcRenderer.invoke('colab:session:download', input),
  colabPrepareTerminalLaunch: (input) => ipcRenderer.invoke('colab:session:prepare-terminal', input),
  colabAdoptUntrackedSession: (input) => ipcRenderer.invoke('colab:untracked:adopt', input),
  colabStopUntrackedSession: (input) => ipcRenderer.invoke('colab:untracked:stop', input),
  colabIgnoreUntrackedSession: (input) => ipcRenderer.invoke('colab:untracked:ignore', input),
  onColabStateChanged: (handler) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: ColabStateSnapshot): void => {
      handler(snapshot)
    }
    ipcRenderer.on('colab:state-changed', wrapped)
    return () => ipcRenderer.removeListener('colab:state-changed', wrapped)
  }
}
