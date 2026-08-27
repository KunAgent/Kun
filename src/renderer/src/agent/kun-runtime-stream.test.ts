import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { KunRuntimeProvider } from './kun-runtime'
import { getProvider, resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

const DEFAULT_EXECUTION_SETTINGS = {
  approvalPolicy: 'auto',
  sandboxMode: 'danger-full-access',
  approvalReviewer: 'user'
} as const

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function installDsGui(overrides: Partial<Window['kunGui']>): void {
  vi.stubGlobal('window', {
    kunGui: {
      getSettings: vi.fn(async () => settings()),
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{}' })),
      resolveKunApproval: vi.fn(async () => ({
        confirmed: true,
        response: { ok: true, status: 200, body: '{}' }
      })),
      startSse: vi.fn(async (_threadId: string, _sinceSeq: number, streamId?: string) => ({
        streamId: streamId ?? 'stream-1'
      })),
      stopSse: vi.fn(async () => true),
      ackSse: vi.fn(async () => true),
      onSseEvent: vi.fn(() => () => undefined),
      onSseEnd: vi.fn(() => () => undefined),
      onSseError: vi.fn(() => () => undefined),
      ...overrides
    }
  })
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider', () => {
  it('maps Kun SSE deltas into the thread event sink', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onConnected: vi.fn(),
      onSeq: vi.fn(() => ac.abort()),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              {
                kind: 'assistant_text_delta',
                seq: 3,
                item: {
                  id: 'item_text',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'running',
                  createdAt: 't1',
                  kind: 'assistant_text',
                  text: 'he'
                }
              }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 2, sink, ac.signal)
    expect(sink.onConnected).toHaveBeenCalledTimes(1)
    expect(sink.onSeq).toHaveBeenCalledWith(3)
    expect(sink.onDeltas).toHaveBeenCalledWith([{
      text: 'he',
      kind: 'agent_message',
      seq: 3,
      threadId: 'thr_1',
      turnId: 'turn_1',
      itemId: 'item_text',
      createdAt: 't1'
    }])
  })

  it('projects replay before synchronization and same-batch live events after it', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    const ac = new AbortController()
    const order: string[] = []
    const sink: ThreadEventSink = {
      onSeq: vi.fn((seq) => order.push(`seq:${seq}`)),
      onReplaySynchronized: vi.fn((cursor) => order.push(`sync:${cursor}`)),
      onDeltas: vi.fn((deltas: Parameters<ThreadEventSink['onDeltas']>[0]) =>
        order.push(`delta:${deltas.map((delta) => delta.text).join('')}`)),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse: vi.fn(async () => {
        order.push('ack')
        ac.abort()
        return true
      }),
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => onData?.({
          streamId: streamId ?? 'stream-1',
          batchId: 'sync-batch',
          events: [
            {
              kind: 'assistant_text_delta',
              seq: 201,
              item: {
                id: 'item_text', turnId: 'turn_1', threadId: 'thr_1',
                role: 'assistant', status: 'running', kind: 'assistant_text', text: 'replay'
              }
            },
            { kind: 'replay_synchronized', threadId: 'thr_1', cursor: 201 },
            {
              kind: 'assistant_text_delta',
              seq: 202,
              item: {
                id: 'item_text', turnId: 'turn_1', threadId: 'thr_1',
                role: 'assistant', status: 'running', kind: 'assistant_text', text: 'live'
              }
            }
          ]
        }))
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 200, sink, ac.signal)

    expect(order).toEqual([
      'delta:replay',
      'seq:201',
      'sync:201',
      'delta:live',
      'seq:202',
      'ack'
    ])
  })

  it('gates stale non-delta events and their side effects at the subscription high-water mark', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(() => ac.abort()),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onThreadUpdated: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn(),
      onChildRuntimeEvent: vi.fn(),
      onGraphEvent: vi.fn()
    }
    installDsGui({
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              {
                kind: 'item_updated',
                seq: 199,
                item: {
                  id: 'item_tool',
                  callId: 'call_1',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'running',
                  kind: 'tool_call',
                  toolName: 'read_file',
                  arguments: { path: 'old.txt' }
                }
              },
              { kind: 'approval_requested', seq: 200, approvalId: 'stale-approval' },
              { kind: 'graph_event', seq: 150, graph: { kind: 'stale-graph' } },
              {
                kind: 'turn_started',
                seq: 180,
                child: {
                  parentThreadId: 'thr_1',
                  parentTurnId: 'turn_1',
                  childId: 'child_1',
                  childStatus: 'running',
                  childSeq: 1
                }
              },
              {
                kind: 'item_completed',
                seq: 201,
                item: {
                  id: 'item_result',
                  callId: 'call_1',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'completed',
                  kind: 'tool_result',
                  toolName: 'read_file',
                  output: 'fresh result'
                }
              },
              // A duplicate persisted identity in the same batch is ignored.
              {
                kind: 'item_updated',
                seq: 201,
                item: {
                  id: 'item_tool',
                  callId: 'call_1',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'running',
                  kind: 'tool_call',
                  toolName: 'read_file',
                  arguments: { path: 'old.txt' }
                }
              },
              // Legacy unsequenced events remain compatible but never move the cursor.
              { kind: 'thread_updated', threadId: 'thr_1', title: 'Legacy title' },
              { kind: 'turn_completed', seq: 202, threadId: 'thr_1', turnId: 'turn_1' }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 200, sink, ac.signal)

    expect(sink.onTool).toHaveBeenCalledTimes(1)
    expect(sink.onTool).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'tool_call_1',
      status: 'success'
    }))
    expect(sink.onApproval).not.toHaveBeenCalled()
    expect(sink.onGraphEvent).not.toHaveBeenCalled()
    expect(sink.onChildRuntimeEvent).not.toHaveBeenCalled()
    expect(sink.onThreadUpdated).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Legacy title'
    }))
    expect(sink.onTurnComplete).toHaveBeenCalledOnce()
    expect(sink.onSeq).toHaveBeenCalledOnce()
    expect(sink.onSeq).toHaveBeenCalledWith(202)
  })

  it('acknowledges a stale-only replay batch without moving the renderer cursor', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    const ac = new AbortController()
    const ackSse = vi.fn(async (_streamId: string, batchId: string) => {
      if (batchId === 'fresh-batch') ac.abort()
      return true
    })
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onThreadUpdated: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            batchId: 'stale-batch',
            events: [{ kind: 'thread_updated', seq: 200, threadId: 'thr_1', title: 'stale' }]
          })
          onData?.({
            streamId: streamId ?? 'stream-1',
            batchId: 'fresh-batch',
            events: [{ kind: 'thread_updated', seq: 201, threadId: 'thr_1', title: 'fresh' }]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 200, sink, ac.signal)

    expect(ackSse).toHaveBeenNthCalledWith(1, expect.any(String), 'stale-batch')
    expect(ackSse).toHaveBeenNthCalledWith(2, expect.any(String), 'fresh-batch')
    expect(sink.onThreadUpdated).toHaveBeenCalledOnce()
    expect(sink.onThreadUpdated).toHaveBeenCalledWith(expect.objectContaining({ title: 'fresh' }))
    expect(sink.onSeq).toHaveBeenCalledOnce()
    expect(sink.onSeq).toHaveBeenCalledWith(201)
  })

  it('treats a stale heartbeat as liveness without replaying stale lifecycle state', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    const ac = new AbortController()
    const ackSse = vi.fn(async () => {
      ac.abort()
      return true
    })
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onThreadUpdated: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => onData?.({
          streamId: streamId ?? 'stream-1',
          batchId: 'heartbeat-batch',
          events: [
            { kind: 'thread_updated', seq: 200, threadId: 'thr_1', title: 'stale' },
            { kind: 'heartbeat', seq: 200, threadId: 'thr_1' }
          ]
        }))
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 200, sink, ac.signal)

    expect(sink.onThreadUpdated).not.toHaveBeenCalled()
    expect(sink.onSeq).toHaveBeenCalledOnce()
    expect(sink.onSeq).toHaveBeenCalledWith(200)
    expect(ackSse).toHaveBeenCalledWith(expect.any(String), 'heartbeat-batch')
  })

  it('replays an unacknowledged batch after projection fails without losing its event', async () => {
    const replayedEvent = {
      kind: 'item_completed',
      seq: 201,
      item: {
        id: 'item_result',
        callId: 'call_retry',
        turnId: 'turn_1',
        threadId: 'thr_1',
        role: 'tool',
        status: 'completed',
        kind: 'tool_result',
        toolName: 'read_file',
        output: 'durable result'
      }
    }
    const firstAck = vi.fn(async () => true)
    const firstSeq = vi.fn()
    const firstError = vi.fn()
    let firstOnData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    installDsGui({
      ackSse: firstAck,
      onSseEvent: vi.fn((handler) => {
        firstOnData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => firstOnData?.({
          streamId: streamId ?? 'stream-1',
          batchId: 'failed-batch',
          events: [replayedEvent]
        }))
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const throwingSink: ThreadEventSink = {
      onSeq: firstSeq,
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(() => {
        throw new Error('projection failed')
      }),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: firstError
    }

    await new KunRuntimeProvider().subscribeThreadEvents(
      'thr_1',
      200,
      throwingSink,
      new AbortController().signal
    )

    expect(firstError).toHaveBeenCalledWith(expect.objectContaining({ message: 'projection failed' }))
    expect(firstSeq).not.toHaveBeenCalled()
    expect(firstAck).not.toHaveBeenCalled()

    // Recovery opens a new stream from the last committed renderer cursor.
    // The runtime replays the failed batch and it must project normally.
    const replayAbort = new AbortController()
    const replayTool = vi.fn()
    let replayOnData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    installDsGui({
      onSseEvent: vi.fn((handler) => {
        replayOnData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, sinceSeq, streamId) => {
        expect(sinceSeq).toBe(200)
        queueMicrotask(() => replayOnData?.({
          streamId: streamId ?? 'stream-2',
          events: [replayedEvent]
        }))
        return { streamId: streamId ?? 'stream-2' }
      })
    })
    const replaySink: ThreadEventSink = {
      onSeq: vi.fn(() => replayAbort.abort()),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: replayTool,
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 200, replaySink, replayAbort.signal)

    expect(replayTool).toHaveBeenCalledOnce()
    expect(replayTool).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'tool_call_retry',
      status: 'success'
    }))
    expect(replaySink.onSeq).toHaveBeenCalledWith(201)
  })

})
