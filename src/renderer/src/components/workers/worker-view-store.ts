import { create } from 'zustand'
import type { AttachmentReference } from '../../agent/types'

export type WorkerDraft = {
  text: string
  attachments: AttachmentReference[]
  /** Reused if admission was uncertain, so a retry cannot duplicate the turn. */
  requestId: string | null
}

export const EMPTY_WORKER_DRAFT: WorkerDraft = { text: '', attachments: [], requestId: null }

/** The workbench opens (or focuses) the worker's own right-panel tab. */
export const OPEN_WORKER_SESSION_EVENT = 'kun:open-worker-session'

type WorkerViewState = {
  drafts: Record<string, WorkerDraft>
  /** Last known label per worker, so its tab has a title before data loads. */
  labels: Record<string, string>
}

/**
 * Per-worker view state that outlives a worker tab: unsent input, the tab
 * title and the transcript scroll offset. Worker ids are thread ids, so one
 * flat map serves every manager thread.
 */
export const useWorkerViewStore = create<WorkerViewState>(() => ({ drafts: {}, labels: {} }))

export const workerScrollPositions = new Map<string, number>()

export function updateWorkerViewDraft(
  workerId: string,
  update: (current: WorkerDraft) => WorkerDraft
): void {
  useWorkerViewStore.setState((state) => ({
    drafts: { ...state.drafts, [workerId]: update(state.drafts[workerId] ?? EMPTY_WORKER_DRAFT) }
  }))
}

export function rememberWorkerLabel(workerId: string, label: string): void {
  const trimmed = label.trim()
  if (!trimmed || useWorkerViewStore.getState().labels[workerId] === trimmed) return
  useWorkerViewStore.setState((state) => ({ labels: { ...state.labels, [workerId]: trimmed } }))
}

export function openWorkerSession(workerId: string, label?: string): void {
  if (label) rememberWorkerLabel(workerId, label)
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_WORKER_SESSION_EVENT, { detail: { workerId } }))
}
