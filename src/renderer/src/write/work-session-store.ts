import { create } from 'zustand'
import { writeWorkspaceKey } from './write-thread-registry'

/**
 * The Work session law: every space has one current session, and only an
 * explicit pick changes it — a sidebar row, a home card, New session, or a
 * page that is itself a session (Agent research, a PPT review board).
 * Opening documents, papers or whiteboards never does; they become context
 * of the current session instead. `''` is a draft: the next send creates the
 * session and anchors it to whatever is open then.
 */
type WorkSessionState = {
  /** Space key → current session id; '' or absent is a draft. */
  current: Record<string, string>
  /** Selection/creation in flight; the runtime effect waits for it. */
  transitions: number
  /** Thread id → the title the sessions list shows, for views whose own thread list lacks it. */
  titles: Record<string, string>
  rememberTitles: (entries: ReadonlyArray<{ id: string; title: string }>) => void
  select: (workspaceRoot: string, threadId: string) => void
  startDraft: (workspaceRoot: string) => void
  /** A session that went away (archived/deleted) leaves its space on a draft. */
  release: (threadId: string) => void
}

export const useWorkSessionStore = create<WorkSessionState>((set) => ({
  current: {},
  transitions: 0,
  titles: {},
  rememberTitles: (entries) => {
    set((state) => {
      let changed = false
      const titles = { ...state.titles }
      for (const { id, title } of entries) {
        if (!id || !title || titles[id] === title) continue
        titles[id] = title
        changed = true
      }
      return changed ? { titles } : state
    })
  },
  select: (workspaceRoot, threadId) => {
    const key = writeWorkspaceKey(workspaceRoot)
    const id = threadId.trim()
    if (!key || !id) return
    set((state) => state.current[key] === id ? state : { current: { ...state.current, [key]: id } })
  },
  startDraft: (workspaceRoot) => {
    const key = writeWorkspaceKey(workspaceRoot)
    if (!key) return
    set((state) => state.current[key] === '' ? state : { current: { ...state.current, [key]: '' } })
  },
  release: (threadId) => {
    const id = threadId.trim()
    set((state) => {
      const keys = Object.keys(state.current).filter((key) => state.current[key] === id)
      if (!id || keys.length === 0) return state
      const current = { ...state.current }
      for (const key of keys) current[key] = ''
      return { current }
    })
  }
}))

/** The current session of `workspaceRoot`, or '' for a draft. */
export function currentWorkSessionId(workspaceRoot: string): string {
  return useWorkSessionStore.getState().current[writeWorkspaceKey(workspaceRoot)] ?? ''
}

/** Marks a Work thread switch in flight; call the returned function when done. */
export function beginWorkSessionTransition(): () => void {
  useWorkSessionStore.setState((state) => ({ transitions: state.transitions + 1 }))
  let ended = false
  return () => {
    if (ended) return
    ended = true
    useWorkSessionStore.setState((state) => ({ transitions: Math.max(0, state.transitions - 1) }))
  }
}
