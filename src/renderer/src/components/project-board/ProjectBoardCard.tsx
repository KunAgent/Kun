import { memo, type DragEvent, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectBoardCard as Card, ProjectBoardStatus } from '../../project-board/project-board-types'
import { ProjectBoardCardMenu } from './ProjectBoardCardMenu'

type Props = {
  card: Card
  disabled: boolean
  pending: boolean
  selected: boolean
  onToggleSelect: (card: Card, options: { range: boolean }) => void
  onDragCard: (card: Card, event: DragEvent<HTMLElement>) => void
  onMove: (card: Card, status: ProjectBoardStatus) => void
  onEdit: (card: Card) => void
  onArchive: (card: Card, archived: boolean) => void
  onDelete: (card: Card) => void
  onOpenThread: (card: Card) => void
  onOpenPlan: (card: Card) => void
}

function ProjectBoardCardComponent(props: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const dragStart = (event: DragEvent<HTMLElement>): void => {
    if (props.disabled) return event.preventDefault()
    props.onDragCard(props.card, event)
  }
  const toggleFromCard = (event: MouseEvent): void => {
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    props.onToggleSelect(props.card, { range: event.shiftKey })
  }
  return (
    <article
      id={`project-board-${cssId(props.card.id)}`}
      draggable={!props.disabled}
      onDragStart={dragStart}
      onClick={toggleFromCard}
      tabIndex={0}
      className={`group rounded-[14px] border bg-ds-card px-3.5 py-3 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        props.pending || props.selected
          ? 'border-accent ring-1 ring-accent/30'
          : 'border-ds-border-muted hover:border-ds-border hover:shadow-md'
      } motion-reduce:transition-none`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={props.selected}
          aria-label={props.selected ? t('projectBoardDeselectTask') : t('projectBoardSelectTask')}
          onClick={(event) => {
            event.stopPropagation()
            props.onToggleSelect(props.card, { range: event.shiftKey })
          }}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
            props.selected ? 'border-accent bg-accent text-white' : 'border-ds-border text-transparent'
          }`}
        >
          <span className="text-[10px] leading-none">✓</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${categoryClass(props.card.category)}`}>
              {props.card.category === 'plan' ? t('projectBoardPlan') : t(`projectBoardCategory_${props.card.category}`)}
            </span>
            {props.card.priority ? (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${priorityClass(props.card.priority)}`}>{props.card.priority}</span>
            ) : null}
          </div>
          <h3 className="mt-2 line-clamp-2 text-[13px] font-semibold leading-5 text-ds-ink">{props.card.title}</h3>
        </div>
        <ProjectBoardCardMenu
          card={props.card}
          disabled={props.disabled}
          onMove={(status) => props.onMove(props.card, status)}
          onEdit={() => props.onEdit(props.card)}
          onArchive={(archived) => props.onArchive(props.card, archived)}
          onDelete={() => props.onDelete(props.card)}
          onOpenThread={() => props.onOpenThread(props.card)}
          onOpenPlan={() => props.onOpenPlan(props.card)}
        />
      </div>
      {props.card.description ? <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-[17px] text-ds-muted">{props.card.description}</p> : null}
      <footer className="mt-3 flex items-center justify-between gap-2 border-t border-ds-border-muted pt-2 text-[10px] text-ds-faint">
        <span className="truncate">{props.card.kind === 'manual' ? t('projectBoardManual') : props.card.source.threadTitle || t('projectBoardPlan')}</span>
        <time dateTime={props.card.updatedAt}>{new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(new Date(props.card.updatedAt))}</time>
      </footer>
    </article>
  )
}

export const ProjectBoardCard = memo(ProjectBoardCardComponent)

function cssId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, '-') }
function priorityClass(priority: NonNullable<Card['priority']>): string {
  return priority === 'P0' ? 'bg-red-500/15 text-red-700 dark:text-red-300' :
    priority === 'P1' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' :
      'bg-blue-500/15 text-blue-700 dark:text-blue-300'
}
function categoryClass(category: Card['category']): string {
  if (category === 'bug') return 'bg-red-500/15 text-red-700 dark:text-red-300'
  if (category === 'tech_debt' || category === 'chore') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  if (category === 'docs') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  if (category === 'refactor') return 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
  if (category === 'test') return 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
  return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
}
