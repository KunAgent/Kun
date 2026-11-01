import { afterEach, describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import {
  hydrateEmptyThreadActivations,
  noteEmptyThreadActivated,
  requestSidebarThreadPromotion,
  resetSidebarThreadPromotions
} from '../../lib/empty-thread-activation'
import {
  sortSidebarThreads,
  type SidebarThreadActivityContext
} from './sidebar-project-selectors'
import { createSidebarThreadOrderTracker } from './sidebar-thread-order-tracker'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

function thread(id: string, updatedAt: string, extra: Partial<NormalizedThread> = {}): NormalizedThread {
  return { id, title: id, workspace: '/tmp/app', updatedAt, ...extra } as NormalizedThread
}

const settled: SidebarThreadActivityContext = {
  activeThreadId: null,
  busy: false,
  watchTurnCompletion: {},
  unreadThreadIds: {}
}

const older = thread('thr_old_empty', '2026-10-20T00:00:00.000Z')
const used = thread('thr_used', '2026-10-26T00:00:00.000Z')

describe('New-session reuse in the sidebar', () => {
  afterEach(() => resetSidebarThreadPromotions())

  it('sorts a reused empty session to its New-session activation time', () => {
    const storage = new MemoryStorage()
    hydrateEmptyThreadActivations(storage)
    expect(sortSidebarThreads([older, used]).map((item) => item.id))
      .toEqual(['thr_used', 'thr_old_empty'])

    noteEmptyThreadActivated('thr_old_empty', Date.parse('2026-10-27T00:00:00.000Z'), storage)
    expect(sortSidebarThreads([older, used]).map((item) => item.id))
      .toEqual(['thr_old_empty', 'thr_used'])
    // The row itself is never rewritten to fake recency.
    expect(older.updatedAt).toBe('2026-10-20T00:00:00.000Z')
  })

  it('lifts the reused row inside its own priority bucket only', () => {
    const tracker = createSidebarThreadOrderTracker()
    const rows = [
      thread('thr_a', '2026-10-27T03:00:00.000Z'),
      thread('thr_b', '2026-10-27T02:00:00.000Z'),
      thread('thr_pinned', '2026-10-01T00:00:00.000Z', { pinned: true }),
      thread('thr_running', '2026-10-01T00:00:00.000Z', { status: 'running' })
    ]
    const first = tracker.reconcile({
      containerKey: 'project:root',
      context: { ...settled, activeThreadId: 'thr_running', busy: true },
      threads: sortSidebarThreads(rows)
    }).map((item) => item.id)
    expect(first[0]).toBe('thr_pinned')

    requestSidebarThreadPromotion('thr_b')
    const second = tracker.reconcile({
      containerKey: 'project:root',
      context: { ...settled, activeThreadId: 'thr_running', busy: true },
      threads: sortSidebarThreads(rows)
    }).map((item) => item.id)

    // Pinned first, then the running row's bucket, then the promoted read row.
    expect(second.indexOf('thr_b')).toBeLessThan(second.indexOf('thr_a'))
    expect(second[0]).toBe('thr_pinned')
    expect(second.indexOf('thr_running')).toBeLessThan(second.indexOf('thr_b'))
  })

  it('keeps earlier order when only a timestamp refreshes', () => {
    const tracker = createSidebarThreadOrderTracker()
    const base = [thread('thr_a', '2026-10-27T03:00:00.000Z'), thread('thr_b', '2026-10-27T02:00:00.000Z')]
    tracker.reconcile({ containerKey: 'project:root', context: settled, threads: sortSidebarThreads(base) })

    const refreshed = [base[0]!, { ...base[1]!, updatedAt: '2026-10-27T04:00:00.000Z' }]
    const order = tracker.reconcile({
      containerKey: 'project:root',
      context: settled,
      threads: sortSidebarThreads(refreshed)
    }).map((item) => item.id)
    expect(order).toEqual(['thr_a', 'thr_b'])
  })
})
