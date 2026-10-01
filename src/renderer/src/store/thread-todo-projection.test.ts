import { describe, expect, it } from 'vitest'
import type { ThreadTodoList } from '../agent/types'
import { reconcileThreadTodos, threadTodosForProjection } from './thread-todo-projection'

const snapshot = (revision?: number, threadId = 'thread'): ThreadTodoList => ({
  threadId, revision, items: [{ id: 'task', content: 'Task', status: 'pending', taskStatus: 'waiting',
    taskRevision: 1, reason: 'Waiting for a reply', createdAt: 'now', updatedAt: 'now' }], updatedAt: 'now'
})
describe('canonical execution task projections', () => {
  it('ignores duplicate, older and legacy snapshots after canonical migration', () => {
    const current = snapshot(4)
    for (const incoming of [snapshot(3), snapshot(4), snapshot(), null, undefined]) {
      expect(reconcileThreadTodos(current, incoming)).toBe(current)
    }
    const next = snapshot(5)
    expect(reconcileThreadTodos(current, next)).toBe(next)
  })
  it('accepts an explicit higher-revision empty snapshot', () => {
    const empty = { ...snapshot(6), items: [] }
    expect(reconcileThreadTodos(snapshot(5), empty)).toEqual(empty)
  })
  it('retains historical null-clear semantics and isolates different threads', () => {
    expect(reconcileThreadTodos(snapshot(), null)).toBeNull()
    expect(reconcileThreadTodos(snapshot(7), snapshot(1, 'other'))?.threadId).toBe('other')
  })
  it('uses the newest visible state across SSE, caches, sidebar and reconnect snapshots', () => {
    const active = snapshot(5), listed = snapshot(3)
    const state = { activeThreadId: 'thread', activeThreadTodos: active,
      threads: [{ id: 'thread', todos: listed }], adeThreads: [] } as unknown as Parameters<typeof threadTodosForProjection>[0]
    expect(threadTodosForProjection(state, 'thread', snapshot(4))).toBe(active)
    expect(threadTodosForProjection(state, 'thread', undefined)).toBe(active)
    expect(threadTodosForProjection(state, 'thread', snapshot(6))?.revision).toBe(6)
    expect(threadTodosForProjection(state, 'other', snapshot(1, 'other'))?.threadId).toBe('other')
  })
})
