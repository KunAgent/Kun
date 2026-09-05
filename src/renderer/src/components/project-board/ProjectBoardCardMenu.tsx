import type { ReactElement } from 'react'
import { Archive, ExternalLink, FileText, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectBoardCard, ProjectBoardStatus } from '../../project-board/project-board-types'

type Props = {
  card: ProjectBoardCard
  disabled: boolean
  onMove: (status: ProjectBoardStatus) => void
  onEdit: () => void
  onArchive: (archived: boolean) => void
  onDelete: () => void
  onOpenThread: () => void
  onOpenPlan: () => void
}

export function ProjectBoardCardMenu(props: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <details className="relative">
      <summary
        aria-label={t('projectBoardCardActions')}
        className="list-none cursor-pointer rounded-md p-1 text-ds-faint hover:bg-ds-main hover:text-ds-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 top-6 z-30 w-48 rounded-xl border border-ds-border-muted bg-ds-card p-1.5 text-xs text-ds-ink shadow-xl">
        {(['pending', 'in_progress', 'completed'] as ProjectBoardStatus[]).map((status) => (
          <MenuButton key={status} disabled={props.disabled || props.card.status === status} onClick={() => props.onMove(status)}>
            {t(status === 'pending' ? 'projectBoardMovePending' : status === 'in_progress' ? 'projectBoardMoveInProgress' : 'projectBoardMoveCompleted')}
          </MenuButton>
        ))}
        <div className="my-1 h-px bg-ds-border-muted" />
        <MenuButton disabled={props.disabled} onClick={props.onEdit} icon={<Pencil className="h-3.5 w-3.5" />}>
          {t('projectBoardEdit')}
        </MenuButton>
        {props.card.kind === 'thread_todo' ? (
          <>
            <MenuButton onClick={props.onOpenThread} icon={<ExternalLink className="h-3.5 w-3.5" />}>
              {t('projectBoardOpenThread')}
            </MenuButton>
            <MenuButton onClick={props.onOpenPlan} icon={<FileText className="h-3.5 w-3.5" />}>
              {t('projectBoardOpenPlan')}
            </MenuButton>
          </>
        ) : null}
        <MenuButton
          disabled={props.disabled}
          onClick={() => props.onArchive(!props.card.archived)}
          icon={props.card.archived ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        >
          {t(props.card.archived ? 'projectBoardRestore' : 'projectBoardArchive')}
        </MenuButton>
        {props.card.kind === 'manual' ? (
          <MenuButton disabled={props.disabled} onClick={props.onDelete} icon={<Trash2 className="h-3.5 w-3.5" />} danger>
            {t('projectBoardDelete')}
          </MenuButton>
        ) : null}
      </div>
    </details>
  )
}

function MenuButton(props: {
  children: string
  onClick: () => void
  icon?: ReactElement
  disabled?: boolean
  danger?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={(event) => {
        props.onClick()
        const details = event.currentTarget.closest('details')
        if (details) details.open = false
      }}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left disabled:opacity-40 ${
        props.danger ? 'text-red-600 hover:bg-red-500/10' : 'hover:bg-ds-main'
      }`}
    >
      {props.icon}{props.children}
    </button>
  )
}
