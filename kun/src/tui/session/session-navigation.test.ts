import { describe, expect, it } from 'vitest'
import type { ThreadSummary } from '../../contracts/threads.js'
import { SessionNavigation } from './session-navigation.js'

function summary(id: string, updatedAt: string, status = 'idle'): ThreadSummary {
  return { id, title: `Thread ${id}`, workspace: '/repo', status, updatedAt } as unknown as ThreadSummary
}

const idle = { running: false, waiting: false }

describe('SessionNavigation', () => {
  it('keeps opened sessions as numbered tabs in opening order', () => {
    const navigation = new SessionNavigation()
    expect(navigation.observe({ id: 'a', workspace: '/repo' }, '2026-10-19T10:00:00.000Z')).toBe(true)
    expect(navigation.observe({ id: 'b', workspace: '/repo' }, '2026-10-19T10:01:00.000Z')).toBe(true)
    expect(navigation.observe({ id: 'a', workspace: '/repo' }, '2026-10-19T10:02:00.000Z')).toBe(false)
    expect(navigation.openTabs).toEqual(['a', 'b'])
    expect(navigation.tabAt(2)).toBe('b')
    expect(navigation.tabAt(3)).toBeUndefined()
  })

  it('marks replies that arrived after the reader left a session as unread', () => {
    const navigation = new SessionNavigation()
    navigation.observe({ id: 'a', title: 'First', workspace: '/repo' }, '2026-10-19T10:00:00.000Z')
    navigation.observe({ id: 'b', workspace: '/repo' }, '2026-10-19T10:01:00.000Z')
    const views = navigation.views([
      summary('a', '2026-10-19T10:05:00.000Z'),
      summary('b', '2026-10-19T10:01:00.000Z')
    ], { running: true, waiting: false })
    expect(views.map((view) => [view.slot, view.id, view.current, view.status])).toEqual([
      [1, 'a', false, 'unread'],
      [2, 'b', true, 'running']
    ])
    expect(navigation.statusOf(summary('c', '2026-10-19T10:05:00.000Z', 'running'), idle)).toBe('running')
  })

  it('falls back to the title it saw when the thread list has not caught up', () => {
    const navigation = new SessionNavigation()
    navigation.observe({ id: 'a', title: 'Fresh session', workspace: '/repo' })
    expect(navigation.views([], idle)[0]).toMatchObject({ title: 'Fresh session', workspace: '/repo', status: 'idle' })
  })
})
