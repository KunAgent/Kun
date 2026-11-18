/** Rich output produced by one notebook cell execution on a Colab or Jupyter runtime. */
export type ColabNotebookOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'image'; mime: 'image/png'; data: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string }

export type ColabNotebookExecEvent =
  | { execId: string; kind: 'output'; output: ColabNotebookOutput }
  | { execId: string; kind: 'clear' }
  | { execId: string; kind: 'done'; ok: boolean; interrupted: boolean; message?: string }

export type ColabRemoteEntry = {
  name: string
  path: string
  isDir: boolean
  size: number
}

export type ColabKernelVariable = {
  name: string
  typeName: string
  summary: string
}

export type ColabNotebookExecuteResult = { ok: true } | { ok: false; message: string }

export type ColabRemoteListResult =
  | { ok: true; path: string; entries: ColabRemoteEntry[] }
  | { ok: false; message: string }

export type ColabNotebookVariablesResult =
  | { ok: true; variables: ColabKernelVariable[] }
  | { ok: false; message: string }

export type ColabDriveNotebookEntry = {
  name: string
  remotePath: string
  relativePath: string
  sizeBytes: number
  modifiedAtMs: number
}

export const NOTEBOOK_IMPORT_MAX_BYTES = 16 * 1024 * 1024
export const NOTEBOOK_PULL_MAX_FILES = 150
export const COLAB_NOTEBOOK_ENTRY_COMMAND = 'kun-notebook'
export const COLAB_DRIVE_PULL_SESSION_PREFIX = 'kun-drive-pull-'

export type ColabDrivePullStart = {
  pullId: string
  workspaceRoot: string
  connectionId: string
  runtime: { sessionId: string } | { temporaryCpu: true }
}

export type NotebookPullSave = {
  remotePath: string
  relativePath: string
  disposition: 'created' | 'renamed' | 'reused'
}

export type NotebookPullImportResult =
  | { ok: true; file: NotebookPullSave }
  | { ok: false; message: string }

export type ColabDrivePullCloseResult =
  | { ok: true; stoppedTemporary: boolean }
  | { ok: false; message: string }

export type ColabDriveNotebooksListResult =
  | { ok: true; status: 'ready'; entries: ColabDriveNotebookEntry[] }
  | { ok: true; status: 'needs_auth'; authUrl: string; expiresAt: number }
  | { ok: false; message: string; code?: 'auth_expired' | 'auth_incomplete' | 'canceled' }

export type ColabNotebookImportResult =
  | { ok: true; relativePaths: string[] }
  | { ok: false; canceled?: boolean; message?: string }

export type NotebookRuntimeBackend = 'colab' | 'jupyter'

export type JupyterServerView = {
  id: string
  name: string
  baseUrl: string
  hasAuth: boolean
  authMode?: 'token' | 'password' | 'none'
  kernelName: string
  availableKernels: string[]
  updatedAt: string
}

export type JupyterSessionView = {
  id: string
  serverId: string
  serverName: string
  baseUrl: string
  workspaceRoot: string
  kernelId: string
  kernelName: string
  startedAt: string
}

export type JupyterStateSnapshot = {
  servers: JupyterServerView[]
  sessions: JupyterSessionView[]
}

export type JupyterConnectRequest = {
  workspaceRoot: string
  serverId?: string
  name?: string
  url?: string
  tokenOrPassword?: string
  kernelName?: string
}

export type JupyterSaveServerRequest = Pick<JupyterConnectRequest, 'serverId' | 'name' | 'url' | 'tokenOrPassword'>

export type JupyterSaveServerResult =
  | { ok: true; server: JupyterServerView }
  | { ok: false; message: string }

export type JupyterConnectResult =
  | { ok: true; server: JupyterServerView; session: JupyterSessionView }
  | { ok: false; message: string }

export type ColabNotebookAssistCellContext = {
  kind: 'code' | 'markdown'
  source: string
  output?: string
  selected?: boolean
}

export type ColabNotebookAssistRequest = {
  prompt: string
  mode: 'insert' | 'replace'
  cells: ColabNotebookAssistCellContext[]
}

export type ColabNotebookAssistResult =
  | { ok: true; kind: 'code' | 'markdown'; source: string }
  | { ok: false; message: string }

/** Kun agent request relayed from the runtime bridge to the open notebook page. */
export type ColabNotebookAgentRequest =
  | { requestId: string; kind: 'run'; workspaceRoot: string; path?: string; cells?: number[] }
  | { requestId: string; kind: 'variables'; workspaceRoot: string }
  | { requestId: string; kind: 'interrupt'; workspaceRoot: string }

export type ColabNotebookAgentCellResult = {
  number: number
  kind: 'code' | 'markdown'
  status: 'ok' | 'error' | 'skipped' | 'not_run'
  executionCount: number | null
  output: string
}

export type ColabNotebookAgentResult =
  | {
      ok: true
      notebookPath?: string
      runtime?: string
      cells?: ColabNotebookAgentCellResult[]
      variables?: ColabKernelVariable[]
    }
  | { ok: false; message: string }

export type ColabNotebookAgentResponse =
  | { requestId: string; ack: true }
  | { requestId: string; result: ColabNotebookAgentResult }

/** Record separator prefix keeps protocol markers distinct from user prints. */
export const COLAB_NOTEBOOK_MARKER = '\u001eKUN_NB_'
