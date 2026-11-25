import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ColabStateSnapshot } from '../shared/colab/colab-types'
import type { RuntimeUploadEvent } from '../shared/colab/runtime-upload'
import type {
  ColabDriveMountState,
  ColabNotebookAgentRequest,
  ColabNotebookExecEvent,
  ColabPortForwardView,
  JupyterStateSnapshot
} from '../shared/colab/colab-notebook-types'
import type { KunGuiColabApi } from '../shared/colab/kun-gui-api-colab'

/**
 * Colab and Jupyter cloud compute bridge methods. Spread into `kunGui` in `index.ts`
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
  colabExtendSession: (input) => ipcRenderer.invoke('colab:session:extend', input),
  colabReconnectSession: (input) => ipcRenderer.invoke('colab:session:reconnect', input),
  colabUploadToSession: (input) => ipcRenderer.invoke('colab:session:upload', input),
  colabCancelUpload: (input) => ipcRenderer.invoke('colab:session:cancel-upload', input),
  onColabUploadProgress: (handler) => {
    const wrapped = (_event: IpcRendererEvent, progress: RuntimeUploadEvent): void => handler(progress)
    ipcRenderer.on('colab:session:upload-progress', wrapped)
    return () => ipcRenderer.removeListener('colab:session:upload-progress', wrapped)
  },
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
  },
  colabNotebookExecute: (input) => ipcRenderer.invoke('colab:notebook:execute', input),
  colabNotebookInterrupt: (input) => ipcRenderer.invoke('colab:notebook:interrupt', input),
  colabNotebookRestart: (input) => ipcRenderer.invoke('colab:notebook:restart', input),
  colabNotebookListFiles: (input) => ipcRenderer.invoke('colab:notebook:list-files', input),
  colabNotebookVariables: (input) => ipcRenderer.invoke('colab:notebook:variables', input),
  colabDriveStartPull: (input) => ipcRenderer.invoke('colab:drive:start-pull', input),
  colabDriveListNotebooks: (input) => ipcRenderer.invoke('colab:drive:list-notebooks', input),
  colabDriveCompleteAuth: (input) => ipcRenderer.invoke('colab:drive:complete-auth', input),
  colabDriveOpenAuth: (input) => ipcRenderer.invoke('colab:drive:open-auth', input),
  colabDriveClosePull: (input) => ipcRenderer.invoke('colab:drive:close-pull', input),
  colabDriveImportNotebook: (input) => ipcRenderer.invoke('colab:drive:import-notebook', input),
  colabDriveGetMountState: (input) => ipcRenderer.invoke('colab:drive:mount-state', input),
  colabDriveMount: (input) => ipcRenderer.invoke('colab:drive:mount', input),
  colabDriveCompleteMountAuth: (input) => ipcRenderer.invoke('colab:drive:complete-mount-auth', input),
  colabDriveOpenMountAuth: (input) => ipcRenderer.invoke('colab:drive:open-mount-auth', input),
  colabDriveCancelMount: (input) => ipcRenderer.invoke('colab:drive:cancel-mount', input),
  colabDriveUnmount: (input) => ipcRenderer.invoke('colab:drive:unmount', input),
  onColabDriveMountChanged: (handler) => {
    const wrapped = (_event: IpcRendererEvent, state: ColabDriveMountState): void => {
      handler(state)
    }
    ipcRenderer.on('colab:drive:mount-changed', wrapped)
    return () => ipcRenderer.removeListener('colab:drive:mount-changed', wrapped)
  },
  colabImportLocalNotebooks: (input) => ipcRenderer.invoke('colab:notebook:import-local', input),
  colabNotebookAssist: (input) => ipcRenderer.invoke('colab:notebook:assist', input),
  onColabNotebookEvent: (handler) => {
    const wrapped = (_event: IpcRendererEvent, event: ColabNotebookExecEvent): void => {
      handler(event)
    }
    ipcRenderer.on('colab:notebook:event', wrapped)
    return () => ipcRenderer.removeListener('colab:notebook:event', wrapped)
  },
  jupyterGetSnapshot: () => ipcRenderer.invoke('jupyter:get-snapshot'),
  jupyterSaveServer: (input) => ipcRenderer.invoke('jupyter:save-server', input),
  jupyterListNotebooks: (input) => ipcRenderer.invoke('jupyter:list-notebooks', input),
  jupyterImportNotebook: (input) => ipcRenderer.invoke('jupyter:import-notebook', input),
  jupyterConnect: (input) => ipcRenderer.invoke('jupyter:connect', input),
  jupyterDisconnect: (input) => ipcRenderer.invoke('jupyter:disconnect', input),
  jupyterRemoveServer: (input) => ipcRenderer.invoke('jupyter:remove-server', input),
  jupyterOpenBrowser: (input) => ipcRenderer.invoke('jupyter:open-browser', input),
  onJupyterStateChanged: (handler) => {
    const wrapped = (_event: IpcRendererEvent, snapshot: JupyterStateSnapshot): void => {
      handler(snapshot)
    }
    ipcRenderer.on('jupyter:state-changed', wrapped)
    return () => ipcRenderer.removeListener('jupyter:state-changed', wrapped)
  },
  onColabNotebookAgentRequest: (handler) => {
    const wrapped = (_event: IpcRendererEvent, request: ColabNotebookAgentRequest): void => {
      handler(request)
    }
    ipcRenderer.on('colab:notebook:agent-request', wrapped)
    return () => ipcRenderer.removeListener('colab:notebook:agent-request', wrapped)
  },
  colabNotebookAgentRespond: (response) => ipcRenderer.invoke('colab:notebook:agent-respond', response),
  colabPortForwardList: () => ipcRenderer.invoke('colab:port-forward:list'),
  colabPortForwardStart: (input) => ipcRenderer.invoke('colab:port-forward:start', input),
  colabPortForwardStop: (input) => ipcRenderer.invoke('colab:port-forward:stop', input),
  onColabPortForwardsChanged: (handler) => {
    const wrapped = (_event: IpcRendererEvent, forwards: ColabPortForwardView[]): void => {
      handler(forwards)
    }
    ipcRenderer.on('colab:port-forwards-changed', wrapped)
    return () => ipcRenderer.removeListener('colab:port-forwards-changed', wrapped)
  }
}
