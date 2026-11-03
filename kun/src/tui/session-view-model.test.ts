import { describe, expect, it } from 'vitest'
import {
  contextRing,
  exitEpilogue,
  firstMountedEntry,
  formatSessionCost,
  groupByWorkspace,
  MOUNT_BUDGET,
  nextOpenTabs,
  RAIL_MIN_WIDTH,
  railDocks,
  relativeTime,
  sessionTabStatus,
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

  it('docks the session rail only on very wide terminals', () => {
    expect(railDocks(RAIL_MIN_WIDTH)).toBe(true)
    expect(railDocks(RAIL_MIN_WIDTH - 1)).toBe(false)
  })

  it('fills the context ring and warns as the window fills', () => {
    expect(contextRing(0)).toEqual({ glyph: '○', level: 'ok' })
    expect(contextRing(25).glyph).toBe('◔')
    expect(contextRing(50).glyph).toBe('◑')
    expect(contextRing(72)).toEqual({ glyph: '◕', level: 'warn' })
    expect(contextRing(95)).toEqual({ glyph: '●', level: 'danger' })
  })

  it('derives tab status from the live session or the thread list', () => {
    expect(sessionTabStatus({ current: true, running: true, waiting: true })).toBe('waiting')
    expect(sessionTabStatus({ current: true, running: true })).toBe('running')
    expect(sessionTabStatus({ current: false, running: true })).toBe('running')
    expect(sessionTabStatus({ current: false, running: false, updatedAt: '2026-10-19T10:05:00Z', lastSeenAt: '2026-10-19T10:00:00Z' })).toBe('unread')
    expect(sessionTabStatus({ current: false, running: false, updatedAt: '2026-10-19T10:00:00Z' })).toBe('idle')
  })

  it('appends opened sessions and drops the oldest past the limit', () => {
    expect(nextOpenTabs([], 'a')).toEqual(['a'])
    expect(nextOpenTabs(['a', 'b'], 'a')).toEqual(['a', 'b'])
    expect(nextOpenTabs(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
    expect(nextOpenTabs(['a'], undefined)).toEqual(['a'])
  })

  it('prints compact relative times', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    expect(relativeTime(undefined, now)).toBe('')
    expect(relativeTime('2026-10-19T11:59:30Z', now)).toBe('now')
    expect(relativeTime('2026-10-19T11:55:00Z', now)).toBe('5m')
    expect(relativeTime('2026-10-19T09:00:00Z', now)).toBe('3h')
    expect(relativeTime('2026-10-18T10:00:00Z', now)).toBe('yday')
    expect(relativeTime('2026-10-15T12:00:00Z', now)).toBe('4d')
  })

  it('groups threads by workspace with the current one first', () => {
    const threads = [
      { id: '1', workspace: '/other' },
      { id: '2', workspace: '/repo' },
      { id: '3', workspace: '/repo' },
      { id: '4', workspace: '/repo' }
    ]
    expect(groupByWorkspace(threads, '/repo', 2)).toEqual([
      { workspace: '/repo', threads: [threads[1], threads[2]] },
      { workspace: '/other', threads: [threads[0]] }
    ])
  })
})
