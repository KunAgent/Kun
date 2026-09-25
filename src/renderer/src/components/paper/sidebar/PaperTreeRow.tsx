import type { MouseEvent, ReactElement } from 'react'
import { Download, FileText, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openLibraryEntry } from '../../../paper/paper-library-actions'
import { downloadMissingPaperPdfs } from '../../../paper/paper-library-row-actions'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { interpretPaper } from '../../../write/paper/paper-actions'
import { PaperTitleText } from '../PaperTitleText'
import { pathInsidePaperUnit } from './PaperTree'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

const STATUS_DOT: Record<string, string> = {
  unread: 'bg-ds-faint',
  reading: 'bg-amber-500',
  read: 'bg-emerald-500'
}

const STATUS_LABEL: Record<string, string> = {
  unread: 'writePaperFilterUnread',
  reading: 'writePaperFilterReading',
  read: 'writePaperFilterRead'
}

/**
 * Single paper row inside the sidebar tree: reading-status dot + paper title
 * (never the unit directory name), with hover affordances for deep-read and
 * fetching the missing PDF. Right-click opens the shared paper row menu.
 */
export function PaperTreeRow({
  entry,
  workspaceRoot,
  onMenu
}: {
  entry: PaperLibraryEntry
  workspaceRoot: string
  onMenu: (entry: PaperLibraryEntry, x: number, y: number) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const activeFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const isActive = pathInsidePaperUnit(activeFilePath, workspaceRoot, entry.unitDir)
  const progress = entry.pageCount
    ? Math.min(1, (entry.lastPage ?? 0) / entry.pageCount)
    : 0
  const status = entry.meta.status ?? 'unread'

  const interpret = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation()
    const bridge = usePaperModeStore.getState().composerBridge
    const settings = useWriteWorkspaceStore.getState().paperReading
    await interpretPaper({
      workspaceRoot,
      settings,
      t,
      unitDir: entry.unitDir,
      meta: entry.meta,
      input: bridge?.input ?? '',
      setInput: bridge?.setInput ?? (() => undefined),
      onSubmitPrompt: bridge?.submit
    })
  }

  const fetchPdf = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation()
    await downloadMissingPaperPdfs([entry], t)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void openLibraryEntry(entry)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void openLibraryEntry(entry)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onMenu(entry, event.clientX, event.clientY)
      }}
      className={`group relative flex h-7 w-full cursor-default items-center gap-1.5 rounded-md pl-4 pr-1.5 text-[12px] transition ${
        isActive ? 'bg-[var(--ds-sidebar-row-active)] text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.unread}`}
        title={t(STATUS_LABEL[status] ?? STATUS_LABEL.unread)}
      />
      <span className="min-w-0 flex-1 truncate">
        <PaperTitleText title={entry.meta.title} />
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        {entry.hasPdf ? (
          <button
            type="button"
            title={t('writePaperInterpret')}
            onClick={(event) => void interpret(event)}
            className="rounded p-0.5 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <Zap className="h-3 w-3" strokeWidth={1.9} />
          </button>
        ) : (
          <button
            type="button"
            title={t('writePaperDownloadPdf')}
            onClick={(event) => void fetchPdf(event)}
            className="rounded p-0.5 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <Download className="h-3 w-3" strokeWidth={1.9} />
          </button>
        )}
      </span>
      {!entry.hasPdf ? <FileText className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={1.6} /> : null}
      {progress > 0 ? (
        <span
          className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-accent/50"
          style={{ width: `${Math.round(progress * 90)}%` }}
        />
      ) : null}
    </div>
  )
}
