import type { ChatBlock } from '../agent/types'
import { useChatStore } from './chat-store'
import type { TurnUndoTarget } from './turn-undo-store'
import { buildTurnUndoTargetFromState } from './turn-undo-target-state'

export { threadCheckpointWorkspaceRoot } from './turn-undo-target-state'

/** {@link buildTurnUndoTargetFromState} for the active chat thread. */
export function buildTurnUndoTarget(
  userBlockId: string,
  options: { untilEnd: boolean; fallbackBlocks?: readonly ChatBlock[] }
): TurnUndoTarget | null {
  return buildTurnUndoTargetFromState(useChatStore.getState(), userBlockId, options)
}
