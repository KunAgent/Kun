import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { splitSidebarTaskThreads, strongestTaskActivity, taskGroupCounts } from './sidebar-task-threads'

const thread = (id: string, extra: Partial<NormalizedThread> = {}): NormalizedThread =>
  ({ id, title: id, model: 'm', mode: 'agent', updatedAt: '2026-10-22T00:00:00.000Z', ...extra }) as NormalizedThread
const task = (id: string, parent: string, index: number, total = 3) =>
  thread(id, { relation: 'task', parentThreadId: parent, taskOrigin: { intentId: 'tsg', taskId: `t${index}`, index, total } })

describe('splitSidebarTaskThreads', () => {
  it('nests task sessions under a listed parent in card order and keeps orphans flat', () => {
    const threads = [task('c2', 'p', 2), thread('p'), task('c1', 'p', 1), task('orphan', 'gone', 1), thread('other')]
    const split = splitSidebarTaskThreads(threads, { searching: false })
    expect(split.rest.map((entry) => entry.id)).toEqual(['p', 'orphan', 'other'])
    expect(split.childrenByParent.get('p')!.map((entry) => entry.id)).toEqual(['c1', 'c2'])
  })

  it('lists every match flat while searching', () => {
    const split = splitSidebarTaskThreads([thread('p'), task('c1', 'p', 1)], { searching: true })
    expect(split.rest.map((entry) => entry.id)).toEqual(['p', 'c1'])
    expect(split.childrenByParent.size).toBe(0)
  })

  it('summarizes children for the parent chip', () => {
    expect(taskGroupCounts([task('a', 'p', 1, 3), task('b', 'p', 2, 3)])).toEqual({ started: 2, total: 3 })
    expect(strongestTaskActivity(['read', 'running', 'awaiting-input', 'unread'])).toBe('awaiting-input')
    expect(strongestTaskActivity(['running', 'failed'])).toBe('failed')
    expect(strongestTaskActivity([])).toBe('read')
  })
})
