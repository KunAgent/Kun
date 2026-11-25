import type { RuntimeUploadEvent, RuntimeUploadResult } from './runtime-upload'
import type {
  ColabCliRuntimeStatus,
  ColabLoginOutcome,
  ColabOAuthPendingState,
  ColabSessionView,
  ColabStartRunRequest,
  ColabStateSnapshot,
  ColabSyncCandidate,
  ColabWorkspaceRunConfig
} from './colab-types'
import type {
  ColabDriveMountResult,
  ColabDriveMountState,
  ColabDriveNotebooksListResult,
  ColabDrivePullCloseResult,
  ColabDrivePullStart,
  ColabNotebookAgentRequest,
  ColabNotebookAgentResponse,
  ColabNotebookAssistRequest,
  ColabNotebookAssistResult,
  ColabNotebookExecEvent,
  ColabNotebookExecuteResult,
  ColabNotebookImportResult,
  ColabNotebookVariablesResult,
  ColabPortForwardStartRequest,
  ColabPortForwardStartResult,
  ColabPortForwardView,
  ColabRemoteListResult,
  JupyterConnectRequest,
  JupyterConnectResult,
  JupyterSaveServerRequest,
  JupyterSaveServerResult,
  JupyterStateSnapshot,
  NotebookPullImportResult
} from './colab-notebook-types'

