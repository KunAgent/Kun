import { create } from 'zustand'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

/**
 * Work sidebar view: `sessions` lists conversations grouped by space (the
 * Code-aligned default), `files` shows the directory tree.
 */
export type WorkSidebarView = 'sessions' | 'files'

/**
 * The session the user picked explicitly. An empty `threadId` is a draft: the
 * next send starts a new session in `workspaceRoot`.
 */
export type WorkSessionPin = { workspaceRoot: string; threadId: string }

export const WORK_SIDEBAR_VIEW_KEY = 'kun.work.sidebarView.v1'

export function readWorkSidebarView(): WorkSidebarView {
  return readBrowserStorageItem(WORK_SIDEBAR_VIEW_KEY) === 'files' ? 'files' : 'sessions'
}

type WorkSidebarState = {
  view: WorkSidebarView
  pin: WorkSessionPin | null
  /** Thread creation/selection in flight; the assistant runtime waits for it. */
  transitions: number
  setView: (view: WorkSidebarView) => void
  pinSession: (workspaceRoot: string, threadId: string) => void
  startDraft: (workspaceRoot: string) => void
  clearPin: () => void
}

export const useWorkSidebarStore = create<WorkSidebarState>((set) => ({
  view: readWorkSidebarView(),
  pin: null,
  transitions: 0,
  setView: (view) => {
    writeBrowserStorageItem(WORK_SIDEBAR_VIEW_KEY, view)
    set({ view })
  },
  pinSession: (workspaceRoot, threadId) => {
    const root = normalizeWorkspaceRoot(workspaceRoot)
    const id = threadId.trim()
    if (!root || !id) return
    set({ pin: { workspaceRoot: root, threadId: id } })
  },
  startDraft: (workspaceRoot) => {
    const root = normalizeWorkspaceRoot(workspaceRoot)
    if (root) set({ pin: { workspaceRoot: root, threadId: '' } })
  },
  clearPin: () => set({ pin: null })
}))

/** Marks a Work thread switch in flight; call the returned function when done. */
export function beginWorkSessionTransition(): () => void {
  useWorkSidebarStore.setState((state) => ({ transitions: state.transitions + 1 }))
  let ended = false
  return () => {
    if (ended) return
    ended = true
    useWorkSidebarStore.setState((state) => ({ transitions: Math.max(0, state.transitions - 1) }))
  }
}

/**
 * The pin governs the conversation in the sessions view, and in the files
 * view only while nothing is open (the conversation then fills the center).
 */
export function applicableWorkSessionPin(input: {
  view: WorkSidebarView
  pin: WorkSessionPin | null
  workspaceRoot: string
  documentContext: boolean
}): WorkSessionPin | null {
  const { pin } = input
  if (!pin) return null
  if (normalizeWorkspaceRoot(pin.workspaceRoot) !== normalizeWorkspaceRoot(input.workspaceRoot)) return null
  if (input.view !== 'sessions' && input.documentContext) return null
  return pin
}

/** Current pin for a send or selection in `workspaceRoot`, if one applies. */
export function currentWorkSessionPin(workspaceRoot: string, documentContext: boolean): WorkSessionPin | null {
  const state = useWorkSidebarStore.getState()
  return applicableWorkSessionPin({ view: state.view, pin: state.pin, workspaceRoot, documentContext })
}

/** Whether an open file, whiteboard or paper view gives the assistant a document. */
export function writeHasDocumentContext(state: {
  workSurface: 'docs' | 'papers'
  activeFilePath: string | null
  activeWhiteboardId: string | null
}): boolean {
  return Boolean(state.activeFilePath || state.activeWhiteboardId || state.workSurface === 'papers')
}
