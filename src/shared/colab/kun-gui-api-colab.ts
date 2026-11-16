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
  colabReconnectSession: (input: { sessionId: string }) => Promise<{ ok: boolean; message?: string }>
  colabUploadToSession: (input: {
    sessionId: string
    localPaths?: string[]
  }) => Promise<{ ok: boolean; uploadedCount?: number; message?: string }>
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
}
