import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import {
  sortSidebarThreads,
  type SidebarThreadActivityContext
} from './sidebar-project-selectors'
import {
  createSidebarThreadOrderTracker,
  type SidebarThreadOrderTracker
} from './sidebar-thread-order-tracker'

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    workspace: '/tmp/app',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides
  } as NormalizedThread
}

const settledContext: SidebarThreadActivityContext = {
  activeThreadId: null,
  busy: false,
  watchTurnCompletion: {},
  unreadThreadIds: {}
}

function reconcile(
  tracker: SidebarThreadOrderTracker,
  threads: NormalizedThread[],
  context: SidebarThreadActivityContext,
  baselineKey = ''
): string[] {
  return tracker.reconcile({
    baselineKey,
    containerKey: 'project:root',
    context,
    threads: sortSidebarThreads(threads)
  }).map((item) => item.id)
}

describe('sidebar stable thread ordering', () => {
  it('moves a newly running row above read rows when running and updatedAt arrive together', () => {
    const tracker = createSidebarThreadOrderTracker()
    const settled = thread('settled', { updatedAt: '2026-08-20T00:00:05.000Z' })
    const background = thread('background', { updatedAt: '2026-08-20T00:00:01.000Z' })
    expect(reconcile(tracker, [background, settled], settledContext)).toEqual([
      'settled',
      'background'
    ])

    const refreshed = thread('background', { updatedAt: '2026-08-20T00:00:09.000Z' })
    const runningContext = {
      ...settledContext,
      watchTurnCompletion: { background: true }
    }
    expect(reconcile(tracker, [refreshed, settled], runningContext)).toEqual([
      'background',
      'settled'
    ])
    expect(reconcile(tracker, [
      thread('background', { updatedAt: '2026-08-20T00:00:12.000Z' }),
      settled
    ], runningContext)).toEqual(['background', 'settled'])
  })

  it('places a running row above newer read rows when first discovered at startup', () => {
    const tracker = createSidebarThreadOrderTracker()
    const context = { ...settledContext, watchTurnCompletion: { running: true } }
    expect(reconcile(tracker, [
      thread('running', { updatedAt: '2026-08-20T00:00:01.000Z' }),
      thread('settled', { updatedAt: '2026-08-20T00:00:05.000Z' })
    ], context)).toEqual(['running', 'settled'])
  })

  it('promotes awaiting input once and freezes the promoted position after answering', () => {
    const tracker = createSidebarThreadOrderTracker()
    const newer = thread('newer', { updatedAt: '2026-08-20T00:00:05.000Z' })
    const waiting = thread('waiting', { updatedAt: '2026-08-20T00:00:01.000Z' })
    const running = { ...settledContext, watchTurnCompletion: { waiting: true } }
    expect(reconcile(tracker, [waiting, newer], running)).toEqual(['waiting', 'newer'])

    const awaiting = {
      ...running,
      awaitingUserInputThreadIds: { waiting: true as const }
    }
    expect(reconcile(tracker, [waiting, newer], awaiting)).toEqual(['waiting', 'newer'])
    expect(reconcile(tracker, [waiting, newer], awaiting)).toEqual(['waiting', 'newer'])
    expect(reconcile(tracker, [waiting, newer], running)).toEqual(['waiting', 'newer'])
  })

  it.each([
    ['completed', { unreadThreadIds: { result: 'completed' as const } }],
    ['failed', { unreadThreadIds: { result: 'failed' as const } }],
    ['visible completion', {}]
  ])('promotes a %s result after running', (_label, resultPatch) => {
    const tracker = createSidebarThreadOrderTracker()
    const result = thread('result', { updatedAt: '2026-08-20T00:00:01.000Z' })
    const newer = thread('newer-result', { updatedAt: '2026-08-20T00:00:05.000Z' })
    const running = { ...settledContext, watchTurnCompletion: { result: true } }
    reconcile(tracker, [result, newer], running)
    expect(reconcile(tracker, [result, newer], {
      ...settledContext,
      ...resultPatch
    })).toEqual(['result', 'newer-result'])
  })

  it('orders simultaneous attention transitions by final updatedAt', () => {
    const tracker = createSidebarThreadOrderTracker()
    const first = thread('first-result', { updatedAt: '2026-08-20T00:00:02.000Z' })
    const second = thread('second-result', { updatedAt: '2026-08-20T00:00:01.000Z' })
    reconcile(tracker, [first, second], {
      ...settledContext,
      watchTurnCompletion: { 'first-result': true, 'second-result': true }
    })

    expect(reconcile(tracker, [
      { ...first, updatedAt: '2026-08-20T00:00:08.000Z' },
      { ...second, updatedAt: '2026-08-20T00:00:09.000Z' }
    ], {
      ...settledContext,
      unreadThreadIds: {
        'first-result': 'completed',
        'second-result': 'completed'
      }
    })).toEqual(['second-result', 'first-result'])
  })

  it('keeps pinned rows above attention promotions', () => {
    const tracker = createSidebarThreadOrderTracker()
    const pinned = thread('pinned', { pinned: true })
    const waiting = thread('waiting-under-pin')
    expect(reconcile(tracker, [waiting, pinned], {
      ...settledContext,
      watchTurnCompletion: { 'waiting-under-pin': true }
    })).toEqual(['pinned', 'waiting-under-pin'])
    expect(reconcile(tracker, [waiting, pinned], {
      ...settledContext,
      awaitingUserInputThreadIds: { 'waiting-under-pin': true }
    })).toEqual(['pinned', 'waiting-under-pin'])
  })

  it('keeps attention priority above a changed manual-order baseline', () => {
    const tracker = createSidebarThreadOrderTracker()
    const waiting = thread('manual-waiting')
    const other = thread('manual-other')
    reconcile(tracker, [other, waiting], {
      ...settledContext,
      awaitingUserInputThreadIds: { 'manual-waiting': true }
    })
    expect(reconcile(tracker, [other, waiting], {
      ...settledContext,
      awaitingUserInputThreadIds: { 'manual-waiting': true }
    }, 'manual-v2')).toEqual(['manual-waiting', 'manual-other'])
  })

  it('keeps the previous relative order while running timestamps refresh', () => {
    const tracker = createSidebarThreadOrderTracker()
    const running = {
      ...settledContext,
      watchTurnCompletion: { 'running-a': true, 'running-b': true }
    }
    expect(reconcile(tracker, [
      thread('read', { updatedAt: '2026-08-20T00:00:09.000Z' }),
      thread('running-a', { updatedAt: '2026-08-20T00:00:05.000Z' }),
      thread('running-b', { updatedAt: '2026-08-20T00:00:04.000Z' })
    ], running)).toEqual(['running-a', 'running-b', 'read'])

    expect(reconcile(tracker, [
      thread('running-b', { updatedAt: '2026-08-20T00:00:12.000Z' }),
      thread('running-a', { updatedAt: '2026-08-20T00:00:11.000Z' }),
      thread('read', { updatedAt: '2026-08-20T00:00:09.000Z' })
    ], running)).toEqual(['running-a', 'running-b', 'read'])
  })

  it('demotes a viewed completed result after the last still-running thread', () => {
    const tracker = createSidebarThreadOrderTracker()
    const runningA = thread('running-a', { updatedAt: '2026-08-20T00:00:09.000Z' })
    const runningB = thread('running-b', { updatedAt: '2026-08-20T00:00:08.000Z' })
    const result = thread('result', { updatedAt: '2026-08-20T00:00:01.000Z' })
    const newer = thread('newer-read', { updatedAt: '2026-08-20T00:00:05.000Z' })
    const running = {
      ...settledContext,
      watchTurnCompletion: { 'running-a': true, 'running-b': true, result: true }
    }
    reconcile(tracker, [runningA, runningB, newer, result], running)
    expect(reconcile(tracker, [runningA, runningB, newer, result], {
      ...settledContext,
      watchTurnCompletion: { 'running-a': true, 'running-b': true },
      unreadThreadIds: { result: 'completed' }
    })).toEqual(['result', 'running-a', 'running-b', 'newer-read'])

    expect(reconcile(tracker, [runningA, runningB, newer, result], {
      ...settledContext,
      activeThreadId: 'result',
      watchTurnCompletion: { 'running-a': true, 'running-b': true }
    })).toEqual(['running-a', 'running-b', 'result', 'newer-read'])
  })

  it('demotes a viewed failed result the same way', () => {
    const tracker = createSidebarThreadOrderTracker()
    const runningA = thread('failed-running', { updatedAt: '2026-08-20T00:00:09.000Z' })
    const failed = thread('failed', { updatedAt: '2026-08-20T00:00:01.000Z' })
    const running = { ...settledContext, watchTurnCompletion: { 'failed-running': true, failed: true } }
    reconcile(tracker, [runningA, failed], running)
    expect(reconcile(tracker, [runningA, failed], {
      ...settledContext,
      watchTurnCompletion: { 'failed-running': true },
      unreadThreadIds: { failed: 'failed' }
    })).toEqual(['failed', 'failed-running'])

    expect(reconcile(tracker, [runningA, failed], {
      ...settledContext,
      activeThreadId: 'failed',
      watchTurnCompletion: { 'failed-running': true }
    })).toEqual(['failed-running', 'failed'])
  })

  it('keeps a viewed result in place when nothing is running', () => {
    const tracker = createSidebarThreadOrderTracker()
    const result = thread('idle-result', { updatedAt: '2026-08-20T00:00:01.000Z' })
    const newer = thread('idle-newer', { updatedAt: '2026-08-20T00:00:05.000Z' })
    reconcile(tracker, [newer, result], {
      ...settledContext,
      watchTurnCompletion: { 'idle-result': true }
    })
    expect(reconcile(tracker, [newer, result], {
      ...settledContext,
      unreadThreadIds: { 'idle-result': 'completed' }
    })).toEqual(['idle-result', 'idle-newer'])
    expect(reconcile(tracker, [newer, result], {
      ...settledContext,
      activeThreadId: 'idle-result'
    })).toEqual(['idle-result', 'idle-newer'])
  })

  it('keeps a viewed pinned result pinned', () => {
    const tracker = createSidebarThreadOrderTracker()
    const runningA = thread('pin-running', { updatedAt: '2026-08-20T00:00:09.000Z' })
    const pinnedResult = thread('pin-result', { pinned: true, updatedAt: '2026-08-20T00:00:01.000Z' })
    const running = { ...settledContext, watchTurnCompletion: { 'pin-running': true, 'pin-result': true } }
    reconcile(tracker, [runningA, pinnedResult], running)
    expect(reconcile(tracker, [runningA, pinnedResult], {
      ...settledContext,
      unreadThreadIds: { 'pin-result': 'completed' }
    })).toEqual(['pin-result', 'pin-running'])

    expect(reconcile(tracker, [runningA, pinnedResult], {
      ...settledContext,
      activeThreadId: 'pin-result',
      watchTurnCompletion: { 'pin-running': true }
    })).toEqual(['pin-result', 'pin-running'])
  })

  it('does not move a plain read row when it is merely selected', () => {
    const tracker = createSidebarThreadOrderTracker()
    const top = thread('plain-top', { updatedAt: '2026-08-20T00:00:09.000Z' })
    const bottom = thread('plain-bottom', { updatedAt: '2026-08-20T00:00:01.000Z' })
    reconcile(tracker, [top, bottom], settledContext)
    expect(reconcile(tracker, [top, bottom], {
      ...settledContext,
      activeThreadId: 'plain-bottom'
    })).toEqual(['plain-top', 'plain-bottom'])
  })
})
