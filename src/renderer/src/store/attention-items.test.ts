import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { SidebarThreadActivityContext } from '../components/chat/sidebar-project-selectors'
import { attentionItemCount, selectAttentionItems } from './attention-items'

function thread(id: string, patch: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: `Thread ${id}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    ...patch
  } as NormalizedThread
}

function context(patch: Partial<SidebarThreadActivityContext> = {}): SidebarThreadActivityContext {
  return {
    activeThreadId: null,
    busy: false,
    watchTurnCompletion: {},
    unreadThreadIds: {},
    scheduledThreadActivities: {},
    awaitingUserInputThreadIds: {},
    backgroundActivityByThread: {},
    ...patch
  }
}

describe('selectAttentionItems', () => {
  it('lists pending questions, failures and unread replies in priority order', () => {
    const items = selectAttentionItems({
      threads: [
        thread('unread', { updatedAt: '2026-01-03T00:00:00.000Z' }),
        thread('failed'),
        thread('asked')
      ],
      activityContext: context({
        unreadThreadIds: { unread: 'completed', failed: 'failed' },
        awaitingUserInputThreadIds: { asked: true }
      })
    })

    expect(items.map((item) => [item.threadId, item.kind])).toEqual([
      ['asked', 'awaiting-input'],
      ['failed', 'failed'],
      ['unread', 'unread']
    ])
  })

  it('treats a background unit waiting on the user as a pending question', () => {
    const items = selectAttentionItems({
      threads: [thread('worker')],
      activityContext: context({ backgroundActivityByThread: { worker: 'waiting' } })
    })

    expect(items).toEqual([
      expect.objectContaining({ threadId: 'worker', kind: 'awaiting-input' })
    ])
  })

  it('never counts running or scheduled work as unread', () => {
    const items = selectAttentionItems({
      threads: [thread('running'), thread('scheduled')],
      activityContext: context({
        watchTurnCompletion: { running: true },
        scheduledThreadActivities: {
          scheduled: {
            state: 'scheduled',
            taskCount: 1,
            nextRunAt: '2026-01-02T00:00:00.000Z',
            queued: false
          }
        }
      })
    })

    expect(items).toEqual([])
  })

  it('skips archived threads and collapses duplicate rows', () => {
    const items = selectAttentionItems({
      threads: [
        thread('archived', { archived: true }),
        thread('a'),
        thread('a')
      ],
      activityContext: context({ unreadThreadIds: { archived: 'completed', a: 'completed' } })
    })

    expect(attentionItemCount(items)).toBe(1)
    expect(items[0]?.threadId).toBe('a')
  })

  it('keeps the open thread unread hidden but its question reachable', () => {
    const items = selectAttentionItems({
      threads: [thread('open')],
      activityContext: context({
        activeThreadId: 'open',
        unreadThreadIds: { open: 'completed' },
        awaitingUserInputThreadIds: { open: true }
      })
    })

    expect(items.map((item) => item.kind)).toEqual(['awaiting-input'])
  })

  it('drops registry entries whose thread is gone instead of leaving a phantom count', () => {
    const items = selectAttentionItems({
      threads: [thread('alive')],
      activityContext: context({ unreadThreadIds: { gone: 'completed', alive: 'completed' } })
    })

    expect(items.map((item) => item.threadId)).toEqual(['alive'])
  })
})
