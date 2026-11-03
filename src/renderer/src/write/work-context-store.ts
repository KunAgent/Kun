import { create } from 'zustand'
import { focusedWriteGroup } from './write-editor-layout'
import type { WriteEditorLayoutV1 } from './write-workspace-store-types'

/**
 * What is open becomes the current session's context (the chip above the
 * composer). Removing the chip detaches only the item that is open now;
 * opening anything else attaches again, so a removed chip never lingers.
 */
type WorkContextState = {
  detachedKey: string | null
  detach: (key: string) => void
  attach: () => void
}

export const useWorkContextStore = create<WorkContextState>((set) => ({
  detachedKey: null,
  detach: (key) => set({ detachedKey: key || null }),
  attach: () => set({ detachedKey: null })
}))

/** Editor item key of the focused tab ('' when nothing is open). */
export function workContextKey(state: { editorLayout: WriteEditorLayoutV1 }): string {
  return focusedWriteGroup(state.editorLayout).activePath ?? ''
}

export function workContextDetached(state: { editorLayout: WriteEditorLayoutV1 }): boolean {
  const key = workContextKey(state)
  return Boolean(key) && useWorkContextStore.getState().detachedKey === key
}
