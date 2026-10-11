import type { ThreadTodoList } from '../agent/types'
import type { ChatState } from './chat-store-types'

/** Revisioned task projections are monotonic, including empty lists (clears).
 * Legacy null/omitted snapshots cannot erase canonical execution state.
 */
export function reconcileThreadTodos(
  previous: ThreadTodoList | null | undefined,
  incoming: ThreadTodoList | null | undefined
): ThreadTodoList | null {
  if (incoming === undefined) return previous ?? null
  if (previous && incoming && previous.threadId !== incoming.threadId) return incoming
  if (previous?.revision !== undefined &&
    (incoming?.revision === undefined || incoming.revision <= previous.revision)) return previous
  return incoming
}

export function threadTodosForProjection(
  state: Pick<ChatState, 'activeThreadId' | 'activeThreadTodos' | 'threads' | 'adeThreads'>,
  threadId: string,
  incoming?: ThreadTodoList | null
): ThreadTodoList | null {
  const listed = state.threads.find((thread) => thread.id === threadId)?.todos
    ?? state.adeThreads?.find((thread) => thread.id === threadId)?.todos
  const current = state.activeThreadId === threadId && state.activeThreadTodos?.threadId === threadId
    ? state.activeThreadTodos : undefined
  return reconcileThreadTodos(reconcileThreadTodos(listed, current), incoming)
}
