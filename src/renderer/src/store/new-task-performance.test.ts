import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import type { ChatState } from './chat-store-types'
import {
  findReusableEmptyThreadId,
  listedThreadEmptiness,
  REUSABLE_THREAD_DETAIL_CHECKS
} from './chat-store-runtime-helpers'
import { threadNeedsBlankPageForNewTask } from './chat-store-new-task-leave'
import { activeThreadMayHaveUsage } from './active-thread-usage-gate'
import { NEW_TASK_SLOW_LOG_MS, startNewTaskTiming } from './new-task-timing'

const WORKSPACE = '/repo'
const thread = (id: string, extra: Partial<NormalizedThread> = {}): NormalizedThread => ({
  id, title: '', model: 'm', mode: 'agent', workspace: WORKSPACE,
  updatedAt: `2026-10-11T00:00:${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}.000Z`,
  ...extra
} as NormalizedThread)
const userBlock = { kind: 'user', id: 'u1', text: 'hi' } as unknown as ChatBlock
const state = (overrides: Partial<ChatState>): ChatState => ({
  activeThreadId: null, threads: [], adeThreads: [], blocks: [], busy: false, queuedMessages: [],
  threadLoadingId: null, lastTurnUsage: null, ...overrides
} as unknown as ChatState)

describe('New task empty-thread reuse', () => {
  it('reads emptiness from the list and lets local sends and history references win', () => {
    expect(listedThreadEmptiness(thread('t1', { turnCount: 0 }))).toBe('empty')
    expect(listedThreadEmptiness(thread('t1', { turnCount: 2 }))).toBe('used')
    // The list may not have refreshed since this thread's first message was sent.
    expect(listedThreadEmptiness(thread('t1', { turnCount: 0, latestTurnId: 'turn-1' }))).toBe('used')
    expect(listedThreadEmptiness(thread('t1', { turnCount: 0, historyRefId: 'codex:1' }))).toBe('unknown')
    expect(listedThreadEmptiness(thread('t1', { turnCount: 0, forkedFromThreadId: 't0' }))).toBe('unknown')
    expect(listedThreadEmptiness(thread('t1'))).toBe('unknown')
  })

  it('reuses a listed empty thread without loading any timeline', async () => {
    const provider = { getThreadDetail: vi.fn() }
    const id = await findReusableEmptyThreadId(state({
      threads: [thread('t3', { turnCount: 4 }), thread('t2', { turnCount: 0 })]
    }), provider as never, WORKSPACE)
    expect(id).toBe('t2')
    expect(provider.getThreadDetail).not.toHaveBeenCalled()
  })

  it('checks only the newest legacy rows, concurrently', async () => {
    const pending: Array<(value: { blocks: ChatBlock[] }) => void> = []
    const provider = { getThreadDetail: vi.fn((_threadId: string) =>
      new Promise<{ blocks: ChatBlock[] }>((resolve) => { pending.push(resolve) })) }
    const lookup = findReusableEmptyThreadId(state({
      threads: [thread('t1'), thread('t2'), thread('t3'), thread('t4')]
    }), provider as never, WORKSPACE)
    await Promise.resolve()
    expect(provider.getThreadDetail).toHaveBeenCalledTimes(REUSABLE_THREAD_DETAIL_CHECKS)
    expect(provider.getThreadDetail.mock.calls.map(([id]) => id)).toEqual(['t4', 't3'])
    pending[0]!({ blocks: [userBlock] })
    pending[1]!({ blocks: [] })
    expect(await lookup).toBe('t3')
  })
})

describe('New task blank page', () => {
  it('leaves a conversation with content, a running turn, a queue or a pending hydration', () => {
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: 't1', blocks: [userBlock] }))).toBe(true)
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: 't1', busy: true }))).toBe(true)
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: 't1', threadLoadingId: 't1' }))).toBe(true)
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: 't1', queuedMessages: [{}] as never }))).toBe(true)
  })

  it('keeps an already-empty conversation, which New task would reuse anyway', () => {
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: 't1' }))).toBe(false)
    expect(threadNeedsBlankPageForNewTask(state({ activeThreadId: null, blocks: [userBlock] }))).toBe(false)
  })
})

describe('usage requests for a new thread', () => {
  it('skips a thread that never accepted a turn and re-enables on content or activity', () => {
    const empty = thread('t1', { turnCount: 0 })
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [empty] }))).toBe(false)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [empty], threadLoadingId: 't1' }))).toBe(false)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [empty], blocks: [userBlock] }))).toBe(true)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [empty], busy: true }))).toBe(true)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [empty],
      lastTurnUsage: { threadId: 't1', snapshot: {} } as never }))).toBe(true)
  })

  it('keeps requesting while an unknown or used thread hydrates', () => {
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [thread('t1')], threadLoadingId: 't1' }))).toBe(true)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: 't1', threads: [thread('t1', { turnCount: 3 })],
      threadLoadingId: 't1' }))).toBe(true)
    expect(activeThreadMayHaveUsage(state({ activeThreadId: null }))).toBe(false)
  })
})

describe('New task timing', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('names each step only when the whole request was slow', () => {
    let clock = 0
    const lines: string[] = []
    const fast = startNewTaskTiming('createThread', (line) => lines.push(line), () => clock)
    clock = 100; fast.step('settings'); fast.finish('created a thread')
    expect(lines).toEqual([])
    const slow = startNewTaskTiming('createThread', (line) => lines.push(line), () => clock)
    clock += 40; slow.step('settings')
    clock += NEW_TASK_SLOW_LOG_MS; slow.step('reuse-lookup'); slow.finish('created a thread')
    expect(lines).toEqual([`[kun-gui] createThread created a thread after ${40 + NEW_TASK_SLOW_LOG_MS}ms ` +
      `(settings 40ms, reuse-lookup ${NEW_TASK_SLOW_LOG_MS}ms)`])
  })
})
