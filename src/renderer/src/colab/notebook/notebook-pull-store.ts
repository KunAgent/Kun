import { create } from 'zustand'
import {
  NOTEBOOK_IMPORT_MAX_BYTES,
  type ColabDriveNotebookEntry,
  type ColabDriveNotebooksListResult,
  type ColabDrivePullCloseResult,
  type ColabDrivePullStart,
  type NotebookPullImportResult,
  type NotebookPullSave
} from '@shared/colab/colab-notebook-types'
import { useColabNotebookStore } from './colab-notebook-store'

export type NotebookPullSource =
  | { kind: 'drive'; connectionId: string; label: string }
  | { kind: 'jupyter'; serverId: string; label: string }

type Phase = 'prepare' | 'reading' | 'auth' | 'select' | 'importing' | 'result' | 'error' | 'closing'
type PullError = { message?: string; kind?: 'auth_expired' | 'interrupted' }
type PullFailure = { entry: ColabDriveNotebookEntry; message?: string }
type DriveAccess = { id: string; temporary: boolean }

export type NotebookPullTask = {
  workspaceRoot: string
  source: NotebookPullSource
  phase: Phase
  access?: DriveAccess
  auth?: { url: string; expiresAt: number }
  error?: PullError
  cleanup?: 'stopping' | 'stopped' | 'failed'
  query: string
  entries: ColabDriveNotebookEntry[]
  picked: string[]
  saved: NotebookPullSave[]
  failed: PullFailure[]
  progress: { completed: number; total: number } | null
}

export function filterPullEntries(entries: ColabDriveNotebookEntry[], query: string): ColabDriveNotebookEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  return !needle ? entries : entries.filter(({ name, relativePath }) =>
    name.toLocaleLowerCase().includes(needle) || relativePath.toLocaleLowerCase().includes(needle))
}

export function canPullEntry(entry: ColabDriveNotebookEntry): boolean {
  return entry.sizeBytes <= NOTEBOOK_IMPORT_MAX_BYTES
}

type PullStore = {
  task: NotebookPullTask | null
  visible: boolean
  otherSourceRequested: boolean
  open: (source: NotebookPullSource, workspaceRoot: string) => void
  setDriveAccount: (connectionId: string, label: string) => void
  show: () => void
  hide: () => void
  workspaceChanged: (workspaceRoot: string) => void
  startDrive: (runtime: ColabDrivePullStart['runtime']) => Promise<void>
  completeAuth: () => Promise<void>
  reopenAuth: () => Promise<boolean>
  expireAuth: (id: string) => void
  refresh: () => Promise<void>
  setQuery: (query: string) => void
  setPicked: (paths: string[], picked: boolean) => void
  pullPicked: () => Promise<void>
  retryFailed: () => Promise<void>
  close: () => Promise<void>
}

function sameSource(a: NotebookPullSource, b: NotebookPullSource): boolean {
  return a.kind === 'drive'
    ? b.kind === 'drive' && a.connectionId === b.connectionId
    : b.kind === 'jupyter' && a.serverId === b.serverId
}

