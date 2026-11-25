import { create } from 'zustand'
import type { ColabAccelerator } from '@shared/colab/colab-types'
import type {
  ColabKernelVariable,
  ColabNotebookExecEvent,
  ColabRemoteEntry,
  NotebookRuntimeBackend
} from '@shared/colab/colab-notebook-types'
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

/** A cell the user asked Kun about; the side panel consumes it into the composer. */
export type ColabKunCellRequest = { cellNumber: number; nonce: number }

export type NotebookSidePanelTab = 'kun' | 'variables' | 'files' | 'ports' | 'resources'

export type NotebookColabLaunchOptions = {
  highMem: boolean
  requireA10080Gb: boolean
  mountDrive: boolean
  maxRuntimeHours: number
  idleAutoStopMinutes: number
  maxSpendCu: number | null
  minBalanceCu: number | null
}

export type NotebookRecentImport = {
  workspaceRoot: string
  relativePath: string
  sourceKind: 'drive' | 'jupyter'
  sourceLabel: string
}

function computeChangedCellIds(baseline: NotebookCell[], next: NotebookCell[]): string[] {
  const counts = new Map<string, number>()
  for (const cell of baseline) {
    const key = `${cell.kind}\0${cell.source}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const changed: string[] = []
  for (const cell of next) {
    const key = `${cell.kind}\0${cell.source}`
    const left = counts.get(key) ?? 0
    if (left > 0) counts.set(key, left - 1)
    else changed.push(cell.id)
  }
  return changed
}

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
  launchOptions: NotebookColabLaunchOptions
  runningCellId: string | null
  runningExecId: string | null
  runningStartedAt: number | null
  cellDurationsMs: Record<string, number>
  queue: string[]
  execCounter: number
  remoteDirs: Record<string, RemoteDir>
  expandedDirs: string[]
  variables: ColabKernelVariable[]
  variablesLoading: boolean
  runtimeBackend: NotebookRuntimeBackend
  sidePanelOpen: boolean
  sidePanelTab: NotebookSidePanelTab
  kernelPickerOpen: boolean
  kernelPickerInitialAddJupyter: boolean
  kernelPickerTabOverride: NotebookRuntimeBackend | null
  lastSavedAt: number | null
  recentImports: NotebookRecentImport[]
  connectionsFocusRequest: number
  kunCellRequest: ColabKunCellRequest | null
  kunBaselineCells: NotebookCell[] | null
  kunChangedCellIds: string[]
  /** Kun is editing the .ipynb on disk; local edits pause so they cannot overwrite its writes. */
  kunBusy: boolean
}

type NotebookActions = {
  setAccelerator: (accelerator: ColabAccelerator) => void
  patchLaunchOptions: (patch: Partial<NotebookColabLaunchOptions>) => void
  setRuntimeBackend: (backend: NotebookRuntimeBackend) => void
  refreshNotebooks: (workspaceRoot: string, options?: { selectFirst?: boolean }) => Promise<void>
  openNotebook: (path: string) => Promise<void>
  createNotebook: (workspaceRoot: string) => Promise<void>
  importLocalNotebooks: (workspaceRoot: string) => Promise<boolean>
  saveNotebook: () => Promise<boolean>
  selectCell: (id: string | null) => void
  updateCellSource: (id: string, source: string) => void
  setCellKind: (id: string, kind: NotebookCellKind) => void
  addCell: (kind: NotebookCellKind, afterId?: string | null) => void
  setSidePanelOpen: (open: boolean) => void
  setSidePanelTab: (tab: NotebookSidePanelTab) => void
  setKernelPickerOpen: (
    open: boolean,
    options?: { addJupyter?: boolean; backend?: NotebookRuntimeBackend }
  ) => void
  recordRecentImports: (
    workspaceRoot: string,
    relativePaths: string[],
    source: { kind: 'drive' | 'jupyter'; label: string }
  ) => void
  focusConnections: () => void
  askKunAboutCell: (id: string) => void
  consumeKunCellRequest: () => void
  captureKunBaseline: () => void
  undoKunChanges: () => Promise<void>
  dismissKunChanges: () => void
  reloadActiveNotebook: () => Promise<void>
  deleteCell: (id: string) => void
  moveCell: (id: string, delta: -1 | 1) => void
  clearOutputs: () => void
  runCells: (sessionId: string, ids: string[], options?: { agent?: boolean }) => void
  /** Runs cells for a Kun tool call and resolves once they finish or the queue stops. */
  runCellsAndWait: (sessionId: string, ids: string[]) => Promise<void>
  setKunBusy: (busy: boolean) => void
  interrupt: () => Promise<void>
  resetKernelState: () => void
  restartKernel: (sessionId: string) => Promise<void>
  loadRemoteDir: (sessionId: string, path: string) => Promise<void>
  revealRemotePaths: (sessionId: string, paths: string[]) => Promise<void>
  toggleRemoteDir: (sessionId: string, path: string) => void
  loadVariables: (sessionId: string) => Promise<void>
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
  launchOptions: {
    highMem: false,
    requireA10080Gb: false,
    mountDrive: true,
    maxRuntimeHours: 2,
    idleAutoStopMinutes: 30,
    maxSpendCu: null,
    minBalanceCu: null
  },
  runningCellId: null,
  runningExecId: null,
  runningStartedAt: null,
  cellDurationsMs: {},
  queue: [],
  execCounter: 0,
  remoteDirs: {},
  expandedDirs: [COLAB_REMOTE_ROOT, '/'],
  variables: [],
  variablesLoading: false,
  runtimeBackend: 'colab',
  sidePanelOpen: true,
  sidePanelTab: 'kun',
  kernelPickerOpen: false,
  kernelPickerInitialAddJupyter: false,
  kernelPickerTabOverride: null,
  lastSavedAt: null,
  recentImports: [],
  connectionsFocusRequest: 0,
  kunCellRequest: null,
  kunBaselineCells: null,
  kunChangedCellIds: [],
  kunBusy: false
}

let execSeq = 0
let activeSessionId: string | null = null
let unsubscribe: (() => void) | null = null

export const useColabNotebookStore = create<NotebookState & NotebookActions>((set, get, api) => {
  const patchCell = (id: string, patch: (cell: NotebookCell) => NotebookCell): void => {
    set((state) => ({ cells: state.cells.map((cell) => (cell.id === id ? patch(cell) : cell)), dirty: true }))
  }
  const editLocked = (): boolean => get().kunBusy

  const startNext = (): void => {
    const state = get()
    if (state.runningExecId || !activeSessionId) return
    const [nextId, ...rest] = state.queue
    if (!nextId) {
      if (typeof window.kunGui?.colabNotebookVariables === 'function') void get().loadVariables(activeSessionId)
      return
    }
    const cell = state.cells.find((c) => c.id === nextId)
    if (!cell || cell.kind !== 'code') {
      set({ queue: rest })
      startNext()
      return
    }
    execSeq += 1
    const execId = `nb-${Date.now().toString(36)}-${execSeq}`
    set((current) => {
      const nextDurations = { ...current.cellDurationsMs }
      delete nextDurations[cell.id]
      return {
        queue: rest,
        runningCellId: cell.id,
        runningExecId: execId,
        runningStartedAt: Date.now(),
        cellDurationsMs: nextDurations
      }
    })
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
    if (event.kind === 'clear') {
      patchCell(cellId, (c) => ({ ...c, outputs: [] }))
      return
    }
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
    const elapsedMs =
      state.runningStartedAt != null ? Math.max(0, Date.now() - state.runningStartedAt) : null
    // A failed cell stops the run-all queue, matching Jupyter.
    set((current) => ({
      execCounter: count,
      runningCellId: null,
      runningExecId: null,
      runningStartedAt: null,
      cellDurationsMs:
        event.ok && elapsedMs != null
          ? { ...current.cellDurationsMs, [cellId]: elapsedMs }
          : current.cellDurationsMs,
      queue: event.ok ? current.queue : []
    }))
    startNext()
  }

  const ensureSubscribed = (): void => {
    if (unsubscribe || typeof window === 'undefined' || !window.kunGui?.onColabNotebookEvent) return
    unsubscribe = window.kunGui.onColabNotebookEvent(handleEvent)
  }

  return {
    ...initialState,

    setAccelerator: (accelerator) => set({ accelerator }),
    patchLaunchOptions: (patch) =>
      set((state) => ({ launchOptions: { ...state.launchOptions, ...patch } })),
    setRuntimeBackend: (runtimeBackend) => set({ runtimeBackend }),

    refreshNotebooks: async (workspaceRoot, options) => {
      if (workspaceRoot !== get().workspaceRoot) {
        const {
          accelerator,
          launchOptions,
          runtimeBackend,
          sidePanelOpen,
          sidePanelTab,
          recentImports,
          connectionsFocusRequest,
          kunBusy
        } = get()
        set({
          ...initialState,
          accelerator,
          launchOptions,
          runtimeBackend,
          sidePanelOpen,
          sidePanelTab,
          recentImports,
          connectionsFocusRequest,
          kunBusy,
          workspaceRoot
        })
      }
      if (!workspaceRoot) return
      const res = await window.kunGui.listWorkspaceFiles({ workspaceRoot })
      if (!res.ok || get().workspaceRoot !== workspaceRoot) return
      const notebooks = res.files
        .filter((file) => file.toLowerCase().endsWith('.ipynb') && !file.includes('.ipynb_checkpoints/'))
        .sort((a, b) => a.localeCompare(b))
      set({ notebooks })
      if (options?.selectFirst !== false && !get().activePath && notebooks[0]) await get().openNotebook(notebooks[0])
    },

    openNotebook: async (path) => {
      const { workspaceRoot, dirty, activePath } = get()
      if (path === activePath) return
      if (dirty) await get().saveNotebook()
      const res = await window.kunGui.readWorkspaceFile({ path, workspaceRoot, maxBytes: NOTEBOOK_READ_MAX_BYTES })
      if (!res.ok) {
        set({
          activePath: path,
          cells: [],
          loadError: res.message,
          dirty: false,
          runningStartedAt: null,
          cellDurationsMs: {},
          kunBaselineCells: null,
          kunChangedCellIds: []
        })
        return
      }
      try {
        const cells = parseIpynb(res.content)
        set({
          activePath: path,
          cells: cells.length ? cells : [createCell('code')],
          selectedCellId: null,
          loadError: null,
          dirty: false,
          kunBaselineCells: null,
          kunChangedCellIds: []
        })
      } catch (error) {
        set({
          activePath: path,
          cells: [],
          loadError: error instanceof Error ? error.message : String(error),
          dirty: false,
          kunBaselineCells: null,
          kunChangedCellIds: []
        })
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
        dirty: false,
        kunBaselineCells: null,
        kunChangedCellIds: []
      }))
    },

    importLocalNotebooks: async (workspaceRoot) => {
      if (!workspaceRoot || typeof window.kunGui?.colabImportLocalNotebooks !== 'function') return false
      const res = await window.kunGui.colabImportLocalNotebooks({ workspaceRoot })
      if (!res.ok || res.relativePaths.length === 0 || get().workspaceRoot !== workspaceRoot) return false
      await get().refreshNotebooks(workspaceRoot, { selectFirst: false })
      if (get().workspaceRoot !== workspaceRoot) return false
      await get().openNotebook(res.relativePaths[0])
      return get().activePath === res.relativePaths[0]
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
      set({
        saving: false,
        dirty: res.ok ? false : get().dirty,
        ...(res.ok ? { lastSavedAt: Date.now() } : {})
      })
      return res.ok
    },

    selectCell: (id) => set({ selectedCellId: id }),
    updateCellSource: (id, source) => {
      if (!editLocked()) patchCell(id, (c) => ({ ...c, source }))
    },
    setCellKind: (id, kind) => {
      if (!editLocked()) patchCell(id, (c) => ({ ...c, kind, outputs: kind === 'code' ? c.outputs : [] }))
    },

    addCell: (kind, afterId) => {
      if (editLocked()) return
      const cell = createCell(kind)
      set((state) => {
        const anchor = afterId ?? state.selectedCellId
        const index = anchor ? state.cells.findIndex((c) => c.id === anchor) : -1
        const cells = [...state.cells]
        cells.splice(index >= 0 ? index + 1 : cells.length, 0, cell)
        return { cells, selectedCellId: cell.id, dirty: true }
      })
    },

    setSidePanelOpen: (open) => set({ sidePanelOpen: open }),
    setSidePanelTab: (tab) => set({ sidePanelOpen: true, sidePanelTab: tab }),
    setKernelPickerOpen: (open, options) =>
      set({
        kernelPickerOpen: open,
        kernelPickerInitialAddJupyter: open ? Boolean(options?.addJupyter) : false,
        kernelPickerTabOverride: open
          ? options?.addJupyter
            ? 'jupyter'
            : (options?.backend ?? null)
          : null
      }),
    recordRecentImports: (workspaceRoot, relativePaths, source) => {
      if (!workspaceRoot || relativePaths.length === 0) return
      set((state) => {
        const added: NotebookRecentImport[] = relativePaths.map((relativePath) => ({
          workspaceRoot,
          relativePath,
          sourceKind: source.kind,
          sourceLabel: source.label
        }))
        const addedKeys = new Set(added.map((item) => `${item.workspaceRoot}\0${item.relativePath}`))
        const rest = state.recentImports.filter(
          (item) => !addedKeys.has(`${item.workspaceRoot}\0${item.relativePath}`)
        )
        return { recentImports: [...added, ...rest].slice(0, 12) }
      })
    },
    focusConnections: () =>
      set((state) => ({
        kernelPickerOpen: true,
        kernelPickerInitialAddJupyter: false,
        connectionsFocusRequest: state.connectionsFocusRequest + 1
      })),

    askKunAboutCell: (id) => {
      const index = get().cells.findIndex((c) => c.id === id)
      if (index < 0) return
      set((state) => ({
        sidePanelOpen: true,
        sidePanelTab: 'kun',
        selectedCellId: id,
        kunCellRequest: { cellNumber: index + 1, nonce: (state.kunCellRequest?.nonce ?? 0) + 1 }
      }))
    },

    consumeKunCellRequest: () => set({ kunCellRequest: null }),

    captureKunBaseline: () => {
      set((state) => ({
        kunBaselineCells: state.cells.map((c) => ({ ...c, outputs: [...c.outputs] })),
        kunChangedCellIds: []
      }))
    },

    undoKunChanges: async () => {
      const { kunBaselineCells } = get()
      if (!kunBaselineCells) return
      set({
        cells: kunBaselineCells,
        kunBaselineCells: null,
        kunChangedCellIds: [],
        selectedCellId: null,
        dirty: true
      })
      await get().saveNotebook()
    },

    dismissKunChanges: () => set({ kunBaselineCells: null, kunChangedCellIds: [] }),

    // Kun edits the .ipynb on disk; pick that up unless local edits, a save, or a run would be lost.
    reloadActiveNotebook: async () => {
      const { activePath, workspaceRoot, dirty, saving, runningExecId, queue, cells, accelerator, kunBaselineCells } = get()
      if (!activePath || dirty || saving || runningExecId || queue.length > 0) return
      const res = await window.kunGui.readWorkspaceFile({ path: activePath, workspaceRoot, maxBytes: NOTEBOOK_READ_MAX_BYTES })
      const current = get()
      if (!res.ok || current.activePath !== activePath || current.dirty || current.saving || current.runningExecId || current.queue.length > 0) return
      if (res.content === serializeIpynb(cells, accelerator)) return
      try {
        const parsed = parseIpynb(res.content)
        const next = parsed.length ? parsed : [createCell('code')]
        const baseline = kunBaselineCells ?? cells
        const changedIds = computeChangedCellIds(baseline, next)
        set({
          cells: next,
          selectedCellId: changedIds[0] ?? null,
          loadError: null,
          dirty: false,
          kunBaselineCells: baseline,
          kunChangedCellIds: changedIds
        })
      } catch {
        // A half-written file stays unloaded; the next turn end retries.
      }
    },

    deleteCell: (id) => {
      if (editLocked() || get().runningCellId === id) return
      set((state) => ({
        cells: state.cells.filter((c) => c.id !== id),
        queue: state.queue.filter((q) => q !== id),
        selectedCellId: state.selectedCellId === id ? null : state.selectedCellId,
        kunChangedCellIds: state.kunChangedCellIds.filter((cid) => cid !== id),
        dirty: true
      }))
    },

    moveCell: (id, delta) => {
      if (editLocked()) return
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

    clearOutputs: () => {
      if (editLocked()) return
      set((state) => ({
        cells: state.cells.map((c) => (c.id === state.runningCellId ? c : { ...c, outputs: [], executionCount: null })),
        cellDurationsMs: state.runningCellId && state.cellDurationsMs[state.runningCellId] != null
          ? { [state.runningCellId]: state.cellDurationsMs[state.runningCellId]! }
          : {},
        dirty: true
      }))
    },

    runCells: (sessionId, ids, options) => {
      // User runs mark outputs dirty, which would block reloading Kun's edits mid-turn.
      if (editLocked() && !options?.agent) return
      ensureSubscribed()
      activeSessionId = sessionId
      const queued = new Set(get().queue)
      const additions = ids.filter((id) => !queued.has(id) && id !== get().runningCellId)
      set((state) => ({ queue: [...state.queue, ...additions] }))
      startNext()
    },

    runCellsAndWait: async (sessionId, ids) => {
      get().runCells(sessionId, ids, { agent: true })
      const finished = (): boolean => {
        const state = get()
        return !state.runningExecId && !state.queue.some((id) => ids.includes(id))
      }
      if (finished()) return
      await new Promise<void>((resolve) => {
        const unsubscribeStore = api.subscribe(() => {
          if (!finished()) return
          unsubscribeStore()
          resolve()
        })
      })
    },

    setKunBusy: (kunBusy) => {
      if (get().kunBusy !== kunBusy) set({ kunBusy })
    },

    interrupt: async () => {
      const { runningExecId } = get()
      set({ queue: [] })
      if (runningExecId) await window.kunGui.colabNotebookInterrupt({ execId: runningExecId })
    },

    resetKernelState: () =>
      set({ execCounter: 0, queue: [], remoteDirs: {}, expandedDirs: [], variables: [] }),

    restartKernel: async (sessionId) => {
      await get().interrupt()
      if (typeof window.kunGui?.colabNotebookRestart === 'function') {
        await window.kunGui.colabNotebookRestart({ sessionId }).catch(() => undefined)
      } else {
        await window.kunGui
          .colabNotebookExecute({
            sessionId,
            execId: `nb-restart-${Date.now().toString(36)}`,
            code: 'import os, signal\nos.kill(os.getpid(), signal.SIGKILL)'
          })
          .catch(() => undefined)
      }
      set({ execCounter: 0, variables: [] })
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

    revealRemotePaths: async (sessionId, paths) => {
      const all: string[] = []
      for (const raw of paths) {
        const cleaned = raw.trim().replace(/\/+$/, '') || '/'
        if (cleaned.startsWith('/content/')) {
          const segs = cleaned.split('/').filter(Boolean)
          let cur = ''
          for (const seg of segs) {
            cur += `/${seg}`
            all.push(cur)
          }
        } else {
          all.push(cleaned)
        }
      }
      const unique = [...new Set(all.filter(Boolean))]
      set((state) => ({
        expandedDirs: [...new Set([...state.expandedDirs, ...unique])]
      }))
      await Promise.all(unique.map((p) => get().loadRemoteDir(sessionId, p)))
    },

    toggleRemoteDir: (sessionId, path) => {
      const expanded = get().expandedDirs.includes(path)
      set((state) => ({
        expandedDirs: expanded ? state.expandedDirs.filter((p) => p !== path) : [...state.expandedDirs, path]
      }))
      if (!expanded && !get().remoteDirs[path]) void get().loadRemoteDir(sessionId, path)
    },

    loadVariables: async (sessionId) => {
      if (typeof window.kunGui?.colabNotebookVariables !== 'function') return
      set({ variablesLoading: true })
      try {
        const res = await window.kunGui.colabNotebookVariables({ sessionId })
        if (res.ok) set({ variables: res.variables })
      } finally {
        set({ variablesLoading: false })
      }
    }
  }
})
