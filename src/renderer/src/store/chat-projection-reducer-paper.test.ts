import { describe, expect, it } from 'vitest'
import type { RuntimeProjectionAction } from '../agent/runtime-projection-actions'
import type { ChatState } from './chat-store-types'
import { reduceChatProjection } from './chat-projection-reducer'

const NOW = Date.parse('2026-07-11T00:00:00.000Z')
const context = {
  now: NOW,
  clearRecoveringError: (error: string | null) => (error === 'recovering' ? null : error),
  goalTimelineText: () => 'Goal',
  runtimeStatusText: () => 'Runtime status',
  runtimeErrorView: (event: { message: string; code?: string }) => ({
    summary: `Summary: ${event.message}`,
    message: event.message,
    ...(event.code ? { code: event.code } : {})
  }),
  upsertRuntimeError: (blocks: ChatState['blocks'], block: ChatState['blocks'][number]) => [...blocks, block],
  formatRuntimeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  runtimeErrorDetail: () => '',
  isInterruptSettledError: () => false,
  settlePendingRuntimeWork: (blocks: ChatState['blocks']) => blocks,
  threadSnapshotLooksRunning: () => false
}

function state(): ChatState {
  return {
    activeThreadId: 'thread_1',
    blocks: [],
    liveReasoning: '',
    liveAssistant: '',
    threads: [
      { id: 'thread_1', title: 'Thread', updatedAt: '2026-07-10T00:00:00.000Z', model: 'model', mode: 'agent' }
    ],
    usageRefreshKey: 0,
    error: null
  } as unknown as ChatState
}

function project(initial: ChatState, actions: RuntimeProjectionAction[]): ChatState {
  return actions.reduce(
    (current, action) => ({ ...current, ...reduceChatProjection(current, action, context) }),
    initial
  )
}

const LIST_META = {
  version: 1,
  title: 'Recommended papers',
  papers: [
    { id: '10.1/x', title: 'Paper X', reason: 'Why X', verified: true },
    { id: '10.1/y', title: 'Paper Y', reason: 'Why Y', verified: false }
  ]
}

describe('paper-list projection (P1.3)', () => {
  it('replaces the running tool block with a paper-list block when meta.paperList arrives', () => {
    const initial = {
      ...state(),
      busy: true,
      blocks: [
        { kind: 'tool' as const, id: 'tool_call_1', turnId: 'turn_1', summary: 'paper_report', status: 'running' as const }
      ]
    }
    const projected = project(initial, [
      {
        type: 'tool_updated',
        payload: {
          itemId: 'tool_call_1',
          turnId: 'turn_1',
          createdAt: '2026-07-11T00:00:01.000Z',
          summary: 'paper_report',
          status: 'success',
          toolKind: 'tool_call',
          meta: { toolName: 'paper_report', paperList: LIST_META }
        }
      }
    ])
    expect(projected.blocks).toHaveLength(1)
    expect(projected.blocks[0]).toMatchObject({
      kind: 'paper-list',
      id: 'tool_call_1',
      turnId: 'turn_1',
      list: { title: 'Recommended papers' }
    })
  })

  it('keeps malformed paperList payloads as plain tool blocks', () => {
    const projected = project(state(), [
      {
        type: 'tool_updated',
        payload: {
          itemId: 'tool_call_9',
          turnId: 'turn_1',
          createdAt: '2026-07-11T00:00:01.000Z',
          summary: 'paper_report',
          status: 'success',
          toolKind: 'tool_call',
          meta: { toolName: 'paper_report', paperList: { version: 99 } }
        }
      }
    ])
    expect(projected.blocks[0]).toMatchObject({ kind: 'tool', id: 'tool_call_9' })
  })

  it('stores paperSearch meta on the tool block without converting it', () => {
    const projected = project(state(), [
      {
        type: 'tool_updated',
        payload: {
          itemId: 'tool_call_2',
          turnId: 'turn_1',
          createdAt: '2026-07-11T00:00:02.000Z',
          summary: 'paper_search',
          status: 'success',
          toolKind: 'tool_call',
          meta: {
            toolName: 'paper_search',
            paperSearch: { version: 1, query: 'q', total: 0, papers: [], sources: [] }
          }
        }
      }
    ])
    expect(projected.blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_call_2',
      meta: { paperSearch: { query: 'q' } }
    })
  })
})
