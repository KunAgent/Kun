import type { DragEvent, ReactElement } from 'react'
import type { ProjectBoardCard, ProjectBoardStatus } from '../../project-board/project-board-types'
import { groupProjectBoardCards } from '../../project-board/project-board-selectors'
import type { ProjectBoardSelection } from '../../project-board/project-board-selection'
import { ProjectBoardColumn } from './ProjectBoardColumn'

type Props = {
  cards: ProjectBoardCard[]
  disabled: boolean
  mutatingCardIds: Record<string, true>
  selection: ProjectBoardSelection
  onAdd: (status: ProjectBoardStatus) => void
  onMove: (card: ProjectBoardCard, status: ProjectBoardStatus) => void
  onMoveCards: (cards: ProjectBoardCard[], status: ProjectBoardStatus) => void
  onToggleSelect: (card: ProjectBoardCard, options: { range: boolean }) => void
  onToggleColumnSelection: (
    status: ProjectBoardStatus,
    cards: ProjectBoardCard[],
    selected: boolean
  ) => void
  onDragCard: (card: ProjectBoardCard, event: DragEvent<HTMLElement>) => void
  onEdit: (card: ProjectBoardCard) => void
  onArchive: (card: ProjectBoardCard, archived: boolean) => void
  onDelete: (card: ProjectBoardCard) => void
  onOpenThread: (card: ProjectBoardCard) => void
  onOpenPlan: (card: ProjectBoardCard) => void
}

const STATUSES: ProjectBoardStatus[] = ['pending', 'in_progress', 'completed']

export function ProjectBoard(props: Props): ReactElement {
  const grouped = groupProjectBoardCards(props.cards)
  const selectedIds = new Set(props.selection.cardIds)
  return (
    <div className="grid h-full min-h-[460px] min-w-[930px] grid-cols-3 gap-4">
      {STATUSES.map((status) => (
        <ProjectBoardColumn
          key={status}
          status={status}
          cards={grouped[status]}
          disabled={props.disabled}
          mutatingCardIds={props.mutatingCardIds}
          selectedCardIds={selectedIds}
          onAdd={() => props.onAdd(status)}
          onDropCards={(cardIds) => {
            const ids = new Set(cardIds)
            const cards = props.cards.filter((candidate) => ids.has(candidate.id))
            if (cards.length > 0) props.onMoveCards(cards, status)
          }}
          onToggleColumnSelection={(selected) =>
            props.onToggleColumnSelection(status, grouped[status], selected)}
          onToggleSelect={props.onToggleSelect}
          onDragCard={props.onDragCard}
          onMove={props.onMove}
          onEdit={props.onEdit}
          onArchive={props.onArchive}
          onDelete={props.onDelete}
          onOpenThread={props.onOpenThread}
          onOpenPlan={props.onOpenPlan}
        />
      ))}
    </div>
  )
}
