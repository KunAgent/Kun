import { createStore } from 'zustand/vanilla'
import type { WriteEditorSelectionState } from '../components/write/write-markdown-editor-types'

export type SelectionEditSession = {
  id: number
  documentKey: string
  label: string
  source: { kind: 'skill'; actionId: string } | { kind: 'typed' }
  instruction: string
  baseline: string
  selection: WriteEditorSelectionState
  proposed: string | null
  hunks: number
  phase: 'running' | 'review'
  requestToken: number
}
export type SelectionEditState = {
  session: SelectionEditSession | null
  token: number
  begin: (session: Omit<SelectionEditSession, 'id' | 'phase' | 'hunks' | 'proposed' | 'requestToken'>) => number
  result: (token: number, proposed: string, hunks: number) => boolean
  clear: () => void
}
/** Each mounted document surface owns a store, so SDD and Work cannot consume each other's results. */
export function createSelectionEditStore() {
  return createStore<SelectionEditState>((set, get) => ({
    session: null,
    token: 0,
    begin: (session) => {
      const token = get().token + 1
      set({ token, session: { ...session, id: token, requestToken: token, phase: 'running', hunks: 0, proposed: null } })
      return token
    },
    result: (token, proposed, hunks) => {
      const state = get()
      if (state.token !== token || !state.session || state.session.phase !== 'running') return false
      set({ session: { ...state.session, proposed, hunks, phase: 'review' } })
      return true
    },
    clear: () => set((state) => ({ token: state.token + 1, session: null }))
  }))
}
