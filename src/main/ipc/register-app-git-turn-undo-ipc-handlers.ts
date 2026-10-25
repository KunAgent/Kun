import { ipcMain } from 'electron'
import {
  gitTurnReapplyPayloadSchema,
  gitTurnUndoPayloadSchema,
  gitTurnUndoPreflightPayloadSchema,
  gitTurnUndoStatusPayloadSchema
} from './app-ipc-schemas'
import { DEFAULT_KUN_DATA_DIR, resolveKunRuntimeSettings } from '../../shared/app-settings'
import type { GitCheckpointStorageOptions } from '../services/git-checkpoint-service'
import {
  getTurnUndoStatus,
  preflightTurnUndo,
  reapplyTurnFiles,
  undoTurnFiles,
  type TurnUndoRuntimeRequest
} from '../services/git-turn-undo-service'
import { expandHomePath } from '../services/workspace-service'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { parseIpcPayload } from './app-ipc-handler-utils'

/** Per-turn file undo: preflight, undo, reapply and the card's status. */
export function registerAppGitTurnUndoIpcHandlers(options: RegisterAppIpcHandlersOptions): void {
  const { store, runtimeRequest } = options
  const resolveContext = async (): Promise<{ dataDir: string; storage: GitCheckpointStorageOptions }> => {
    const settings = await store.load()
    const runtime = resolveKunRuntimeSettings(settings)
    const directory = settings.checkpointCleanup.directory?.trim()
    return {
      dataDir: expandHomePath(runtime.dataDir?.trim() || DEFAULT_KUN_DATA_DIR),
      storage: directory ? { checkpointsRoot: expandHomePath(directory) } : {}
    }
  }
  // Transport failures become a non-ok response so the busy guard fails closed.
  const guardedRuntimeRequest: TurnUndoRuntimeRequest = async (path, init) => {
    try {
      return await runtimeRequest(path, init?.method, init?.body)
    } catch (error) {
      return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) }
    }
  }

  ipcMain.handle('git:turn-undo:preflight', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:turn-undo:preflight', gitTurnUndoPreflightPayloadSchema, payload)
    return preflightTurnUndo({ ...(await resolveContext()), request })
  })
  ipcMain.handle('git:turn-undo:undo', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:turn-undo:undo', gitTurnUndoPayloadSchema, payload)
    return undoTurnFiles({ ...(await resolveContext()), request, runtimeRequest: guardedRuntimeRequest })
  })
  ipcMain.handle('git:turn-undo:reapply', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:turn-undo:reapply', gitTurnReapplyPayloadSchema, payload)
    return reapplyTurnFiles({ ...(await resolveContext()), request, runtimeRequest: guardedRuntimeRequest })
  })
  ipcMain.handle('git:turn-undo:status', async (_, payload: unknown) => {
    const request = parseIpcPayload('git:turn-undo:status', gitTurnUndoStatusPayloadSchema, payload)
    return getTurnUndoStatus({ ...(await resolveContext()), request })
  })
}
