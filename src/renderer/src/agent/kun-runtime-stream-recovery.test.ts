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
      onSseOpen: vi.fn(() => () => undefined),
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
  it('preserves a fatal SSE status for stream recovery', async () => {
    let onSseError: ((payload: { streamId: string; message?: string; status?: number }) => void) | null = null
    const onError = vi.fn()
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
      onTurnComplete: vi.fn(),
      onError
    }
    installDsGui({
      onSseError: vi.fn((handler) => {
        onSseError = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => onSseError?.({
          streamId: streamId ?? 'stream-1',
          message: 'stream route unavailable',
          status: 404
        }))
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 0, sink, new AbortController().signal)

    const [error] = onError.mock.calls[0] ?? []
    expect(error).toMatchObject({
      name: 'KunSseSubscriptionError',
      message: 'stream route unavailable',
      status: 404
    })
  })

  it('preserves replay reset metadata for projection recovery', async () => {
    let onSseError: ((payload: {
      streamId: string
      message?: string
      code?: 'replay_reset_required'
      threadId?: string
      floorSeq?: number
    }) => void) | null = null
    const onError = vi.fn()
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
      onTurnComplete: vi.fn(),
      onError
    }
    installDsGui({
      onSseError: vi.fn((handler) => {
        onSseError = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => onSseError?.({
          streamId: streamId ?? 'stream-1',
          message: 'reload snapshot',
          code: 'replay_reset_required',
          threadId: 'thr_1',
          floorSeq: 80
        }))
        return { streamId: streamId ?? 'stream-1' }
      })
    })

    await new KunRuntimeProvider().subscribeThreadEvents('thr_1', 7, sink, new AbortController().signal)

    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      name: 'KunSseSubscriptionError',
      code: 'replay_reset_required',
      threadId: 'thr_1',
      floorSeq: 80
    })
  })

  it('advances the renderer cursor after dispatch and only then acknowledges the SSE batch', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    let releaseAck: (() => void) | undefined
    const ackGate = new Promise<void>((resolve) => {
      releaseAck = resolve
    })
    const ackSse = vi.fn(async () => {
      await ackGate
      return true
    })
    const startSse = vi.fn(async (_threadId: string, _sinceSeq: number, streamId?: string) => {
      queueMicrotask(() => {
        onData?.({
          streamId: streamId ?? 'stream-1',
          batchId: 'batch_1',
          events: [{ kind: 'assistant_text_delta', seq: 4, item: {
            id: 'item_text', turnId: 'turn_1', threadId: 'thr_1', role: 'assistant',
            status: 'running', createdAt: 't1', kind: 'assistant_text', text: 'ack me'
          } }]
        })
      })
      return { streamId: streamId ?? 'stream-1' }
    })
    const ac = new AbortController()
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
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse
    })
    const provider = new KunRuntimeProvider()
    const subscription = provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)

    await vi.waitFor(() => expect(sink.onDeltas).toHaveBeenCalledTimes(1))
    expect(ackSse).toHaveBeenCalledWith(expect.any(String), 'batch_1')
    expect(startSse).toHaveBeenCalledWith(
      'thr_1',
      0,
      expect.any(String),
      { acknowledgedBatches: true }
    )
    expect(sink.onSeq).toHaveBeenCalledWith(4)

    releaseAck?.()
    await Promise.resolve()
    ac.abort()
    await subscription
  })

  it('does not acknowledge or advance an SSE batch aborted during dispatch', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    const ackSse = vi.fn(async () => true)
    const stopSse = vi.fn(async () => true)
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(() => ac.abort()),
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
      ackSse,
      stopSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            batchId: 'batch_abort',
            events: [{ kind: 'assistant_text_delta', seq: 5, item: {
              id: 'item_text', turnId: 'turn_1', threadId: 'thr_1', role: 'assistant',
              status: 'running', createdAt: 't1', kind: 'assistant_text', text: 'abort me'
            } }]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()

    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)

    expect(ackSse).not.toHaveBeenCalled()
    expect(sink.onSeq).not.toHaveBeenCalled()
    expect(stopSse).toHaveBeenCalled()
  })

  it('treats legacy approval requests without a reviewer as manual even when current settings are full access', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const resolveKunApproval = vi.fn(async () => ({
      confirmed: true as const,
      response: { ok: true, status: 200, body: '{}' }
    }))
    const ac = new AbortController()
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
      onTurnComplete: vi.fn(() => ac.abort()),
      onError: vi.fn()
    }
    installDsGui({
      runtimeRequest,
      resolveKunApproval,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              { kind: 'approval_requested', seq: 4, approvalId: 'appr_auto', summary: 'Need approval' },
              { kind: 'turn_completed', seq: 5 }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
    expect(resolveKunApproval).not.toHaveBeenCalled()
    expect(sink.onApproval).toHaveBeenCalledWith({
      approvalId: 'appr_auto',
      summary: 'Need approval',
      turnId: undefined,
      createdAt: undefined,
      toolName: undefined
    })
  })

  it('keeps explicit agent-reviewed requests out of the manual approval surface', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const resolveKunApproval = vi.fn(async () => ({
      confirmed: true as const,
      response: { ok: true, status: 200, body: '{}' }
    }))
    const getSettings = vi.fn(async (): Promise<AppSettingsV1> => ({
      ...settings(),
      agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: 'on-request' } }
    }))
    const ac = new AbortController()
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
      onTurnComplete: vi.fn(() => ac.abort()),
      onError: vi.fn()
    }
    installDsGui({
      getSettings,
      runtimeRequest,
      resolveKunApproval,
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
                kind: 'approval_requested',
                seq: 4,
                approvalId: 'appr_event_auto',
                approvalPolicy: 'auto',
                approvalReviewer: 'agent',
                summary: 'Need approval'
              },
              { kind: 'turn_completed', seq: 5 }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
    expect(resolveKunApproval).not.toHaveBeenCalled()
    expect(getSettings).not.toHaveBeenCalled()
    expect(sink.onApproval).not.toHaveBeenCalled()
  })

  it('renders approval cards for suggest and untrusted policies', async () => {
    for (const policy of ['suggest', 'untrusted'] as const) {
      let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
      const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
      const resolveKunApproval = vi.fn(async () => ({
        confirmed: true as const,
        response: { ok: true, status: 200, body: '{}' }
      }))
      const ac = new AbortController()
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
        onTurnComplete: vi.fn(() => ac.abort()),
        onError: vi.fn()
      }
      const policySettings: AppSettingsV1 = {
        ...settings(),
        agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: policy } }
      }
      installDsGui({
        getSettings: vi.fn(async () => policySettings),
        runtimeRequest,
        resolveKunApproval,
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
                  kind: 'approval_requested',
                  seq: 6,
                  approvalId: `appr_${policy}`,
                  summary: `${policy} approval`
                },
                { kind: 'turn_completed', seq: 7 }
              ]
            })
          })
          return { streamId: streamId ?? 'stream-1' }
        })
      })
      const provider = new KunRuntimeProvider()
      await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
      expect(sink.onApproval).toHaveBeenCalledWith({
        approvalId: `appr_${policy}`,
        summary: `${policy} approval`,
        toolName: undefined
      })
      expect(resolveKunApproval).not.toHaveBeenCalled()
    }
  })
})

describe('registry', () => {
  it('returns a cached provider for the kun id', () => {
    resetProviderCacheForTests()
    const first = getProvider()
    const second = getProvider()
    expect(first).toBe(second)
  })

})
