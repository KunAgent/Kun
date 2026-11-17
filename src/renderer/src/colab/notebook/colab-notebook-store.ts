import { create } from 'zustand'
import type { ColabAccelerator } from '@shared/colab/colab-types'
import type { ColabNotebookExecEvent, ColabRemoteEntry } from '@shared/colab/colab-notebook-types'
import {
  appendOutput,
  createCell,
  DEFAULT_NOTEBOOK_CELLS,
  parseIpynb,
  serializeIpynb,
  type NotebookCell,
  type NotebookCellKind
} from './ipynb-format'

export const COLAB_REMOTE_ROOT = '/content'
const NOTEBOOK_READ_MAX_BYTES = 16 * 1024 * 1024

type RemoteDir = { status: 'loading' | 'ready' | 'error'; entries: ColabRemoteEntry[]; error?: string }

type NotebookState = {
  workspaceRoot: string
  notebooks: string[]
  activePath: string | null
  cells: NotebookCell[]
  selectedCellId: string | null
  dirty: boolean
  loadError: string | null
  saving: boolean
  accelerator: ColabAccelerator
  runningCellId: string | null
  runningExecId: string | null
  queue: string[]
  execCounter: number
  remoteDirs: Record<string, RemoteDir>
  expandedDirs: string[]
}

type NotebookActions = {
  setAccelerator: (accelerator: ColabAccelerator) => void
  refreshNotebooks: (workspaceRoot: string) => Promise<void>
  openNotebook: (path: string) => Promise<void>
  createNotebook: (workspaceRoot: string) => Promise<void>
  saveNotebook: () => Promise<boolean>
  selectCell: (id: string | null) => void
  updateCellSource: (id: string, source: string) => void
  setCellKind: (id: string, kind: NotebookCellKind) => void
  addCell: (kind: NotebookCellKind, afterId?: string | null) => void
  applyAssistCell: (input: { kind: NotebookCellKind; source: string; replaceSelected: boolean }) => void
  deleteCell: (id: string) => void
  moveCell: (id: string, delta: -1 | 1) => void
  clearOutputs: () => void
  runCells: (sessionId: string, ids: string[]) => void
  interrupt: () => Promise<void>
  resetKernelState: () => void
  restartKernel: (sessionId: string) => Promise<void>
  loadRemoteDir: (sessionId: string, path: string) => Promise<void>
  toggleRemoteDir: (sessionId: string, path: string) => void
}

const initialState: NotebookState = {
  workspaceRoot: '',
  notebooks: [],
  activePath: null,
  cells: [],
  selectedCellId: null,
  dirty: false,
  loadError: null,
  saving: false,
  accelerator: 'T4',
  runningCellId: null,
  runningExecId: null,
  queue: [],
  execCounter: 0,
  remoteDirs: {},
  expandedDirs: [COLAB_REMOTE_ROOT]
}

let execSeq = 0
let activeSessionId: string | null = null
let unsubscribe: (() => void) | null = null

