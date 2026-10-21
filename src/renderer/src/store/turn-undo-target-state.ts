import type { ChatBlock } from '../agent/types'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'
import { collectTurnUndoInputs, resolveTurnUndoRange } from '../lib/turn-file-undo-inputs'
import type { TurnUndoTarget } from './turn-undo-store'

type TurnUndoChatState = {
  activeThreadId: string | null
  blocks: readonly ChatBlock[]
  threads: Array<{ id: string; workspace?: string | null }>
  workspaceRoot: string
}

/**
 * Checkpoint identity follows the thread's workspace, not the global picker
 * (a multi-project sidebar can show a thread from another project).
 */
export function threadCheckpointWorkspaceRoot(state: Omit<TurnUndoChatState, 'blocks'>): string {
  const threadWorkspace = state.threads.find((thread) => thread.id === state.activeThreadId)?.workspace
  return normalizeWorkspaceRoot(threadWorkspace) || normalizeWorkspaceRoot(state.workspaceRoot)
}

/**
 * Build the undo target for one turn, or for this turn and every later one
 * when an earlier message is edited (`untilEnd`). `fallbackBlocks` covers a
 * timeline whose turn is not in the active thread's store blocks.
 */
export function buildTurnUndoTargetFromState(
  state: TurnUndoChatState,
  userBlockId: string,
  options: { untilEnd: boolean; fallbackBlocks?: readonly ChatBlock[] }
): TurnUndoTarget | null {
  const threadId = state.activeThreadId
  if (!threadId) return null
  const range =
    resolveTurnUndoRange(state.blocks, userBlockId, options) ??
    (options.fallbackBlocks ? resolveTurnUndoRange(options.fallbackBlocks, userBlockId, options) : null)
  if (!range) return null
  const workspaceRoot = threadCheckpointWorkspaceRoot(state)
  const inputs = collectTurnUndoInputs(range.blocks, workspaceRoot)
  return {
    checkpointId: range.checkpointId,
    threadId,
    workspaceRoot,
    files: inputs.files,
    shellCommandsRan: inputs.shellCommandsRan,
    ...(range.windowEndCheckpointId ? { windowEndCheckpointId: range.windowEndCheckpointId } : {})
  }
}
