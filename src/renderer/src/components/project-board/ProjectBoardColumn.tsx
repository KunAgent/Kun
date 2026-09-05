import { useRef, useState, type DragEvent, type ReactElement } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  PROJECT_BOARD_DRAG_MIME,
  type ProjectBoardCard,
  type ProjectBoardStatus
} from '../../project-board/project-board-types'
import { ProjectBoardCard as CardView } from './ProjectBoardCard'

type Props = {
  status: ProjectBoardStatus
  cards: ProjectBoardCard[]
  disabled: boolean
  mutatingCardIds: Record<string, true>
  selectedCardIds: ReadonlySet<string>
  onAdd: () => void
  onDropCards: (cardIds: string[]) => void
  onToggleColumnSelection: (selected: boolean) => void
  onToggleSelect: React.ComponentProps<typeof CardView>['onToggleSelect']
  onDragCard: React.ComponentProps<typeof CardView>['onDragCard']
  onMove: React.ComponentProps<typeof CardView>['onMove']
  onEdit: React.ComponentProps<typeof CardView>['onEdit']
  onArchive: React.ComponentProps<typeof CardView>['onArchive']
  onDelete: React.ComponentProps<typeof CardView>['onDelete']
  onOpenThread: React.ComponentProps<typeof CardView>['onOpenThread']
  onOpenPlan: React.ComponentProps<typeof CardView>['onOpenPlan']
}

export function ProjectBoardColumn(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const [dragOver, setDragOver] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: props.cards.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 142,
    getItemKey: (index) => props.cards[index]?.id ?? index,
    overscan: 6
  })
  const drop = (event: DragEvent): void => {
    event.preventDefault()
    setDragOver(false)
    try {
      const payload = JSON.parse(event.dataTransfer.getData(PROJECT_BOARD_DRAG_MIME)) as {
        cardIds?: unknown
      }
      if (Array.isArray(payload.cardIds)) {
        const cardIds = payload.cardIds.filter((id): id is string => typeof id === 'string')
        if (cardIds.length > 0) props.onDropCards(cardIds)
      }
    } catch {
      // Ignore foreign or malformed drag payloads.
    }
  }
  const selectedCount = props.cards.filter((card) => props.selectedCardIds.has(card.id)).length
  const allSelected = props.cards.length > 0 && selectedCount === props.cards.length
  const selectionState = selectedCount === 0 ? false : allSelected ? true : 'mixed'
  const label = props.status === 'pending' ? t('projectBoardPending') :
    props.status === 'in_progress' ? t('projectBoardInProgress') : t('projectBoardCompleted')
  return (
    <section
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
        const list = listRef.current
        if (!list) return
        const rect = list.getBoundingClientRect()
        if (event.clientY < rect.top + 48) list.scrollTop -= 24
        else if (event.clientY > rect.bottom - 48) list.scrollTop += 24
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={drop}
      className={`flex min-h-0 min-w-[286px] flex-1 flex-col rounded-2xl border transition motion-reduce:transition-none ${
        dragOver ? 'border-accent bg-accent/5' : 'border-ds-border-muted bg-ds-main/55'
      }`}
    >
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between rounded-t-2xl border-b border-ds-border-muted bg-ds-main/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={selectionState}
            aria-label={allSelected ? t('projectBoardDeselectColumn') : t('projectBoardSelectColumn')}
            onClick={() => props.onToggleColumnSelection(!allSelected)}
            className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
              selectedCount > 0 ? 'border-accent bg-accent text-white' : 'border-ds-border text-transparent'
            }`}
          >
            {selectionState === 'mixed' ? '−' : '✓'}
          </button>
          <h2 className="text-[13px] font-semibold text-ds-ink">{label}</h2>
        </div>
        <span className="text-xs tabular-nums text-ds-faint">{props.cards.length}</span>
      </header>
      <div ref={listRef} data-project-board-virtual-list className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const card = props.cards[row.index]
            if (!card) return null
            const pending = props.mutatingCardIds[card.id] === true
            return (
              <div
                key={card.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-2.5"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <CardView
                  card={card}
                  disabled={props.disabled || pending}
                  pending={pending}
                  selected={props.selectedCardIds.has(card.id)}
                  onToggleSelect={props.onToggleSelect}
                  onDragCard={props.onDragCard}
                  onMove={props.onMove}
                  onEdit={props.onEdit}
                  onArchive={props.onArchive}
                  onDelete={props.onDelete}
                  onOpenThread={props.onOpenThread}
                  onOpenPlan={props.onOpenPlan}
                />
              </div>
            )
          })}
        </div>
        {props.cards.length === 0 ? <p className="px-2 py-8 text-center text-xs text-ds-faint">{t('projectBoardEmptyColumn')}</p> : null}
      </div>
      <button
        type="button"
        disabled={props.disabled}
        onClick={props.onAdd}
        className="sticky bottom-0 flex h-11 shrink-0 items-center gap-2 rounded-b-2xl border-t border-ds-border-muted bg-ds-main/95 px-4 text-xs text-ds-muted hover:text-ds-ink disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" /> {t('projectBoardAddTask')}
      </button>
    </section>
  )
}
