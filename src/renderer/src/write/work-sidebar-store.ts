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
 * next send starts a new session in `workspaceRoot`. `documentKey` records
 * what was open when the pin was set, so the files view can tell a document
 * change apart from a mere view switch.
 */
export type WorkSessionPin = { workspaceRoot: string; threadId: string; documentKey: string }

export const WORK_SIDEBAR_VIEW_KEY = 'kun.work.sidebarView.v1'

export function readWorkSidebarView(): WorkSidebarView {
  return readBrowserStorageItem(WORK_SIDEBAR_VIEW_KEY) === 'files' ? 'files' : 'sessions'
}

type WorkDocumentState = {
  workSurface: 'docs' | 'papers'
  activeFilePath: string | null
  activeWhiteboardId: string | null
}

/** Whether an open file, whiteboard or paper view gives the assistant a document. */
export function writeHasDocumentContext(state: WorkDocumentState): boolean {
  return Boolean(state.activeFilePath || state.activeWhiteboardId || state.workSurface === 'papers')
}

/** Identity of what is open; two states with the same key show the same document. */
export function workDocumentKey(state: WorkDocumentState): string {
  return `${state.workSurface}\u0000${state.activeFilePath ?? ''}\u0000${state.activeWhiteboardId ?? ''}`
}

type WorkSidebarState = {
  view: WorkSidebarView
  pin: WorkSessionPin | null
  /** Thread creation/selection in flight; the assistant runtime waits for it. */
  transitions: number
  /** Switching to the files view adopts the open document, so nothing jumps. */
  setView: (view: WorkSidebarView, documentKey?: string) => void
  pinSession: (workspaceRoot: string, threadId: string, documentKey?: string) => void
  startDraft: (workspaceRoot: string, documentKey?: string) => void
  clearPin: () => void
}

export const useWorkSidebarStore = create<WorkSidebarState>((set) => ({
  view: readWorkSidebarView(),
  pin: null,
  transitions: 0,
  setView: (view, documentKey) => {
    writeBrowserStorageItem(WORK_SIDEBAR_VIEW_KEY, view)
    set((state) => ({
      view,
      pin: view === 'files' && state.pin && documentKey !== undefined ? { ...state.pin, documentKey } : state.pin
    }))
  },
  pinSession: (workspaceRoot, threadId, documentKey = '') => {
    const root = normalizeWorkspaceRoot(workspaceRoot)
    const id = threadId.trim()
    if (!root || !id) return
    set({ pin: { workspaceRoot: root, threadId: id, documentKey } })
  },
  startDraft: (workspaceRoot, documentKey = '') => {
    const root = normalizeWorkspaceRoot(workspaceRoot)
    if (root) set({ pin: { workspaceRoot: root, threadId: '', documentKey } })
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
 * The pin owns the conversation in its space. In the sessions view it stays
 * whatever opens; in the files view the conversation follows the document, so
 * the pin only holds while the document it was set on is still the open one
 * (or nothing is open and the conversation fills the center).
 */
export function applicableWorkSessionPin(input: {
  view: WorkSidebarView
  pin: WorkSessionPin | null
  workspaceRoot: string
  documentContext: boolean
  documentKey?: string
}): WorkSessionPin | null {
  const { pin } = input
  if (!pin) return null
  if (normalizeWorkspaceRoot(pin.workspaceRoot) !== normalizeWorkspaceRoot(input.workspaceRoot)) return null
  if (input.view === 'files' && input.documentContext && input.documentKey !== undefined &&
    pin.documentKey !== input.documentKey) return null
  return pin
}

/** Current pin for a send or selection in `workspaceRoot`, if one applies. */
export function currentWorkSessionPin(
  workspaceRoot: string,
  document: WorkDocumentState | null
): WorkSessionPin | null {
  const state = useWorkSidebarStore.getState()
  return applicableWorkSessionPin({
    view: state.view,
    pin: state.pin,
    workspaceRoot,
    // Another mounted root cannot be compared; treat it as a document context.
    documentContext: document ? writeHasDocumentContext(document) : true,
    ...(document ? { documentKey: workDocumentKey(document) } : {})
  })
}
