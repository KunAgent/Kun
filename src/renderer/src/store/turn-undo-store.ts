import { create } from 'zustand'
import type {
  GitTurnReapplyConflict,
  GitTurnUndoFileInput,
  GitTurnUndoPreflight,
  GitTurnUndoStatus
} from '@shared/git-turn-undo'

/** What a per-turn undo covers; built from the thread's blocks. */
export type TurnUndoTarget = {
  checkpointId: string
  threadId: string
  workspaceRoot: string
  files: GitTurnUndoFileInput[]
  shellCommandsRan: boolean
  windowEndCheckpointId?: string
}

export type TurnUndoDialog =
  | {
      kind: 'undo'
      target: TurnUndoTarget
      phase: 'checking' | 'ready' | 'running'
      preflight: GitTurnUndoPreflight | null
      error: string | null
    }
  | {
      kind: 'reapply-blocked'
      checkpointId: string
      conflicts: GitTurnReapplyConflict[]
      message: string
    }

type TurnUndoState = {
  dialog: TurnUndoDialog | null
  statusByCheckpoint: Record<string, GitTurnUndoStatus>
  /** Checkpoint whose card is running an undo or reapply. */
  pendingCheckpointId: string | null
  hostOwner: string | null
}

export const useTurnUndoStore = create<TurnUndoState>(() => ({
  dialog: null,
  statusByCheckpoint: {},
  pendingCheckpointId: null,
  hostOwner: null
}))

function bridge(): Window['kunGui'] | null {
  if (typeof window === 'undefined') return null
  const api = window.kunGui
  return api && typeof api.preflightTurnUndo === 'function' ? api : null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function turnUndoRequest(target: TurnUndoTarget): {
  checkpointId: string
  expectedThreadId?: string
  expectedWorkspaceRoot?: string
  files: GitTurnUndoFileInput[]
  shellCommandsRan: boolean
  windowEndCheckpointId?: string
} {
  return {
    checkpointId: target.checkpointId,
    ...(target.threadId ? { expectedThreadId: target.threadId } : {}),
    ...(target.workspaceRoot ? { expectedWorkspaceRoot: target.workspaceRoot } : {}),
    files: target.files,
    shellCommandsRan: target.shellCommandsRan,
    ...(target.windowEndCheckpointId ? { windowEndCheckpointId: target.windowEndCheckpointId } : {})
  }
}

export function isTurnUndoAvailable(): boolean {
  return bridge() !== null
}

/** Only one mounted timeline renders the dialog. */
export function claimTurnUndoDialogHost(id: string): void {
  useTurnUndoStore.setState((state) => (state.hostOwner ? {} : { hostOwner: id }))
}

export function releaseTurnUndoDialogHost(id: string): void {
  useTurnUndoStore.setState((state) => (state.hostOwner === id ? { hostOwner: null } : {}))
}

export async function loadTurnUndoStatus(checkpointId: string): Promise<void> {
  const api = bridge()
  if (!api || !checkpointId) return
  try {
    const status = await api.getTurnUndoStatus({ checkpointId })
    useTurnUndoStore.setState((state) => ({
      statusByCheckpoint: { ...state.statusByCheckpoint, [checkpointId]: status }
    }))
  } catch {
    // Status only picks the card's button; a failed read keeps "Undo".
  }
}

export async function preflightTurnUndoRange(target: TurnUndoTarget): Promise<GitTurnUndoPreflight | null> {
  const api = bridge()
  if (!api) return null
  try {
    const result = await api.preflightTurnUndo(turnUndoRequest(target))
    return result.ok ? result.preflight : null
  } catch {
    return null
  }
}

/** Open the preflight dialog and classify the turn's files. */
export async function openTurnUndoDialog(target: TurnUndoTarget): Promise<void> {
  const api = bridge()
  if (!api) return
  useTurnUndoStore.setState({ dialog: { kind: 'undo', target, phase: 'checking', preflight: null, error: null } })
  let preflight: GitTurnUndoPreflight | null = null
  let error: string | null = null
  try {
    const result = await api.preflightTurnUndo(turnUndoRequest(target))
    if (result.ok) preflight = result.preflight
    else error = result.message
  } catch (cause) {
    error = message(cause)
  }
  useTurnUndoStore.setState((state) => {
    const dialog = state.dialog
    if (dialog?.kind !== 'undo' || dialog.target !== target) return {}
    return { dialog: { ...dialog, phase: 'ready', preflight, error } }
  })
}

export function closeTurnUndoDialog(): void {
  useTurnUndoStore.setState((state) => (
    state.dialog?.kind === 'undo' && state.dialog.phase === 'running' ? {} : { dialog: null }
  ))
}

export async function confirmTurnUndo(): Promise<void> {
  const api = bridge()
  const dialog = useTurnUndoStore.getState().dialog
  if (!api || dialog?.kind !== 'undo' || dialog.phase !== 'ready' || !dialog.preflight?.canUndo) return
  const { target } = dialog
  useTurnUndoStore.setState({
    dialog: { ...dialog, phase: 'running', error: null },
    pendingCheckpointId: target.checkpointId
  })
  try {
    const result = await api.undoTurnFiles({ ...turnUndoRequest(target), scope: 'turn' })
    if (result.ok) {
      useTurnUndoStore.setState((state) => ({
        dialog: null,
        statusByCheckpoint: {
          ...state.statusByCheckpoint,
          [target.checkpointId]: {
            state: 'undone',
            undoId: result.undoId,
            undoneAt: new Date().toISOString(),
            fileCount: result.restored.length + result.deleted.length
          }
        }
      }))
      return
    }
    const preflight = 'preflight' in result ? result.preflight : dialog.preflight
    useTurnUndoStore.setState({ dialog: { ...dialog, phase: 'ready', preflight, error: result.message } })
  } catch (cause) {
    useTurnUndoStore.setState({ dialog: { ...dialog, phase: 'ready', error: message(cause) } })
  } finally {
    useTurnUndoStore.setState({ pendingCheckpointId: null })
  }
}

export async function reapplyTurnUndo(target: {
  checkpointId: string
  threadId: string
  workspaceRoot: string
}): Promise<string | null> {
  const api = bridge()
  const status = useTurnUndoStore.getState().statusByCheckpoint[target.checkpointId]
  if (!api || status?.state !== 'undone') return null
  useTurnUndoStore.setState({ pendingCheckpointId: target.checkpointId })
  try {
    const result = await api.reapplyTurnFiles({
      checkpointId: target.checkpointId,
      undoId: status.undoId,
      ...(target.threadId ? { expectedThreadId: target.threadId } : {}),
      ...(target.workspaceRoot ? { expectedWorkspaceRoot: target.workspaceRoot } : {})
    })
    if (result.ok) {
      useTurnUndoStore.setState((state) => ({
        statusByCheckpoint: { ...state.statusByCheckpoint, [target.checkpointId]: { state: 'none' } }
      }))
      return null
    }
    if (result.reason === 'unsafe') {
      useTurnUndoStore.setState({
        dialog: { kind: 'reapply-blocked', checkpointId: target.checkpointId, conflicts: result.conflicts, message: result.message }
      })
      return null
    }
    if (result.reason === 'not_found') {
      useTurnUndoStore.setState((state) => ({
        statusByCheckpoint: { ...state.statusByCheckpoint, [target.checkpointId]: { state: 'none' } }
      }))
    }
    return result.message
  } catch (cause) {
    return message(cause)
  } finally {
    useTurnUndoStore.setState({ pendingCheckpointId: null })
  }
}
