import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronsDownUp, Loader2 } from 'lucide-react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workWhiteboardGroupId, workWhiteboardTabKey } from '../../write/work-whiteboard'
import { flushWorkWhiteboardPersistence } from '../../write/work-whiteboard-leave'
import { openArtifactsPage } from '../../artifacts/artifact-library-store'
import type { CanvasEngine } from '../../whiteboard/canvas-engine'

type LeaveTarget = 'collapse' | 'artifacts'

/**
 * Leaving a board saves first. A failed save keeps the board mounted so the
 * user can retry instead of losing the change to an unmount cleanup.
 */
export function WorkWhiteboardLeaveActions({ boardId, workspaceRoot, engine }: {
  boardId: string
  workspaceRoot: string
  engine: CanvasEngine
}): ReactElement {
  const { t } = useTranslation('common')
  const [busy, setBusy] = useState<LeaveTarget | null>(null)

  const leave = async (target: LeaveTarget): Promise<void> => {
    if (busy) return
    setBusy(target)
    const flushed = await flushWorkWhiteboardPersistence(workspaceRoot, engine)
    if (!flushed.ok) {
      useWriteWorkspaceStore.getState().setFileError(flushed.message)
      setBusy(null)
      return
    }
    if (target === 'artifacts') {
      openArtifactsPage({ from: 'work', workRoot: workspaceRoot })
    } else {
      const store = useWriteWorkspaceStore.getState()
      const groupId = workWhiteboardGroupId(store, boardId)
      if (groupId) await store.closeTab(groupId, workWhiteboardTabKey(boardId))
    }
    setBusy(null)
  }

  const buttonClass = 'pointer-events-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-60'

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 z-50 flex items-center gap-0.5 rounded-full border border-ds-border-muted bg-white/88 p-0.5 shadow-[0_10px_28px_rgba(20,47,95,0.1)] backdrop-blur-2xl dark:bg-ds-canvas/90"
      data-work-whiteboard-leave-actions="true"
    >
      <button type="button" className={buttonClass} disabled={busy !== null}
        title={t('workWhiteboardBackToArtifacts')} aria-label={t('workWhiteboardBackToArtifacts')}
        onClick={() => void leave('artifacts')}>
        {busy === 'artifacts'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          : <ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
        {t('workWhiteboardBackToArtifacts')}
      </button>
      <span aria-hidden className="h-4 w-px bg-ds-border" />
      <button type="button" className={buttonClass} disabled={busy !== null}
        title={t('workWhiteboardCollapse')} aria-label={t('workWhiteboardCollapse')}
        onClick={() => void leave('collapse')}>
        {busy === 'collapse'
          ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          : <ChevronsDownUp className="h-3.5 w-3.5" aria-hidden />}
        {t('workWhiteboardCollapse')}
      </button>
    </div>
  )
}
