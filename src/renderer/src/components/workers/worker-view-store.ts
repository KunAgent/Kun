import { create } from 'zustand'
import type { WorkerDraft } from './WorkerInspector'

type WorkerView = {
  selectedWorkerId: string | null
  drafts: Record<string, WorkerDraft>
  scrollPositions: Map<string, number>
}
const emptyView = (): WorkerView => ({ selectedWorkerId: null, drafts: {}, scrollPositions: new Map() })

/** Local inspector state survives opening a worker or closing the tool panel. */
export const useWorkerViewStore = create<{ managers: Record<string, WorkerView> }>(() => ({ managers: {} }))

export function ensureWorkerView(managerId: string): WorkerView {
  const existing = useWorkerViewStore.getState().managers[managerId]
  if (existing) return existing
  const view = emptyView()
  useWorkerViewStore.setState((state) => ({ managers: { ...state.managers, [managerId]: view } }))
  return view
}

export function selectWorkerPreview(managerId: string, workerId: string | null): void {
  const view = ensureWorkerView(managerId)
  useWorkerViewStore.setState((state) => ({
    managers: { ...state.managers, [managerId]: { ...view, selectedWorkerId: workerId } }
  }))
}

export function updateWorkerViewDraft(
  managerId: string,
  workerId: string,
  update: (current: WorkerDraft) => WorkerDraft
): void {
  const view = ensureWorkerView(managerId)
  const draft = update(view.drafts[workerId] ?? { text: '', attachments: [], requestId: null })
  useWorkerViewStore.setState((state) => ({ managers: {
    ...state.managers, [managerId]: { ...view, drafts: { ...view.drafts, [workerId]: draft } }
  } }))
}