export const useColabNotebookStore = create<NotebookState & NotebookActions>((set, get) => {
  const patchCell = (id: string, patch: (cell: NotebookCell) => NotebookCell): void => {
    set((state) => ({ cells: state.cells.map((cell) => (cell.id === id ? patch(cell) : cell)), dirty: true }))
  }

  const startNext = (): void => {
    const state = get()
    if (state.runningExecId || !activeSessionId) return
    const [nextId, ...rest] = state.queue
    if (!nextId) return
    const cell = state.cells.find((c) => c.id === nextId)
    if (!cell || cell.kind !== 'code') {
      set({ queue: rest })
      startNext()
      return
    }
    execSeq += 1
    const execId = `nb-${Date.now().toString(36)}-${execSeq}`
    set({ queue: rest, runningCellId: cell.id, runningExecId: execId })
    patchCell(cell.id, (c) => ({ ...c, outputs: [], executionCount: null }))
    void window.kunGui
      .colabNotebookExecute({ sessionId: activeSessionId, execId, code: cell.source })
      .catch((error: unknown) => {
        handleEvent({ execId, kind: 'done', ok: false, interrupted: false, message: String(error) })
      })
  }

  const handleEvent = (event: ColabNotebookExecEvent): void => {
    const state = get()
    if (event.execId !== state.runningExecId || !state.runningCellId) return
    const cellId = state.runningCellId
    if (event.kind === 'output') {
      patchCell(cellId, (c) => ({ ...c, outputs: appendOutput(c.outputs, event.output) }))
      return
    }
    const count = state.execCounter + 1
    patchCell(cellId, (c) => ({
      ...c,
      executionCount: count,
      outputs: event.message
        ? appendOutput(c.outputs, { type: 'stream', name: 'stderr', text: `\n${event.message}\n` })
        : c.outputs
    }))
    // A failed cell stops the run-all queue, matching Jupyter.
    set({
      execCounter: count,
      runningCellId: null,
      runningExecId: null,
      queue: event.ok ? get().queue : []
    })
    startNext()
  }

  const ensureSubscribed = (): void => {
    if (unsubscribe || typeof window === 'undefined' || !window.kunGui?.onColabNotebookEvent) return
    unsubscribe = window.kunGui.onColabNotebookEvent(handleEvent)
  }

  return {
    ...initialState,

    setAccelerator: (accelerator) => set({ accelerator }),

    refreshNotebooks: async (workspaceRoot) => {
      if (workspaceRoot !== get().workspaceRoot) {
        set({ ...initialState, accelerator: get().accelerator, workspaceRoot })
      }
      if (!workspaceRoot) return
      const res = await window.kunGui.listWorkspaceFiles({ workspaceRoot })
      if (!res.ok || get().workspaceRoot !== workspaceRoot) return
      const notebooks = res.files
        .filter((file) => file.toLowerCase().endsWith('.ipynb') && !file.includes('.ipynb_checkpoints/'))
        .sort((a, b) => a.localeCompare(b))
      set({ notebooks })
      if (!get().activePath && notebooks[0]) await get().openNotebook(notebooks[0])
    },

    openNotebook: async (path) => {
      const { workspaceRoot, dirty, activePath } = get()
      if (path === activePath) return
      if (dirty) await get().saveNotebook()
      const res = await window.kunGui.readWorkspaceFile({ path, workspaceRoot, maxBytes: NOTEBOOK_READ_MAX_BYTES })
      if (!res.ok) {
        set({ activePath: path, cells: [], loadError: res.message, dirty: false })
        return
      }
      try {
        const cells = parseIpynb(res.content)
        set({
          activePath: path,
          cells: cells.length ? cells : [createCell('code')],
          selectedCellId: null,
          loadError: null,
          dirty: false
        })
      } catch (error) {
        set({ activePath: path, cells: [], loadError: error instanceof Error ? error.message : String(error), dirty: false })
      }
    },

    createNotebook: async (workspaceRoot) => {
      const existing = new Set(get().notebooks)
      let index = 1
      let name = 'Untitled.ipynb'
      while (existing.has(name)) {
        index += 1
        name = `Untitled${index}.ipynb`
      }
      const cells = DEFAULT_NOTEBOOK_CELLS()
      const res = await window.kunGui.createWorkspaceFile({
        workspaceRoot,
        path: name,
        content: serializeIpynb(cells, get().accelerator)
      })
      if (!res.ok) return
      if (get().dirty) await get().saveNotebook()
      set((state) => ({
        notebooks: [...state.notebooks, name].sort((a, b) => a.localeCompare(b)),
        activePath: name,
        cells,
        selectedCellId: cells[1]?.id ?? null,
        loadError: null,
        dirty: false
      }))
    },

    saveNotebook: async () => {
      const { activePath, workspaceRoot, cells, accelerator, loadError } = get()
      if (!activePath || loadError) return false
      set({ saving: true })
      const res = await window.kunGui.writeWorkspaceFile({
        path: activePath,
        workspaceRoot,
        content: serializeIpynb(cells, accelerator),
        force: true
      })
      set({ saving: false, dirty: res.ok ? false : get().dirty })
      return res.ok
    },

    selectCell: (id) => set({ selectedCellId: id }),
    updateCellSource: (id, source) => patchCell(id, (c) => ({ ...c, source })),
    setCellKind: (id, kind) => patchCell(id, (c) => ({ ...c, kind, outputs: kind === 'code' ? c.outputs : [] })),

    addCell: (kind, afterId) => {
      const cell = createCell(kind)
      set((state) => {
        const anchor = afterId ?? state.selectedCellId
        const index = anchor ? state.cells.findIndex((c) => c.id === anchor) : -1
        const cells = [...state.cells]
        cells.splice(index >= 0 ? index + 1 : cells.length, 0, cell)
        return { cells, selectedCellId: cell.id, dirty: true }
      })
    },

    applyAssistCell: ({ kind, source, replaceSelected }) => {
      set((state) => {
        const targetId = state.selectedCellId
        if (replaceSelected && targetId && targetId !== state.runningCellId) {
          const idx = state.cells.findIndex((c) => c.id === targetId)
          if (idx >= 0) {
            const cells = [...state.cells]
            cells[idx] = { ...cells[idx], kind, source, outputs: kind === 'code' ? cells[idx].outputs : [] }
            return { cells, dirty: true }
          }
        }
        const cell = createCell(kind, source)
        const index = targetId ? state.cells.findIndex((c) => c.id === targetId) : -1
        const cells = [...state.cells]
        cells.splice(index >= 0 ? index + 1 : cells.length, 0, cell)
        return { cells, selectedCellId: cell.id, dirty: true }
      })
    },

    deleteCell: (id) => {
      if (get().runningCellId === id) return
      set((state) => ({
        cells: state.cells.filter((c) => c.id !== id),
        queue: state.queue.filter((q) => q !== id),
        selectedCellId: state.selectedCellId === id ? null : state.selectedCellId,
        dirty: true
      }))
    },

    moveCell: (id, delta) => {
      set((state) => {
        const index = state.cells.findIndex((c) => c.id === id)
        const target = index + delta
        if (index < 0 || target < 0 || target >= state.cells.length) return state
        const cells = [...state.cells]
        const [cell] = cells.splice(index, 1)
        cells.splice(target, 0, cell)
        return { cells, dirty: true }
      })
    },

    clearOutputs: () =>
      set((state) => ({
        cells: state.cells.map((c) => (c.id === state.runningCellId ? c : { ...c, outputs: [], executionCount: null })),
        dirty: true
      })),

    runCells: (sessionId, ids) => {
      ensureSubscribed()
      activeSessionId = sessionId
      const queued = new Set(get().queue)
      const additions = ids.filter((id) => !queued.has(id) && id !== get().runningCellId)
      set((state) => ({ queue: [...state.queue, ...additions] }))
      startNext()
    },

    interrupt: async () => {
      const { runningExecId } = get()
      set({ queue: [] })
      if (runningExecId) await window.kunGui.colabNotebookInterrupt({ execId: runningExecId })
    },

    resetKernelState: () => set({ execCounter: 0, queue: [], remoteDirs: {} }),

    restartKernel: async (sessionId) => {
      await get().interrupt()
      // Killing the kernel process is how Colab restarts a session: the
      // runtime VM (and its files) stays, Python state is discarded.
      await window.kunGui
        .colabNotebookExecute({
          sessionId,
          execId: `nb-restart-${Date.now().toString(36)}`,
          code: 'import os, signal\nos.kill(os.getpid(), signal.SIGKILL)'
        })
        .catch(() => undefined)
      set({ execCounter: 0 })
    },

    loadRemoteDir: async (sessionId, path) => {
      set((state) => ({
        remoteDirs: { ...state.remoteDirs, [path]: { status: 'loading', entries: state.remoteDirs[path]?.entries ?? [] } }
      }))
      const res = await window.kunGui.colabNotebookListFiles({ sessionId, path })
      set((state) => ({
        remoteDirs: {
          ...state.remoteDirs,
          [path]: res.ok
            ? { status: 'ready', entries: res.entries }
            : { status: 'error', entries: [], error: res.message }
        }
      }))
    },

    toggleRemoteDir: (sessionId, path) => {
      const expanded = get().expandedDirs.includes(path)
      set((state) => ({
        expandedDirs: expanded ? state.expandedDirs.filter((p) => p !== path) : [...state.expandedDirs, path]
      }))
      if (!expanded && !get().remoteDirs[path]) void get().loadRemoteDir(sessionId, path)
    }
  }
})
