import type {
  ProjectBoardCard,
  ProjectBoardFilters,
  ProjectBoardStatus
} from './project-board-types'

const PRIORITY_ORDER = new Map([['P0', 0], ['P1', 1], ['P2', 2]])

export function selectVisibleProjectBoardCards(input: {
  cards: ProjectBoardCard[]
  searchQuery: string
  filters: ProjectBoardFilters
  archived: boolean
}): ProjectBoardCard[] {
  const query = input.searchQuery.trim().toLocaleLowerCase()
  return input.cards.filter((card) => {
    if (card.archived !== input.archived) return false
    if (!input.archived && !input.filters.showCompleted && card.status === 'completed') return false
    if (input.filters.categories.length &&
      (card.category === 'plan' || !input.filters.categories.includes(card.category))) return false
    const priority = card.priority ?? 'none'
    if (input.filters.priorities.length && !input.filters.priorities.includes(priority)) return false
    const source = card.kind === 'manual' ? 'manual' : 'plan'
    if (input.filters.sources.length && !input.filters.sources.includes(source)) return false
    if (!query) return true
    return [
      card.title,
      card.description,
      card.source.threadTitle,
      card.source.sectionTitle
    ].filter(Boolean).some((value) => value?.toLocaleLowerCase().includes(query))
  }).sort(compareProjectBoardCards)
}

export function groupProjectBoardCards(
  cards: ProjectBoardCard[]
): Record<ProjectBoardStatus, ProjectBoardCard[]> {
  return {
    pending: cards.filter((card) => card.status === 'pending'),
    in_progress: cards.filter((card) => card.status === 'in_progress'),
    completed: cards.filter((card) => card.status === 'completed')
  }
}

export function projectBoardOverview(cards: ProjectBoardCard[]) {
  const active = cards.filter((card) => !card.archived)
  const completed = active.filter((card) => card.status === 'completed').length
  const p0Open = active.filter((card) => card.priority === 'P0' && card.status !== 'completed').length
  const plan = active.filter((card) => card.kind === 'thread_todo').length
  return {
    total: active.length,
    completed,
    pending: active.filter((card) => card.status === 'pending').length,
    inProgress: active.filter((card) => card.status === 'in_progress').length,
    completionRate: active.length ? completed / active.length : 0,
    p0Open,
    plan,
    manual: active.length - plan,
    recent: [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10)
  }
}

export function compareProjectBoardCards(left: ProjectBoardCard, right: ProjectBoardCard): number {
  const priority = (PRIORITY_ORDER.get(left.priority ?? '') ?? 3) -
    (PRIORITY_ORDER.get(right.priority ?? '') ?? 3)
  if (priority !== 0) return priority
  const updated = right.updatedAt.localeCompare(left.updatedAt)
  return updated !== 0 ? updated : left.id.localeCompare(right.id)
}
