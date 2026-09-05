import type { ReactElement } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectBoardStatus } from '../../project-board/project-board-types'

type Props = {
  count: number
  sourceStatus: ProjectBoardStatus
  disabled: boolean
  onMove: (status: ProjectBoardStatus) => void
  onClear: () => void
}

const STATUSES: ProjectBoardStatus[] = ['pending', 'in_progress', 'completed']

export function ProjectBoardSelectionToolbar(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const label = (status: ProjectBoardStatus): string => status === 'pending'
    ? t('projectBoardPending')
    : status === 'in_progress'
      ? t('projectBoardInProgress')
      : t('projectBoardCompleted')
  return (
    <div className="ds-no-drag absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-ds-border bg-ds-card px-3 py-2 shadow-xl">
      <span className="whitespace-nowrap text-xs font-medium text-ds-ink">
        {t('projectBoardSelectedCount', { count: props.count })}
      </span>
      <span className="h-5 w-px bg-ds-border-muted" />
      {STATUSES.filter((status) => status !== props.sourceStatus).map((status) => (
        <button
          key={status}
          type="button"
          disabled={props.disabled}
          onClick={() => props.onMove(status)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ds-muted hover:bg-ds-main hover:text-ds-ink disabled:opacity-40"
        >
          <ArrowRight className="h-3 w-3" /> {label(status)}
        </button>
      ))}
      <button
        type="button"
        onClick={props.onClear}
        aria-label={t('projectBoardClearSelection')}
        className="rounded-lg p-1.5 text-ds-faint hover:bg-ds-main hover:text-ds-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
