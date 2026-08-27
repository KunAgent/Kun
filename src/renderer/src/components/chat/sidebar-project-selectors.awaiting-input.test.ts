import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import {
  sidebarThreadActivity,
  type SidebarThreadActivityContext
} from './sidebar-project-selectors'
import { createSidebarThreadOrderTracker } from './sidebar-thread-order-tracker'

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-01T00:00:00.000Z',
    workspace: '/tmp/project',
    ...overrides
  } as NormalizedThread
}

const baseContext: SidebarThreadActivityContext = {
  activeThreadId: null,
  busy: false,
  watchTurnCompletion: {},
  unreadThreadIds: {}
}

describe('awaiting-input sidebar activity', () => {
  it('outranks running and unread classifications', () => {
    const context: SidebarThreadActivityContext = {
      ...baseContext,
      awaitingUserInputThreadIds: { thr_waiting: true },
      watchTurnCompletion: { thr_waiting: true, thr_running: true },
      unreadThreadIds: { thr_unread: true }
    }
    expect(sidebarThreadActivity(thread('thr_waiting'), context)).toBe('awaiting-input')
    expect(sidebarThreadActivity(thread('thr_running'), context)).toBe('running')
    expect(sidebarThreadActivity(thread('thr_unread'), context)).toBe('unread')
  })

  it('promotes awaiting input within its scoped ordering tracker', () => {
    const tracker = createSidebarThreadOrderTracker()
    const runningContext: SidebarThreadActivityContext = {
      ...baseContext,
      watchTurnCompletion: { thr_running: true }
    }
    const items = [thread('thr_read'), thread('thr_running')]
    tracker.reconcile({ containerKey: 'scope:root', context: runningContext, threads: items })
    const ordered = tracker.reconcile({
      containerKey: 'scope:root',
      context: {
        ...runningContext,
        awaitingUserInputThreadIds: { thr_running: true }
      },
      threads: items
    })
    expect(ordered.map((item) => item.id)).toEqual(['thr_running', 'thr_read'])
  })

  it('falls back to running when the thread is not awaiting input', () => {
    const context: SidebarThreadActivityContext = {
      ...baseContext,
      watchTurnCompletion: { thr_running: true }
    }
    expect(sidebarThreadActivity(thread('thr_running'), context)).toBe('running')
  })
})
