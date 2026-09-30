import type { ThreadTodoList } from '../agent/types'
import type { ChatStoreSet } from './chat-store-types'
import { threadTodosForProjection } from './thread-todo-projection'

export function applyTodosSnapshot(
  set: ChatStoreSet,
  threadId: string,
  todos: ThreadTodoList | null,
  updatedAt = new Date().toISOString()
): void {
  set((s) => {
    const current = threadTodosForProjection(s, threadId, todos)
    return {
    activeThreadTodos: s.activeThreadId === threadId ? current : s.activeThreadTodos,
    threads: s.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, todos: current, updatedAt: current?.updatedAt ?? updatedAt }
        : thread
    ),
    adeThreads: (s.adeThreads ?? []).map((thread) =>
      thread.id === threadId
        ? { ...thread, todos: current, updatedAt: current?.updatedAt ?? updatedAt }
        : thread
    )
  }})
}
