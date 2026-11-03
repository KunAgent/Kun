import { useCallback, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Redo2, Undo2 } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  isTurnUndoAvailable,
  loadTurnUndoStatus,
  openTurnUndoDialog,
  reapplyTurnUndo,
  useTurnUndoStore
} from '../../store/turn-undo-store'
import { buildTurnUndoTarget, threadCheckpointWorkspaceRoot } from '../../store/turn-undo-target'

export type TurnChangeUndoState = {
  undone: boolean
  /** Files the undo restored or deleted; can exceed the card's diff rows. */
  undoneFileCount?: number
  pending: boolean
  disabled: boolean
  onUndo: () => void
  onReapply: () => void
}

export function TurnUndoCardButton({ undo }: { undo: TurnChangeUndoState }): ReactElement {
  const { t } = useTranslation('common')
  const label = undo.pending ? t('turnUndoWorking') : undo.undone ? t('turnUndoReapply') : t('turnUndoAction')
  const title = undo.undone ? t('turnUndoReapplyTitle') : t('turnUndoActionTitle')
  return (
    <button
      type="button"
      onClick={undo.undone ? undo.onReapply : undo.onUndo}
      disabled={undo.disabled || undo.pending}
      title={title}
      aria-label={title}
      data-turn-undo-action={undo.undone ? 'reapply' : 'undo'}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        undo.undone
          ? 'bg-accent text-white hover:brightness-110'
          : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      {undo.pending
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        : undo.undone
          ? <Redo2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          : <Undo2 className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />}
      {label}
    </button>
  )
}

/**
 * Undo/Reapply wiring for one settled turn. Returns `undefined` when the turn
 * has no checkpoint, the host bridge is missing, or thread actions are off.
 */
export function useTurnUndo(params: {
  enabled: boolean
  user: Extract<ChatBlock, { kind: 'user' }> | undefined
  turnBlocks: readonly ChatBlock[]
}): (TurnChangeUndoState & { openDialog: () => void }) | undefined {
  const checkpointId = params.user?.meta?.workspaceCheckpointId?.trim() ?? ''
  const active = params.enabled && Boolean(checkpointId) && isTurnUndoAvailable()
  const status = useTurnUndoStore((state) => (checkpointId ? state.statusByCheckpoint[checkpointId] : undefined))
  const pending = useTurnUndoStore((state) => Boolean(checkpointId) && state.pendingCheckpointId === checkpointId)
  const busy = useChatStore((state) => state.busy)
  const userBlockId = params.user?.id ?? ''
  const { turnBlocks, user } = params

  useEffect(() => {
    if (active && checkpointId && !status) void loadTurnUndoStatus(checkpointId)
  }, [active, checkpointId, status])

  const openDialog = useCallback(() => {
    if (!user) return
    const target = buildTurnUndoTarget(userBlockId, { untilEnd: false, fallbackBlocks: [user, ...turnBlocks] })
    if (target) void openTurnUndoDialog(target)
  }, [turnBlocks, user, userBlockId])

  const onReapply = useCallback(() => {
    const state = useChatStore.getState()
    void reapplyTurnUndo({
      checkpointId,
      threadId: state.activeThreadId ?? '',
      workspaceRoot: threadCheckpointWorkspaceRoot(state)
    }).then((error) => {
      if (error) useChatStore.setState({ error })
    })
  }, [checkpointId])

  if (!active) return undefined
  return {
    undone: status?.state === 'undone',
    ...(status?.state === 'undone' ? { undoneFileCount: status.fileCount } : {}),
    pending,
    disabled: busy,
    onUndo: openDialog,
    onReapply,
    openDialog
  }
}
