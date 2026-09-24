import type {
  WriteWorkspaceGet,
  WriteWorkspaceSet,
  WriteWorkspaceState
} from './write-workspace-store-types'
import type { WriteWorkSurface } from './write-surface'
import { setWriteWorkSurfaceValue } from './write-surface'
import { persistWriteEditorLayout } from './write-editor-layout'

type WriteSurfaceActions = Pick<WriteWorkspaceState, 'setWorkSurface'>

/**
 * Switch the active Work surface. Order is fixed by plan D2: persist the
 * outgoing surface's layout under its own storage key while the module-level
 * surface still points at it, then flip the key namespace, then update state.
 * The caller re-runs `initializeWorkspace` afterwards so the new surface's
 * persisted layout is restored.
 */
export function createWriteSurfaceActions({ set, get }: {
  set: WriteWorkspaceSet
  get: WriteWorkspaceGet
}): WriteSurfaceActions {
  return {
    setWorkSurface: (surface: WriteWorkSurface) => {
      const current = get().workSurface
      if (current === surface) return
      const root = get().workspaceRoot
      if (root.trim()) {
        persistWriteEditorLayout(root, get().editorLayout)
      }
      setWriteWorkSurfaceValue(surface)
      set({ workSurface: surface })
    }
  }
}
