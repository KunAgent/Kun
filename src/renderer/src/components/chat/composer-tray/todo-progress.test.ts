import { describe, expect, it } from 'vitest'
import type { ThreadTodoItem } from '../../../agent/types'
import {
  getTodoProgress,
  isTodoItemActive,
  isTodoItemCompleted,
  isTodoItemOpen,
  resolveTodoPlanPath,
  todoItemFlag,
  todoRingTone,
  todoSegmentTone
} from './todo-progress'

function item(id: string, status: ThreadTodoItem['status'], overrides: Partial<ThreadTodoItem> = {}): ThreadTodoItem {
  return {
    id,
    content: `Todo ${id}`,
    status,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    ...overrides
  }
}

function planSource(relativePath: string, ordinal: number): ThreadTodoItem['source'] {
  return { kind: 'plan', planId: 'plan-1', relativePath, ordinal, contentHash: `hash-${ordinal}` }
}

const items = [item('one', 'completed'), item('two', 'in_progress'), item('three', 'pending')]

describe('getTodoProgress', () => {
  it('never presents failed or cancelled canonical tasks as successful legacy checkboxes', () => {
    const tasks = [
      item('failed', 'completed', { taskStatus: 'failed' }),
      item('cancelled', 'completed', { taskStatus: 'cancelled' }),
      item('running', 'pending', { taskStatus: 'running' })
    ]
    expect(getTodoProgress(tasks)).toMatchObject({ completed: 0, current: 3, allComplete: false })
    expect(tasks.map(isTodoItemCompleted)).toEqual([false, false, false])
  })

  it('reports the active ordered step and completed state', () => {
    expect(getTodoProgress(items)).toEqual({ completed: 1, current: 2, total: 3, allComplete: false })
    expect(getTodoProgress(items.map((todo) => ({ ...todo, status: 'completed' as const })))).toEqual({
      completed: 3,
      current: 3,
      total: 3,
      allComplete: true
    })
  })

  it('falls back to the next pending step, and is empty for an empty list', () => {
    expect(getTodoProgress([item('a', 'completed'), item('b', 'pending'), item('c', 'pending')]).current).toBe(2)
    expect(getTodoProgress([])).toEqual({ completed: 0, current: 0, total: 0, allComplete: false })
  })

  it('never picks a cancelled or failed task as the next step', () => {
    // Kun reports every unfinished canonical task as a legacy `pending` checkbox.
    const settled = (taskStatus: 'cancelled' | 'failed'): ThreadTodoItem[] => [
      item('a', 'completed', { taskStatus: 'succeeded' }),
      item('b', 'pending', { taskStatus }),
      item('c', 'pending', { taskStatus: 'pending' })
    ]
    expect(getTodoProgress(settled('cancelled'))).toMatchObject({ completed: 1, current: 3 })
    expect(getTodoProgress(settled('failed'))).toMatchObject({ completed: 1, current: 3 })
    expect(getTodoProgress([
      item('a', 'pending', { taskStatus: 'cancelled' }),
      item('b', 'pending', { taskStatus: 'blocked' })
    ]).current).toBe(2)
  })

  it('lets the canonical status decide which step is running', () => {
    expect(getTodoProgress([
      item('stale', 'in_progress', { taskStatus: 'paused' }),
      item('live', 'pending', { taskStatus: 'running' })
    ]).current).toBe(2)
  })

  it('points at the first unfinished task once nothing is left to do', () => {
    expect(getTodoProgress([
      item('a', 'completed', { taskStatus: 'succeeded' }),
      item('b', 'pending', { taskStatus: 'failed' }),
      item('c', 'pending', { taskStatus: 'cancelled' })
    ])).toMatchObject({ completed: 1, current: 2, allComplete: false })
  })
})

describe('todo item readings', () => {
  it('lets the canonical task status win over the legacy checkbox', () => {
    expect(isTodoItemActive(item('a', 'in_progress'))).toBe(true)
    expect(isTodoItemActive(item('b', 'pending', { taskStatus: 'running' }))).toBe(true)
    expect(isTodoItemActive(item('c', 'in_progress', { taskStatus: 'blocked' }))).toBe(false)
    expect(isTodoItemCompleted(item('d', 'pending', { taskStatus: 'succeeded' }))).toBe(true)
  })

  it('treats running and waiting tasks as open, settled ones as closed', () => {
    const open = (['pending', 'running', 'waiting', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'] as const)
      .map((taskStatus) => isTodoItemOpen(item(taskStatus, 'pending', { taskStatus })))
    expect(open).toEqual([true, true, true, true, true, false, false, false])
    expect(['pending', 'in_progress', 'completed'].map((status) =>
      isTodoItemOpen(item(status, status as ThreadTodoItem['status'])))).toEqual([true, true, false])
  })

  it('flags only the states the sheet marks with a pill', () => {
    const flags = (['pending', 'running', 'waiting', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'] as const)
      .map((taskStatus) => todoItemFlag(item(taskStatus, 'pending', { taskStatus })))
    expect(flags).toEqual([null, null, 'waiting', 'blocked', 'paused', null, 'failed', 'cancelled'])
    expect(todoItemFlag(item('legacy', 'in_progress'))).toBeNull()
  })

  it('picks segment and ring tones from the current step', () => {
    expect(todoSegmentTone(undefined)).toBe('default')
    expect(todoSegmentTone(item('a', 'in_progress'))).toBe('running')
    expect(todoSegmentTone(item('b', 'pending'))).toBe('default')
    expect(todoSegmentTone(item('c', 'pending', { taskStatus: 'blocked' }))).toBe('waiting')
    expect(todoSegmentTone(item('d', 'pending', { taskStatus: 'failed' }))).toBe('error')
    expect(todoRingTone(item('a', 'pending'), false)).toBe('running')
    expect(todoRingTone(item('a', 'completed'), true)).toBe('done')
    expect(todoRingTone(item('b', 'pending', { taskStatus: 'waiting' }), false)).toBe('waiting')
    expect(todoRingTone(item('c', 'pending', { taskStatus: 'paused' }), false)).toBe('default')
  })
})

describe('resolveTodoPlanPath', () => {
  it('names the one plan file the checklist came from', () => {
    expect(resolveTodoPlanPath([
      item('a', 'completed', { source: planSource('plans/auth.md', 0) }),
      item('b', 'pending', { source: planSource('plans/auth.md', 1) }),
      item('c', 'pending')
    ])).toBe('plans/auth.md')
  })

  it('is null without plan items or with several plans', () => {
    expect(resolveTodoPlanPath(items)).toBeNull()
    expect(resolveTodoPlanPath([
      item('a', 'pending', { source: planSource('plans/a.md', 0) }),
      item('b', 'pending', { source: planSource('plans/b.md', 0) })
    ])).toBeNull()
  })
})