export const useNotebookPullStore = create<PullStore>((set, get) => {
  // IPC replies can arrive after cancel or project change. Only the current action owns the page.
  let revision = 0
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let currentWrite: Promise<unknown> | undefined
  let stopping: { id: string; result: Promise<ColabDrivePullCloseResult> } | undefined

  function patch(expected: number, update: Partial<NotebookPullTask>): boolean {
    const { task } = get()
    if (revision !== expected || !task) return false
    set({ task: { ...task, ...update } })
    return true
  }

  async function release(expected: number, access: DriveAccess | undefined): Promise<boolean> {
    clearTimeout(expiryTimer)
    if (!access) return true
    patch(expected, { auth: undefined, cleanup: access.temporary ? 'stopping' : undefined })
    // A project change can close the page while a result is already releasing its runtime.
    const pending = stopping?.id === access.id ? stopping : {
      id: access.id,
      result: Promise.resolve().then(() => window.kunGui.colabDriveClosePull({ pullId: access.id }))
    }
    stopping = pending
    try {
      const result = await pending.result
      if (result.ok) {
        patch(expected, { access: undefined, cleanup: result.stoppedTemporary ? 'stopped' : undefined })
        return true
      }
    } catch {
      // Keep the access ID so the same allocation can be stopped again.
    } finally {
      if (stopping === pending) stopping = undefined
    }
    patch(expected, { cleanup: 'failed' })
    return false
  }

  async function readList(load: () => Promise<ColabDriveNotebooksListResult>): Promise<void> {
    const ticket = ++revision
    clearTimeout(expiryTimer)
    patch(ticket, { phase: 'reading', auth: undefined, error: undefined })
    const result = await load().catch(() => ({ ok: false } as const))
    const { task } = get()
    if (!task || ticket !== revision) return
    if (result.ok && result.status === 'ready') {
      const valid = new Set(result.entries.filter(canPullEntry).map((item) => item.remotePath))
      const picked = task.picked.filter((path) => valid.has(path))
      patch(ticket, { phase: 'select', entries: result.entries, picked })
    } else if (result.ok && result.status === 'needs_auth') {
      const { access } = task
      if (!access) {
        patch(ticket, { phase: 'error', error: {} })
        return
      }
      patch(ticket, { phase: 'auth', auth: { url: result.authUrl, expiresAt: result.expiresAt } })
      expiryTimer = setTimeout(() => get().expireAuth(access.id), Math.max(0, result.expiresAt - Date.now()))
    } else {
      const message = 'message' in result ? result.message : undefined
      const kind = 'code' in result && result.code === 'auth_expired' ? 'auth_expired' : undefined
      patch(ticket, { phase: 'error', error: { message, kind } })
      await release(ticket, task.access)
    }
  }

  async function saveBatch(task: NotebookPullTask, entries: ColabDriveNotebookEntry[]): Promise<void> {
    if (entries.length === 0) return
    const ticket = ++revision
    let saved = task.saved
    const batchSavedPaths: string[] = []
    const retrying = new Set(entries.map((entry) => entry.remotePath))
    let failed = task.failed.filter(({ entry }) => !retrying.has(entry.remotePath))
    patch(ticket, { phase: 'importing', progress: { completed: 0, total: entries.length }, error: undefined })
    for (const [index, entry] of entries.entries()) {
      if (ticket !== revision) break
      const work = Promise.resolve().then<NotebookPullImportResult | { ok: false }>(() => {
        if (task.source.kind === 'jupyter') {
          return window.kunGui.jupyterImportNotebook({
            workspaceRoot: task.workspaceRoot, serverId: task.source.serverId, remotePath: entry.remotePath
          })
        }
        if (!task.access) return { ok: false } as const
        return window.kunGui.colabDriveImportNotebook({ pullId: task.access.id, remotePath: entry.remotePath })
      }).catch(() => ({ ok: false } as const))
      currentWrite = work
      const result = await work
      if (currentWrite === work) currentWrite = undefined
      if (ticket !== revision) break
      if (result.ok) {
        saved = [...saved, result.file]
        batchSavedPaths.push(result.file.relativePath)
      }
      else failed = [...failed, { entry, message: 'message' in result ? result.message : undefined }]
      patch(ticket, { saved, failed, progress: { completed: index + 1, total: entries.length } })
    }
    if (ticket !== revision) return
    patch(ticket, { phase: 'result', picked: [], progress: null })
    const notebook = useColabNotebookStore.getState()
    if (batchSavedPaths.length > 0) {
      notebook.recordRecentImports?.(task.workspaceRoot, batchSavedPaths, {
        kind: task.source.kind,
        label: task.source.label
      })
    }
    if (saved.length > 0 && notebook.workspaceRoot === task.workspaceRoot) {
      void notebook.refreshNotebooks(task.workspaceRoot, { selectFirst: false }).catch(() => undefined)
    }
    if (failed.length === 0) await release(ticket, task.access)
  }

  return {
    task: null,
    visible: false,
    otherSourceRequested: false,
    open: (source, workspaceRoot) => {
      if (!workspaceRoot) return
      const { task } = get()
      if (task) {
        if (task.workspaceRoot !== workspaceRoot) {
          if (task.cleanup === 'failed') set({ visible: true, otherSourceRequested: true })
          return
        }
        if (sameSource(task.source, source)) {
          set({ visible: true, otherSourceRequested: false })
          return
        }
        if (task.phase !== 'result' || task.failed.length > 0 || task.access) {
          set({ visible: true, otherSourceRequested: true })
          return
        }
      }
      set({
        visible: true, otherSourceRequested: false,
        task: { workspaceRoot, source, phase: 'prepare', query: '', entries: [], picked: [], saved: [], failed: [], progress: null }
      })
      if (source.kind === 'jupyter') void get().refresh()
    },
    setDriveAccount: (connectionId, label) => {
      const { task } = get()
      if (!task || task.source.kind !== 'drive' || task.phase !== 'prepare' || task.access) return
      set({ task: { ...task, source: { kind: 'drive', connectionId, label }, error: undefined } })
    },
    show: () => set({ visible: true, otherSourceRequested: false }),
    hide: () => set({ visible: false, otherSourceRequested: false }),
    workspaceChanged: (workspaceRoot) => {
      const { task } = get()
      if (!task || task.workspaceRoot === workspaceRoot) return
      set({ visible: false, otherSourceRequested: false })
      if (task.phase !== 'closing') void get().close()
    },
    startDrive: async (runtime) => {
      const { task } = get()
      if (!task || task.source.kind !== 'drive' || task.access || !['prepare', 'error', 'result'].includes(task.phase)) return
      const pullId = crypto.randomUUID()
      set({ task: { ...task, access: { id: pullId, temporary: 'temporaryCpu' in runtime }, cleanup: undefined } })
      const { connectionId } = task.source
      await readList(() => window.kunGui.colabDriveStartPull({ pullId, workspaceRoot: task.workspaceRoot, connectionId, runtime }))
    },
    completeAuth: async () => {
      const { task } = get()
      if (task?.phase !== 'auth' || !task.access || !task.auth) return
      const pullId = task.access.id
      if (Date.now() >= task.auth.expiresAt) {
        get().expireAuth(pullId)
        return
      }
      await readList(() => window.kunGui.colabDriveCompleteAuth({ pullId }))
    },
    reopenAuth: async () => {
      const { task } = get()
      if (task?.phase !== 'auth' || !task.access) return false
      const pullId = task.access.id
      try { return (await window.kunGui.colabDriveOpenAuth({ pullId })).ok } catch { return false }
    },
    expireAuth: (id) => {
      const { task } = get()
      if (task?.phase !== 'auth' || task.access?.id !== id) return
      const ticket = ++revision
      patch(ticket, { phase: 'error', error: { kind: 'auth_expired' } })
      void release(ticket, task.access)
    },
    refresh: async () => {
      const { task } = get()
      if (!task || !['prepare', 'select', 'error', 'result'].includes(task.phase) || task.cleanup === 'stopping' || task.cleanup === 'failed') return
      const { source, access } = task
      if (source.kind === 'jupyter') await readList(() => window.kunGui.jupyterListNotebooks({ serverId: source.serverId }))
      else if (access) await readList(() => window.kunGui.colabDriveListNotebooks({ pullId: access.id }))
      else set({ task: { ...task, phase: 'prepare', error: undefined } })
    },
    setQuery: (query) => { patch(revision, { query }) },
    setPicked: (paths, picked) => {
      const { task } = get()
      if (task?.phase !== 'select') return
      const verified = new Set(task.entries.filter(canPullEntry).map((entry) => entry.remotePath))
      const next = new Set(task.picked)
      paths.forEach((path) => {
        if (picked && verified.has(path)) next.add(path)
        else next.delete(path)
      })
      patch(revision, { picked: [...next] })
    },
    pullPicked: async () => {
      const { task } = get()
      if (task?.phase !== 'select') return
      const picked = new Set(task.picked)
      const saved = new Set(task.saved.map(({ remotePath }) => remotePath))
      await saveBatch(task, task.entries.filter((entry) => picked.has(entry.remotePath) && canPullEntry(entry) && !saved.has(entry.remotePath)))
    },
    retryFailed: async () => {
      const { task } = get()
      if (task?.phase !== 'result' || !task.failed.length || task.cleanup === 'stopping' || task.cleanup === 'failed') return
      if (task.source.kind === 'jupyter') {
        await saveBatch(task, task.failed.map(({ entry }) => entry))
      } else if (task.access) {
        const pullId = task.access.id
        patch(revision, { picked: task.failed.map(({ entry }) => entry.remotePath) })
        await readList(() => window.kunGui.colabDriveListNotebooks({ pullId }))
        const latest = get().task
        if (latest?.phase === 'select' && latest.access?.id === pullId) await get().pullPicked()
      } else {
        patch(revision, { phase: 'prepare', picked: task.failed.map(({ entry }) => entry.remotePath) })
      }
    },
    close: async () => {
      const { task } = get()
      if (!task || task.phase === 'closing') return
      const ticket = ++revision
      patch(ticket, { phase: 'closing', auth: undefined })
      // Stop the Drive helper first; a Jupyter copy already writing may finish, but no more start.
      const [released] = await Promise.all([release(ticket, task.access), currentWrite])
      const notebook = useColabNotebookStore.getState()
      if (notebook.workspaceRoot === task.workspaceRoot) {
        void notebook.refreshNotebooks(task.workspaceRoot, { selectFirst: false }).catch(() => undefined)
      }
      if (ticket !== revision) return
      if (released) set({ task: null, visible: false, otherSourceRequested: false })
      else patch(ticket, { phase: 'error', error: { kind: 'interrupted' }, progress: null })
    }
  }
})
