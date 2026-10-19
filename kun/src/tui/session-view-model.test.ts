import { describe, expect, it } from 'vitest'
import {
  exitEpilogue,
  firstMountedEntry,
  formatSessionCost,
  MOUNT_BUDGET,
  SIDEBAR_DOCK_MIN_WIDTH,
  sidebarDocks,
  sidebarTodos,
  trimmedMountStart
} from './session-view-model.js'

describe('session view model', () => {
  it('docks the sidebar only on wide terminals', () => {
    expect(sidebarDocks(SIDEBAR_DOCK_MIN_WIDTH)).toBe(true)
    expect(sidebarDocks(SIDEBAR_DOCK_MIN_WIDTH - 1)).toBe(false)
  })

  it('mounts only the most recent entries of a long conversation', () => {
    expect(firstMountedEntry(10, MOUNT_BUDGET)).toBe(0)
    expect(firstMountedEntry(1_000, 240)).toBe(760)
    expect(firstMountedEntry(1_000, 1_000)).toBe(0)
    expect(firstMountedEntry(5, -3)).toBe(5)
  })

  it('keeps the mounted window fixed unless the view is pinned to the bottom', () => {
    expect(trimmedMountStart(1_000, 0, false)).toBe(0)
    expect(trimmedMountStart(1_000, 0, true)).toBe(1_000 - MOUNT_BUDGET)
    expect(trimmedMountStart(500, 200, true)).toBe(200)
    expect(trimmedMountStart(10, 50, false)).toBe(10)
  })

  it('lists unfinished todos first and counts what does not fit', () => {
    const todos = sidebarTodos([
      { content: 'done one', status: 'completed' },
      { content: 'active', status: 'in_progress' },
      { content: 'next', status: 'pending' },
      { content: 'done two', status: 'completed' }
    ], 3)
    expect(todos.rows.map((todo) => todo.content)).toEqual(['active', 'next', 'done one'])
    expect(todos.more).toBe(1)
  })

  it('formats recorded spend and omits zero currencies', () => {
    expect(formatSessionCost(undefined, undefined)).toBeUndefined()
    expect(formatSessionCost(0, 0)).toBeUndefined()
    expect(formatSessionCost(0.0123, 0.5)).toBe('¥0.50 · $0.012')
    expect(formatSessionCost(12.5, undefined)).toBe('$12.50')
  })

  it('prints a sanitized resume command after exit', () => {
    const text = exitEpilogue({ id: 'thr_1', title: 'Fix \u001b[31mred\u001b[0m bug' })
    expect(text).toContain('Kun · Fix red bug')
    expect(text).toContain('kun tui --thread thr_1')
    expect(text).not.toContain('\u001b')
    expect(exitEpilogue({ id: 'thr_2' })).toContain('Kun · Untitled')
  })
})
