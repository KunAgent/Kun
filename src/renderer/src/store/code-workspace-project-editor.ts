import { create } from 'zustand'

export type CodeProjectEditorMode = 'create' | 'manage'

export type CodeProjectEditorRequest = {
  mode: CodeProjectEditorMode
  /** Project identity for manage mode; ignored for create. */
  primary?: string
  /** Optional folder to preload, e.g. the picker's current project folder. */
  seedFolder?: string
  /** Which navigation action should land on the project after creation. */
  selectAfterSave: 'code' | 'ade' | null
}

type CodeProjectEditorState = {
  request: CodeProjectEditorRequest | null
  openCreate: (options?: { seedFolder?: string; selectAfterSave?: 'code' | 'ade' | null }) => void
  openManage: (primary: string) => void
  close: () => void
}

export const useCodeProjectEditorStore = create<CodeProjectEditorState>((set) => ({
  request: null,
  openCreate: (options = {}) => set({
    request: {
      mode: 'create',
      seedFolder: options.seedFolder?.trim() || undefined,
      selectAfterSave: options.selectAfterSave === undefined ? 'code' : options.selectAfterSave
    }
  }),
  openManage: (primary) => set({
    request: primary.trim() ? { mode: 'manage', primary: primary.trim(), selectAfterSave: null } : null
  }),
  close: () => set({ request: null })
}))

export function openCodeProjectCreate(options?: Parameters<CodeProjectEditorState['openCreate']>[0]): void {
  useCodeProjectEditorStore.getState().openCreate(options)
}

export function openCodeProjectManage(primary: string): void {
  useCodeProjectEditorStore.getState().openManage(primary)
}
