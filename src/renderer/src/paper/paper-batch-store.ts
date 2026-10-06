import { create } from 'zustand'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperEvidenceMaterialResult } from '@shared/paper/paper-evidence-types'
import type { PaperTurnContext } from '@shared/paper/paper-turn-context'
import type { PaperReadingPurpose } from './paper-reading-request'

export const PAPER_BATCH_MAX_PAPERS = 20
export type PaperBatchItem = {
  entry: PaperLibraryEntry
  material?: PaperEvidenceMaterialResult & { ok: true }
  materialState: 'waiting' | 'loading' | 'ready' | 'error'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | 'uncertain'
  error?: string
  turnId?: string
  clientRequestId?: string
  context?: PaperTurnContext
  prompt?: string
  result?: string
  outputPath?: string
  outputRecorded?: boolean
}
export type PaperBatch = {
  id: string
  workspaceRoot: string
  sourceLabel: string
  items: PaperBatchItem[]
  purpose: PaperReadingPurpose
  question: string
  destination: 'conversation' | 'paper-files'
  consent: boolean
  phase: 'setup' | 'running' | 'canceling' | 'paused' | 'settled'
  cancelRequested: boolean
  providerId?: string
  model?: string
  threadId?: string
  resourcePath?: string
  language?: string
  error?: string
}
type PaperBatchState = {
  batch: PaperBatch | null
  revision: number
  stage: (workspaceRoot: string, entries: readonly PaperLibraryEntry[], sourceLabel: string) => boolean
  update: (id: string, patch: Partial<PaperBatch>) => void
  updateItem: (id: string, unitDir: string, patch: Partial<PaperBatchItem>) => void
  remove: (unitDir: string) => void
  close: () => void
}
export const paperBatchActive = (batch: PaperBatch | null): boolean => batch?.phase === 'running' || batch?.phase === 'canceling'

export const usePaperBatchStore = create<PaperBatchState>((set, get) => ({
  batch: null,
  revision: 0,
  stage: (workspaceRoot, entries, sourceLabel) => {
    if (paperBatchActive(get().batch)) return false
    const unique = [...new Map(entries.map((entry) => [entry.unitDir, entry])).values()]
    if (!workspaceRoot || !unique.length) return false
    set({ revision: get().revision + 1, batch: {
      id: crypto.randomUUID(), workspaceRoot, sourceLabel,
      items: unique.map((entry) => ({ entry: structuredClone(entry), materialState: 'waiting', status: 'pending' })),
      purpose: 'quick-screen', question: '', destination: 'conversation', consent: false,
      phase: 'setup', cancelRequested: false
    } })
    return true
  },
  update: (id, patch) => set((state) => state.batch?.id === id ? { batch: { ...state.batch, ...patch } } : {}),
  updateItem: (id, unitDir, patch) => set((state) => state.batch?.id === id ? {
    batch: { ...state.batch, items: state.batch.items.map((item) => item.entry.unitDir === unitDir ? { ...item, ...patch } : item) }
  } : {}),
  remove: (unitDir) => set((state) => state.batch?.phase === 'setup' ? {
    batch: { ...state.batch, consent: false, items: state.batch.items.filter((item) => item.entry.unitDir !== unitDir) }
  } : {}),
  close: () => { if (!paperBatchActive(get().batch)) set({ batch: null, revision: get().revision + 1 }) }
}))
