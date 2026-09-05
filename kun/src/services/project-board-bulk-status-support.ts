import type {
  ProjectBoardBulkStatusFailure,
  ProjectBoardCard,
  ProjectBoardCounts,
  ProjectBoardDocumentV1
} from '../contracts/project-board.js'
import type { ThreadSummary } from '../contracts/threads.js'

export type LightweightBoardCard = {
  id: string
  kind: 'manual' | 'thread_todo'
  status: ProjectBoardCard['status']
  archived: boolean
  updatedAt: string
  manualId: string
  threadId: string
  todoId: string
}

export type SelectedPlanGroup = {
  thread: ThreadSummary
  todoIds: string[]
  cardIds: string[]
}

export class ProjectBoardBulkConflictError extends Error {
  override name = 'ProjectBoardBulkConflictError'
  constructor(readonly code: 'archived_card' | 'stale_status' | 'in_progress_conflict', message: string) {
    super(message)
  }
}

export function lightweightBoardCards(
  document: ProjectBoardDocumentV1,
  threads: readonly ThreadSummary[]
): Map<string, LightweightBoardCard> {
  const cards = new Map<string, LightweightBoardCard>()
  for (const card of Object.values(document.manualCards)) {
    const id = `manual:${card.id}`
    cards.set(id, {
      id, kind: 'manual', status: card.status, archived: card.archived,
      updatedAt: card.updatedAt, manualId: card.id, threadId: '', todoId: ''
    })
  }
  for (const thread of threads) {
    for (const todo of thread.todos?.items ?? []) {
      if (todo.source?.kind !== 'plan') continue
      const overlay = document.todoOverlays[todoOverlayKey(thread.id, todo.id)]
      const id = threadTodoCardId(thread.id, todo.id)
      cards.set(id, {
        id, kind: 'thread_todo', status: todo.status,
        archived: overlay?.archived ?? false,
        updatedAt: overlay && overlay.updatedAt > todo.updatedAt ? overlay.updatedAt : todo.updatedAt,
        manualId: '', threadId: thread.id, todoId: todo.id
      })
    }
  }
  return cards
}

export function threadTodoCardId(threadId: string, todoId: string): string {
  return `todo:${threadId}:${todoId}`
}

export function countLightweightCards(
  cards: Iterable<LightweightBoardCard>
): ProjectBoardCounts {
  const counts: ProjectBoardCounts = {
    pending: 0, inProgress: 0, completed: 0, archived: 0, total: 0
  }
  for (const card of cards) {
    if (card.archived) {
      counts.archived += 1
      continue
    }
    counts.total += 1
    if (card.status === 'pending') counts.pending += 1
    else if (card.status === 'in_progress') counts.inProgress += 1
    else counts.completed += 1
  }
  return counts
}

export function assertNoInProgressSelectionConflict(
  cards: readonly LightweightBoardCard[],
  status: ProjectBoardCard['status']
): void {
  if (status !== 'in_progress') return
  const countByThread = new Map<string, number>()
  for (const card of cards) {
    if (card.kind !== 'thread_todo') continue
    const count = (countByThread.get(card.threadId) ?? 0) + 1
    if (count > 1) {
      throw new ProjectBoardBulkConflictError(
        'in_progress_conflict',
        `thread ${card.threadId} has multiple selected Plan todos`
      )
    }
    countByThread.set(card.threadId, count)
  }
}

export function groupSelectedPlanCards(
  cards: readonly LightweightBoardCard[],
  threads: readonly ThreadSummary[]
): Map<string, SelectedPlanGroup> {
  const threadById = new Map(threads.map((thread) => [thread.id, thread]))
  const groups = new Map<string, SelectedPlanGroup>()
  for (const card of cards) {
    if (card.kind !== 'thread_todo') continue
    const thread = threadById.get(card.threadId)
    if (!thread) continue
    const group = groups.get(card.threadId) ?? { thread, todoIds: [], cardIds: [] }
    group.todoIds.push(card.todoId)
    group.cardIds.push(card.id)
    groups.set(card.threadId, group)
  }
  return groups
}

export function failureCodeForBulkError(
  message: string
): ProjectBoardBulkStatusFailure['code'] {
  if (/not found/i.test(message)) return 'source_missing'
  if (/stale todo status/i.test(message)) return 'stale_status'
  return 'write_failed'
}

export async function runWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= values.length) return
      await operation(values[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
}

function todoOverlayKey(threadId: string, todoId: string): string {
  return Buffer.from(`${threadId}\0${todoId}`, 'utf8').toString('base64url')
}
