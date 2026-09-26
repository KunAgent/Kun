import { describe, expect, it } from 'vitest'
import {
  chatBlockFromItem,
  runtimeProjectionActionsFromEvent
} from './kun-mapper'
import type { CoreRuntimeEventJson, CoreTurnItemJson } from './kun-contract'
import type { RuntimeProjectionAction } from './runtime-projection-actions'
import type { ChatState } from '../store/chat-store-types'
import { reduceChatProjection } from '../store/chat-projection-reducer'

const NOW = Date.parse('2026-09-14T00:00:00.000Z')

const reducerContext = {
  now: NOW,
  clearRecoveringError: (error: string | null) => error === 'recovering' ? null : error,
  goalTimelineText: (goal: ChatState['activeThreadGoal'], cleared?: boolean) =>
    cleared || !goal ? 'Goal cleared' : `Goal ${goal.status}: ${goal.objective}`,
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: `Summary: ${event.message}`,
    message: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => {
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    if (index < 0) return [...blocks, block]
    const next = [...blocks]
    next[index] = block
    return next
  },
  formatRuntimeError: (error: unknown) => error instanceof Error ? error.message : String(error),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function contextWindowItem(overrides: Partial<CoreTurnItemJson> = {}): CoreTurnItemJson {
  return {
    id: 'cw_1',
    turnId: 'turn_1',
    threadId: 'thread_1',
    role: 'system',
    status: 'completed',
    createdAt: '2026-09-14T00:00:00.000Z',
    kind: 'context_window',
    windowId: 'window-2',
    previousWindowId: 'window-1',
    reason: 'model',
    replacedTokens: 42000,
    ...overrides
  }
}

function reducerState(blocks: ChatState['blocks'] = []): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks,
    currentTurnId: 'turn_1',
    error: 'recovering'
  } as unknown as ChatState
}

function project(initial: ChatState, actions: RuntimeProjectionAction[]): ChatState {
  return actions.reduce(
    (current, action) => ({
      ...current,
      ...reduceChatProjection(current, action, reducerContext)
    }),
    initial
  )
}

describe('context window timeline projection', () => {
  it('maps a context_window turn item to a window variant compaction block', () => {
    const block = chatBlockFromItem(contextWindowItem())

    expect(block).toMatchObject({
      kind: 'compaction',
      id: 'cw_1',
      turnId: 'turn_1',
      variant: 'window',
      status: 'success',
      summary: '',
      messagesBefore: 42000
    })
  })

  it('maps a context_window runtime event to one committed compaction action', () => {
    const event: CoreRuntimeEventJson = {
      kind: 'context_window',
      seq: 9,
      threadId: 'thread_1',
      turnId: 'turn_1',
      timestamp: '2026-09-14T00:00:01.000Z',
      item: contextWindowItem()
    }

    const actions = runtimeProjectionActionsFromEvent(event)

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      type: 'compaction_updated',
      seq: 9,
      payload: {
        itemId: 'cw_1',
        turnId: 'turn_1',
        status: 'success',
        variant: 'window',
        createdAt: '2026-09-14T00:00:01.000Z',
        messagesBefore: 42000
      }
    })
  })

  it('keeps manual compaction items on the summary rendering path', () => {
    const block = chatBlockFromItem({
      id: 'compaction_1',
      turnId: 'turn_1',
      threadId: 'thread_1',
      role: 'system',
      status: 'completed',
      createdAt: '2026-09-14T00:00:00.000Z',
      kind: 'compaction',
      summary: 'Worked on the parser',
      auto: false,
      replacedTokens: 1000
    })

    expect(block).toMatchObject({
      kind: 'compaction',
      id: 'compaction_1',
      variant: 'summary',
      summary: 'Worked on the parser',
      auto: false
    })
  })

  it('dedupes a replayed window marker and keeps surrounding messages', () => {
    const userBlock = {
      kind: 'user' as const,
      id: 'user_1',
      turnId: 'turn_1',
      createdAt: '2026-09-14T00:00:00.000Z',
      text: 'please continue'
    }
    const event: CoreRuntimeEventJson = {
      kind: 'context_window',
      seq: 9,
      threadId: 'thread_1',
      turnId: 'turn_1',
      timestamp: '2026-09-14T00:00:01.000Z',
      item: contextWindowItem()
    }
    // Simulate live delivery followed by an SSE reconnect replaying the same
    // committed checkpoint event.
    const actions = [
      ...runtimeProjectionActionsFromEvent(event),
      ...runtimeProjectionActionsFromEvent(event)
    ]

    const projected = project(reducerState([userBlock]), actions)
    const markers = projected.blocks.filter(
      (block) => block.kind === 'compaction' && block.variant === 'window'
    )

    expect(markers).toHaveLength(1)
    expect(projected.blocks).toContainEqual(userBlock)
    expect(projected.blocks.findIndex((block) => block.id === 'user_1'))
      .toBeLessThan(projected.blocks.findIndex((block) => block.id === 'cw_1'))
  })
})