export type KunGuiColabApi = {
  colabGetSnapshot: () => Promise<ColabStateSnapshot>
  colabEnsureCliRuntime: (options?: { upgrade?: boolean }) => Promise<ColabCliRuntimeStatus>
  colabStartOAuthLogin: (input: {
    name?: string
    setAsCurrent?: boolean
    workspaceRoot?: string
    reauthConnectionId?: string
  }) => Promise<{ ok: true; flow: ColabOAuthPendingState } | { ok: false; message: string }>
  colabSubmitOAuthManualCode: (input: {
    flowId: string
    code: string
  }) => Promise<ColabLoginOutcome>
  colabPromoteMismatchedToken: (input: {
    pendingTokenId: string
    name?: string
    workspaceRoot?: string
    setAsCurrent?: boolean
  }) => Promise<ColabLoginOutcome>
  colabCancelOAuthLogin: (input: { flowId: string }) => Promise<{ ok: boolean }>
  colabReopenOAuthUrl: (input: { flowId: string }) => Promise<{ ok: boolean }>
  colabClearLastLoginOutcome: () => Promise<{ ok: boolean }>
  colabSelectWorkspaceConnection: (input: {
    workspaceRoot: string
    connectionId: string
  }) => Promise<{ ok: boolean; previousConnectionId: string | null }>
  colabRenameConnection: (input: {
    connectionId: string
    name: string
  }) => Promise<{ ok: boolean }>
  colabRefreshBalances: (input?: { connectionId?: string }) => Promise<ColabStateSnapshot>
  colabOpenBrowser: (input: {
    connectionId: string
    sessionId?: string
  }) => Promise<{ ok: boolean; url?: string; message?: string }>
  colabSignOutConnection: (input: {
    connectionId: string
    stopRunningSessions: boolean
  }) => Promise<{ ok: boolean; switchedToConnectionId: string | null; message?: string }>
  colabInspectWorkspaceSync: (input: {
    workspaceRoot: string
  }) => Promise<{
    candidates: ColabSyncCandidate[]
    savedConfig: ColabWorkspaceRunConfig | null
  }>
  colabSaveWorkspaceConfig: (input: {
    workspaceRoot: string
    config: ColabWorkspaceRunConfig
  }) => Promise<{ ok: boolean }>
  colabStartRun: (
    input: ColabStartRunRequest
  ) => Promise<{ ok: true; session: ColabSessionView } | { ok: false; code?: string; message: string }>
  colabStopSession: (input: { sessionId: string }) => Promise<{ ok: boolean; message?: string }>
  colabExtendSession: (input: {
    sessionId: string
    addMinutes: number
  }) => Promise<{ ok: boolean; session?: ColabSessionView; message?: string }>
  colabReconnectSession: (input: { sessionId: string }) => Promise<{ ok: boolean; message?: string }>
  colabUploadToSession: (input: {
    sessionId: string
    workspaceNotebook?: string
    targetRemoteDir?: string
  }) => Promise<RuntimeUploadResult>
  colabCancelUpload: (input: { sessionId: string }) => Promise<void>
  onColabUploadProgress: (handler: (event: RuntimeUploadEvent) => void) => () => void
  colabDownloadFromSession: (input: {
    sessionId: string
    remotePath?: string
  }) => Promise<{ ok: boolean; localPath?: string; message?: string }>
  colabPrepareTerminalLaunch: (input: {
    sessionId?: string
    connectionId?: string
    workspaceRoot?: string
  }) => Promise<
    | { ok: true; title: string; command: string; cwd?: string; env: Record<string, string> }
    | { ok: false; message: string }
  >
  colabAdoptUntrackedSession: (input: {
    connectionId: string
    endpoint: string
    workspaceRoot: string
  }) => Promise<{ ok: boolean; session?: ColabSessionView; message?: string }>
  colabStopUntrackedSession: (input: {
    connectionId: string
    endpoint: string
  }) => Promise<{ ok: boolean; message?: string }>
  colabIgnoreUntrackedSession: (input: {
    connectionId: string
    endpoint: string
  }) => Promise<{ ok: boolean }>
  onColabStateChanged: (handler: (snapshot: ColabStateSnapshot) => void) => () => void
  colabNotebookExecute: (input: {
    sessionId: string
    execId: string
    code: string
  }) => Promise<ColabNotebookExecuteResult>
  colabNotebookInterrupt: (input: { execId: string }) => Promise<{ ok: boolean }>
  colabNotebookRestart: (input: { sessionId: string }) => Promise<{ ok: boolean; message?: string }>
  colabNotebookListFiles: (input: { sessionId: string; path: string }) => Promise<ColabRemoteListResult>
  colabNotebookVariables: (input: { sessionId: string }) => Promise<ColabNotebookVariablesResult>
  colabDriveStartPull: (input: ColabDrivePullStart) => Promise<ColabDriveNotebooksListResult>
  colabDriveListNotebooks: (input: { pullId: string }) => Promise<ColabDriveNotebooksListResult>
  colabDriveCompleteAuth: (input: { pullId: string }) => Promise<ColabDriveNotebooksListResult>
  colabDriveOpenAuth: (input: { pullId: string }) => Promise<{ ok: boolean }>
  colabDriveClosePull: (input: { pullId: string }) => Promise<ColabDrivePullCloseResult>
  colabDriveImportNotebook: (input: { pullId: string; remotePath: string }) => Promise<NotebookPullImportResult>
  colabDriveGetMountState: (input: { sessionId: string; probe?: boolean }) => Promise<ColabDriveMountState>
  colabDriveMount: (input: { sessionId: string; forceRemount?: boolean }) => Promise<ColabDriveMountResult>
  colabDriveCompleteMountAuth: (input: { sessionId: string }) => Promise<ColabDriveMountResult>
  colabDriveOpenMountAuth: (input: { sessionId: string }) => Promise<{ ok: boolean }>
  colabDriveCancelMount: (input: { sessionId: string }) => Promise<ColabDriveMountState>
  colabDriveUnmount: (input: { sessionId: string }) => Promise<ColabDriveMountResult>
  onColabDriveMountChanged: (handler: (state: ColabDriveMountState) => void) => () => void
  colabImportLocalNotebooks: (input: { workspaceRoot: string }) => Promise<ColabNotebookImportResult>
  colabNotebookAssist: (input: ColabNotebookAssistRequest) => Promise<ColabNotebookAssistResult>
  onColabNotebookEvent: (handler: (event: ColabNotebookExecEvent) => void) => () => void
  jupyterGetSnapshot: () => Promise<JupyterStateSnapshot>
  jupyterSaveServer: (input: JupyterSaveServerRequest) => Promise<JupyterSaveServerResult>
  jupyterListNotebooks: (input: { serverId: string }) => Promise<ColabDriveNotebooksListResult>
  jupyterImportNotebook: (input: { serverId: string; workspaceRoot: string; remotePath: string }) => Promise<NotebookPullImportResult>
  jupyterConnect: (input: JupyterConnectRequest) => Promise<JupyterConnectResult>
  jupyterDisconnect: (input: { sessionId: string }) => Promise<{ ok: boolean }>
  jupyterRemoveServer: (input: { serverId: string }) => Promise<{ ok: boolean }>
  jupyterOpenBrowser: (input: { serverId: string }) => Promise<{ ok: boolean }>
  onJupyterStateChanged: (handler: (snapshot: JupyterStateSnapshot) => void) => () => void
  onColabNotebookAgentRequest: (handler: (request: ColabNotebookAgentRequest) => void) => () => void
  colabNotebookAgentRespond: (response: ColabNotebookAgentResponse) => Promise<{ ok: boolean }>
  colabPortForwardList: () => Promise<ColabPortForwardView[]>
  colabPortForwardStart: (input: ColabPortForwardStartRequest) => Promise<ColabPortForwardStartResult>
  colabPortForwardStop: (input: { forwardId: string }) => Promise<{ ok: boolean }>
  onColabPortForwardsChanged: (handler: (forwards: ColabPortForwardView[]) => void) => () => void
}
