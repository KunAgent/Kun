import { create } from 'zustand'
import type {
  PaperListUnitsResult,
  PaperProgressEvent,
  PaperUnitMetaV1,
  PaperUnitReadResult
} from '@shared/paper/paper-types'
import { normalizePath } from '../write-workspace-store-helpers'

export type PaperJobUiState = {
  requestId: string
  kind: PaperProgressEvent['kind']
  stage: string
  status: PaperProgressEvent['status']
  message?: string
  startedAt: number
  elapsedMs?: number
}

export type PaperNotice = {
  tone: 'success' | 'error' | 'info'
  message: string
} | null

export type PendingPaperInterpretation = {
  workspaceRoot: string
  /** Workspace-relative unit dir. */
  unitDir: string
  /** Workspace-relative directory the agent writes into (the unit dir). */
  outputDir: string
  /** File-name prefix, e.g. `1706.03762-解读` — matches `-N.md` variants. */
  fileStem: string
  /** Workspace-relative planned output file. */
  plannedPath: string
  startedAt: number
}

type PaperWorkspaceState = {
  /** unitDir (workspace-relative, forward slashes) → last read meta. */
  unitsByDir: Record<string, PaperUnitMetaV1>
  /** Sidebar listing for the configured papersDir. */
  units: Array<{ unitDir: string; meta: PaperUnitMetaV1 }>
  unitsLoaded: boolean
  unitsError: string | null
  importOpen: boolean
  busy: Partial<Record<'import' | 'cool-notes' | 'preprocess', PaperJobUiState>>
  notice: PaperNotice
  /** Interpretation turn in flight; resolved when the thread goes idle. */
  pendingInterpretation: PendingPaperInterpretation | null
  setUnitsFromResult: (result: PaperListUnitsResult & { ok: true }) => void
  setUnitsError: (message: string | null) => void
  rememberUnit: (unitDir: string, meta: PaperUnitMetaV1) => void
  setImportOpen: (open: boolean) => void
  beginJob: (kind: PaperJobUiState['kind'], requestId: string) => void
  applyProgress: (event: PaperProgressEvent) => void
  endJob: (requestId: string) => void
  setNotice: (notice: PaperNotice) => void
  setPendingInterpretation: (pending: PendingPaperInterpretation | null) => void
  reset: () => void
}

const emptyWorkspace = {
  unitsByDir: {},
  units: [],
  unitsLoaded: false,
  unitsError: null,
  importOpen: false,
  busy: {},
  notice: null,
  pendingInterpretation: null
}

function jobKeyForRequest(
  busy: PaperWorkspaceState['busy'],
  requestId: string
): keyof PaperWorkspaceState['busy'] | null {
  for (const [kind, job] of Object.entries(busy)) {
    if (job?.requestId === requestId) return kind as keyof PaperWorkspaceState['busy']
  }
  return null
}

export const usePaperStore = create<PaperWorkspaceState>((set, get) => ({
  ...emptyWorkspace,
  setUnitsFromResult: (result) => {
    const unitsByDir = { ...get().unitsByDir }
    for (const unit of result.units) unitsByDir[normalizePath(unit.unitDir)] = unit.meta
    set({ units: result.units, unitsByDir, unitsLoaded: true, unitsError: null })
  },
  setUnitsError: (message) => set({ unitsError: message, unitsLoaded: true }),
  rememberUnit: (unitDir, meta) =>
    set((state) => ({
      unitsByDir: { ...state.unitsByDir, [normalizePath(unitDir)]: meta }
    })),
  setImportOpen: (open) => set({ importOpen: open }),
  beginJob: (kind, requestId) =>
    set((state) => ({
      busy: {
        ...state.busy,
        [kind]: { requestId, kind, stage: 'start', status: 'running', startedAt: Date.now() }
      }
    })),
  applyProgress: (event) =>
    set((state) => {
      const kind = event.kind
      const current = state.busy[kind]
      if (!current || current.requestId !== event.requestId) return state
      if (event.status === 'running') {
        return {
          busy: {
            ...state.busy,
            [kind]: {
              ...current,
              stage: event.stage,
              status: 'running',
              message: event.message,
              elapsedMs: event.elapsedMs
            }
          }
        }
      }
      const busy = { ...state.busy }
      delete busy[kind]
      return { busy }
    }),
  endJob: (requestId) =>
    set((state) => {
      const kind = jobKeyForRequest(state.busy, requestId)
      if (!kind) return state
      const busy = { ...state.busy }
      delete busy[kind]
      return { busy }
    }),
  setNotice: (notice) => set({ notice }),
  setPendingInterpretation: (pending) => set({ pendingInterpretation: pending }),
  reset: () => set({ ...emptyWorkspace })
}))

export function paperReadUnit(
  workspaceRoot: string,
  unitDir: string
): Promise<PaperUnitReadResult> {
  return window.kunGui.paperReadUnit({ workspaceRoot, unitDir })
}

export function newPaperRequestId(): string {
  return `paper-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
