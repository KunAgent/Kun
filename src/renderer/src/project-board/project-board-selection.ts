import type { ProjectBoardCard, ProjectBoardStatus } from './project-board-types'

export type ProjectBoardSelection = {
  status: ProjectBoardStatus | null
  cardIds: string[]
  anchorId: string | null
}

export const EMPTY_PROJECT_BOARD_SELECTION: ProjectBoardSelection = {
  status: null,
  cardIds: [],
  anchorId: null
}

export function toggleProjectBoardCardSelection(input: {
  selection: ProjectBoardSelection
  card: ProjectBoardCard
  orderedCardIds: readonly string[]
  range: boolean
}): ProjectBoardSelection {
  const { selection, card } = input
  if (selection.status !== card.status) {
    return { status: card.status, cardIds: [card.id], anchorId: card.id }
  }
  if (input.range && selection.anchorId) {
    const anchor = input.orderedCardIds.indexOf(selection.anchorId)
    const target = input.orderedCardIds.indexOf(card.id)
    if (anchor >= 0 && target >= 0) {
      const [start, end] = anchor <= target ? [anchor, target] : [target, anchor]
      return {
        status: card.status,
        cardIds: [...new Set([
          ...selection.cardIds,
          ...input.orderedCardIds.slice(start, end + 1)
        ])],
        anchorId: selection.anchorId
      }
    }
  }
  const selected = new Set(selection.cardIds)
  if (selected.has(card.id)) selected.delete(card.id)
  else selected.add(card.id)
  return selected.size === 0
    ? EMPTY_PROJECT_BOARD_SELECTION
    : { status: card.status, cardIds: [...selected], anchorId: card.id }
}

export function setProjectBoardColumnSelection(
  status: ProjectBoardStatus,
  cardIds: readonly string[],
  selected: boolean
): ProjectBoardSelection {
  return selected && cardIds.length > 0
    ? { status, cardIds: [...cardIds], anchorId: cardIds[0] ?? null }
    : EMPTY_PROJECT_BOARD_SELECTION
}

export function selectionForProjectBoardDrag(
  selection: ProjectBoardSelection,
  card: ProjectBoardCard
): ProjectBoardSelection {
  return selection.status === card.status && selection.cardIds.includes(card.id)
    ? selection
    : { status: card.status, cardIds: [card.id], anchorId: card.id }
}

export function reconcileProjectBoardSelection(
  selection: ProjectBoardSelection,
  visibleCards: readonly ProjectBoardCard[]
): ProjectBoardSelection {
  if (!selection.status) return EMPTY_PROJECT_BOARD_SELECTION
  const visible = new Set(
    visibleCards.filter((card) => card.status === selection.status).map((card) => card.id)
  )
  const cardIds = selection.cardIds.filter((id) => visible.has(id))
  return cardIds.length === 0
    ? EMPTY_PROJECT_BOARD_SELECTION
    : {
        status: selection.status,
        cardIds,
        anchorId: selection.anchorId && visible.has(selection.anchorId)
          ? selection.anchorId
          : cardIds[0] ?? null
      }
}

export function projectBoardSelectionCards(
  selection: ProjectBoardSelection,
  cards: readonly ProjectBoardCard[]
): ProjectBoardCard[] {
  const selected = new Set(selection.cardIds)
  return cards.filter((card) => selected.has(card.id))
}
