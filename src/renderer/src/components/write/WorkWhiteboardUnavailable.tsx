import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Shapes } from 'lucide-react'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'

/**
 * Placeholder for a restored whiteboard tab whose board cannot be resolved.
 * The index may simply be unreadable, so the tab is kept and the user can
 * retry instead of silently losing the whiteboard they had open.
 */
export function WorkWhiteboardUnavailable({
  boardId,
  workspaceRoot
}: {
  boardId: string
  workspaceRoot: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [retrying, setRetrying] = useState(false)
  const loadError = useWriteWorkspaceStore((state) => state.whiteboardsLoadError)

  const retry = async (): Promise<void> => {
    setRetrying(true)
    await useWriteWorkspaceStore.getState().ensureWhiteboards(workspaceRoot)
    setRetrying(false)
  }

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center bg-[#f8fafc] p-6 dark:bg-[#111318]"
      data-work-whiteboard-unavailable={boardId}
    >
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-ds-border bg-ds-card text-ds-muted">
          <Shapes className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <h2 className="max-w-full truncate text-sm font-semibold text-ds-ink">{t('workWhiteboardUnavailableTitle')}</h2>
        <p className="mt-1.5 text-xs leading-5 text-ds-muted">
          {loadError ?? t('workWhiteboardUnavailableHint')}
        </p>
        <button
          type="button"
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
          onClick={() => void retry()}
          disabled={retrying}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
          {t('workWhiteboardUnavailableRetry')}
        </button>
      </div>
    </div>
  )
}
