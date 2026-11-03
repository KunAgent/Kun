import type { ChatBlock } from '../agent/types'
import { turnUndoRequest } from './turn-undo-store'
import { buildTurnUndoTargetFromState } from './turn-undo-target-state'

export type RewindFileResetOutcome =
  | { kind: 'reset' | 'skipped' | 'fell_back' }
  | { kind: 'failed'; message: string }

/**
 * Undo the file changes of an edited message's turn and every later turn.
 * Only Kun-recorded files are restored, and only when all are safe; an
 * unsafe file means the caller resets the conversation alone.
 */
export async function resetFilesForRewind(
  state: {
    activeThreadId: string | null
    blocks: readonly ChatBlock[]
    threads: Array<{ id: string; workspace?: string | null }>
    workspaceRoot: string
  },
  userBlockId: string
): Promise<RewindFileResetOutcome> {
  const target = buildTurnUndoTargetFromState(state, userBlockId, { untilEnd: true })
  if (!target || target.files.length === 0 || typeof window.kunGui?.undoTurnFiles !== 'function') {
    return { kind: 'skipped' }
  }
  const result = await window.kunGui.undoTurnFiles({ ...turnUndoRequest(target), scope: 'rewind' }).catch((error) => ({
    ok: false as const,
    reason: 'error' as const,
    message: error instanceof Error ? error.message : String(error)
  }))
  if (result.ok) return { kind: 'reset' }
  if (result.reason === 'unsafe') return { kind: 'fell_back' }
  if (result.reason === 'nothing_to_undo') return { kind: 'skipped' }
  return { kind: 'failed', message: result.message }
}
