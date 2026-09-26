import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ToolEventPayload } from '../agent/types'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { buildThreadEventSink } from './chat-store-runtime'
import { createThreadQueueActions } from './chat-store-thread-queue-actions'
import { settleRuntimeTurnAdmission, waitForRuntimeTurnAdmission } from './chat-store-thread-actions-support'
import { clearBusyWatchdog, stopTurnCompletionPoll } from './chat-store-schedulers'

afterEach(() => {
  settleRuntimeTurnAdmission('batch-admission', false)
  clearBusyWatchdog()
  stopTurnCompletionPoll()
  vi.unstubAllGlobals()
})

function makeSinkHarness(overrides: Partial<ChatState> = {}): {
  getState: () => ChatState
  set: ChatStoreSet
  get: () => ChatState
} {
  let state = {
    activeThreadId: 'thread-current',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    liveDeltaSeqFloor: 0,
    lastSeq: 0,
    usageRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-current',
    currentTurnUserId: 'user-current',
    turnStartedAtByUserId: { 'user-current': 1000 },
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: [],
    refreshThreads: vi.fn(async () => undefined),
    drainQueuedMessages: vi.fn(async () => undefined)
  } as unknown as ChatState
  state = { ...state, ...overrides }
  const get = (): ChatState => state
  const set: ChatStoreSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  return {
    getState: () => state,
    set,
    get
  }
}

describe('thread event batch integration', () => {
  it('queues lifecycle-before-wrapper updates by parent turn without rewriting history', async () => {
    const historical: ChatBlock = {
      kind: 'tool',
      id: 'tool-old',
      turnId: 'turn-old',
      summary: 'ppt_agent',
      status: 'success',
      detail: JSON.stringify({ childId: 'child-ppt', status: 'completed', resumeCount: 0 }),
      meta: {
        toolName: 'ppt_agent',
        child: {
          parentThreadId: 'thread-current', parentTurnId: 'turn-old', childId: 'child-ppt',
          childStatus: 'completed', childSeq: 1, resumeCount: 0
        }
      }
    }
    const { getState, set, get } = makeSinkHarness({
      blocks: [historical],
      currentTurnId: 'turn-resume'
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    await sink.runEventBatch!(async () => {
      sink.onTool({
        itemId: 'child_lifecycle_child-ppt',
        turnId: 'turn-resume',
        summary: 'ppt_agent',
        status: 'running',
        updateOnly: true,
        detail: JSON.stringify({ childId: 'child-ppt', status: 'running', resumeCount: 1 }),
        meta: {
          toolName: 'ppt_agent',
          child: {
            parentThreadId: 'thread-current', parentTurnId: 'turn-resume', childId: 'child-ppt',
            childStatus: 'running', childSeq: 1, resumeCount: 1
          }
        }
      })
    })
    expect(getState().blocks).toEqual([historical])

    await sink.runEventBatch!(async () => {
      sink.onTool({
        itemId: 'tool-resume',
        turnId: 'turn-resume',
        summary: 'ppt_agent',
        status: 'running',
        detail: JSON.stringify({ childId: 'child-ppt', status: 'queued', resumeCount: 1 }),
        meta: {
          toolName: 'ppt_agent',
          child: {
            parentThreadId: 'thread-current', parentTurnId: 'turn-resume', childId: 'child-ppt',
            childStatus: 'queued', childSeq: 1, resumeCount: 1
          }
        }
      })
    })
    expect(getState().blocks).toHaveLength(2)
    expect(getState().blocks[0]).toEqual(historical)
    expect(getState().blocks[1]).toMatchObject({
      kind: 'tool', id: 'tool-resume', turnId: 'turn-resume', status: 'running',
      meta: { child: { parentTurnId: 'turn-resume', childStatus: 'running', resumeCount: 1 } }
    })
  })

  it('applies a child update to a wrapper committed by another sink mid-batch', async () => {
    const { get, set } = makeSinkHarness()
    const first = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    const second = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    const child = {
      parentThreadId: 'thread-current', parentTurnId: 'turn-current',
      childId: 'child-ppt', childStatus: 'queued', childSeq: 1
    }
    const event: ToolEventPayload = {
      itemId: 'tool-child', turnId: 'turn-current', summary: 'ppt_agent', status: 'running',
      meta: { toolName: 'ppt_agent', child }
    }
    await first.runEventBatch!(async () => {
      first.onSeq(1)
      second.onTool(event)
      first.onTool({
        ...event, itemId: 'child_lifecycle_child-ppt', updateOnly: true, status: 'success',
        meta: { toolName: 'ppt_agent', child: { ...child, childStatus: 'completed', childSeq: 2 } }
      })
    })
    expect(get().blocks).toMatchObject([{
      id: 'tool-child', status: 'success', meta: { child: { childStatus: 'completed' } }
    }])
  })

  it.each(['completed', 'aborted', 'failed'] as const)(
    'drains pending admission after a batched %s event commits',
    async (status) => {
      vi.stubGlobal('window', { kunGui: {} })
      const sendMessage = vi.fn(async () => false)
      void waitForRuntimeTurnAdmission('batch-admission')
      const { get, set } = makeSinkHarness({
        queuedMessages: [{
          id: 'local-q', text: 'next', deliveryState: 'pending',
          clientRequestId: 'batch-admission', waitForRuntimeAdmission: true
        }],
        sendMessage
      })
      const actions = createThreadQueueActions(
        { set, get, sseAbortRef: { current: null } } as never,
        { persistActiveQueuedMessages: vi.fn() } as never
      )
      set({ drainQueuedMessages: actions.drainQueuedMessages })
      const sink = buildThreadEventSink(set, get, {
        threadId: 'thread-current',
        getThreadDetail: async () => ({ blocks: [], latestSeq: 0 })
      })

      await sink.runEventBatch!(async () => {
        if (status === 'failed') {
          sink.onError(new Error('turn failed'), { terminal: true, turnId: 'turn-current' })
        } else {
          sink.onTurnComplete({ status, turnId: 'turn-current' })
        }
        expect(sendMessage).not.toHaveBeenCalled()
      })

      expect(get().busy).toBe(false)
      expect(sendMessage).toHaveBeenCalledOnce()
    }
  )

  it('does not drain another conversation when selection changes before commit', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    const drainQueuedMessages = vi.fn(async () => undefined)
    const { get, set } = makeSinkHarness({ drainQueuedMessages })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      getThreadDetail: async () => ({ blocks: [], latestSeq: 0 })
    })
    await sink.runEventBatch!(async () => {
      sink.onTurnComplete({ status: 'completed', threadId: 'thread-current', turnId: 'turn-current' })
      set({ activeThreadId: 'thread-other' })
    })
    expect(drainQueuedMessages).not.toHaveBeenCalled()
  })
})
