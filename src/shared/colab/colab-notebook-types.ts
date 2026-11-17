/** Rich output produced by one notebook cell execution on a Colab runtime. */
export type ColabNotebookOutput =
  | { type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { type: 'image'; mime: 'image/png'; data: string }
  | { type: 'error'; ename: string; evalue: string; traceback: string }

export type ColabNotebookExecEvent =
  | { execId: string; kind: 'output'; output: ColabNotebookOutput }
  | { execId: string; kind: 'done'; ok: boolean; interrupted: boolean; message?: string }

export type ColabRemoteEntry = {
  name: string
  path: string
  isDir: boolean
  size: number
}

export type ColabNotebookExecuteResult = { ok: true } | { ok: false; message: string }

export type ColabRemoteListResult =
  | { ok: true; path: string; entries: ColabRemoteEntry[] }
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

/** Record separator prefix keeps protocol markers distinct from user prints. */
export const COLAB_NOTEBOOK_MARKER = '\u001eKUN_NB_'
