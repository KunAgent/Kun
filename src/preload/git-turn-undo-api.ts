import { ipcRenderer } from 'electron'
import type { KunGuiGitTurnUndoApi } from '../shared/git-turn-undo'

/** Per-turn file undo bridge (see src/shared/git-turn-undo.ts). */
export const gitTurnUndoPreloadApi: KunGuiGitTurnUndoApi = {
  preflightTurnUndo: (params) => ipcRenderer.invoke('git:turn-undo:preflight', params),
  undoTurnFiles: (params) => ipcRenderer.invoke('git:turn-undo:undo', params),
  reapplyTurnFiles: (params) => ipcRenderer.invoke('git:turn-undo:reapply', params),
  getTurnUndoStatus: (params) => ipcRenderer.invoke('git:turn-undo:status', params)
}
