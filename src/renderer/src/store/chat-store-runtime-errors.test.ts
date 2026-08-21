import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import { KunRuntimeProvider } from '../agent/kun-runtime'
import {
  armBusyWatchdog,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  clearWatchedCompletionNotifications,
  clearPendingClawFeishuMirrors,
  completionNotificationDedupeKeyForWatchedThread,
  isCodeSidebarThread,
  isCodeThread,
  MAX_PENDING_CLAW_FEISHU_MIRRORS,
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
  rememberPendingClawFeishuMirror,
  takePendingClawFeishuMirror,
  turnCompleteNotificationSource,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import { clearBusyWatchdog, resetBusyRecoveryAttempts } from './chat-store-schedulers'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import { emptyDesignThreadRegistry, markDesignThread } from '../design/design-thread-registry'
import {
  WRITE_ASSISTANT_THREAD_TITLE,
  emptyWriteThreadRegistry,
  markWriteThread
} from '../write/write-thread-registry'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import {
  markSddAssistantThread,
  normalizeSddThreadRegistry
} from '../sdd/sdd-thread-registry'

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

function makeThread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-v4-pro',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/workspace/deepseek-gui',
    ...(overrides.agentSurface ? { agentSurface: overrides.agentSurface } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.relation ? { relation: overrides.relation } : {}),
    ...(overrides.parentThreadId ? { parentThreadId: overrides.parentThreadId } : {})
  }
}

describe('thread event sink runtime errors', () => {
  it('keeps detached delegate_task events from restoring parent busy after interrupt', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTool({
      itemId: 'tool_delegate_background',
      summary: 'delegate_task',
      status: 'running',
      toolKind: 'tool_call',
      createdAt: '2026-07-04T00:00:00.000Z',
      detail: JSON.stringify({
        childId: 'child-background',
        status: 'queued',
        detached: true
      }),
      meta: {
        child: {
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          childId: 'child-background',
          childLabel: '通用代理',
          childStatus: 'queued',
          childSeq: 1,
          detached: true
        }
      }
    })

    expect(getState().busy).toBe(false)
    expect(getState().blocks).toHaveLength(1)
    expect(getState().blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_delegate_background',
      status: 'running',
      meta: {
        child: {
          childId: 'child-background',
          childStatus: 'queued',
          detached: true
        }
      }
    })
  })

  it('updates detached child lifecycle cards without creating duplicates or restoring busy', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: [
        {
          kind: 'tool',
          id: 'tool_delegate_background',
          createdAt: '2026-07-04T00:00:00.000Z',
          summary: 'delegate_task',
          status: 'running',
          toolKind: 'tool_call',
          detail: JSON.stringify({
            childId: 'child-background',
            status: 'queued',
            detached: true
          }),
          meta: {
            child: {
              parentThreadId: 'thread-current',
              parentTurnId: 'turn-current',
              childId: 'child-background',
              childLabel: '通用代理',
              childStatus: 'queued',
              childSeq: 1,
              detached: true
            }
          }
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTool({
      itemId: 'child_lifecycle_child-background',
      summary: '通用代理',
      status: 'running',
      updateOnly: true,
      createdAt: '2026-07-04T00:00:02.000Z',
      toolKind: 'tool_call',
      detail: JSON.stringify({
        childId: 'child-background',
        status: 'running',
        detached: true
      }),
      meta: {
        child: {
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          childId: 'child-background',
          childLabel: '通用代理',
          childStatus: 'running',
          childSeq: 1,
          detached: true
        }
      }
    })

    expect(getState().busy).toBe(false)
    expect(getState().blocks).toHaveLength(1)
    expect(getState().blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_delegate_background',
      createdAt: '2026-07-04T00:00:00.000Z',
      status: 'running',
      detail: JSON.stringify({
        childId: 'child-background',
        status: 'running',
        detached: true
      }),
      meta: {
        child: {
          childId: 'child-background',
          childStatus: 'running',
          detached: true
        }
      }
    })
  })

  it('merges a pending running lifecycle update into a settled tool result without regressing to running', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    // The child lifecycle event races ahead of the parent tool block and is
    // parked in the pending-update repair state.
    sink.onTool({
      itemId: 'child_lifecycle_child-race',
      summary: '通用代理',
      status: 'running',
      updateOnly: true,
      createdAt: '2026-07-04T00:00:01.000Z',
      toolKind: 'tool_call',
      detail: JSON.stringify({ childId: 'child-race', status: 'running', detached: true }),
      meta: {
        child: {
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          childId: 'child-race',
          childLabel: '通用代理',
          childStatus: 'running',
          childSeq: 1,
          detached: true
        }
      }
    })

    expect(getState().blocks).toHaveLength(0)

    // The settled tool result arrives after the lifecycle event. It must win.
    sink.onTool({
      itemId: 'tool_delegate_race',
      summary: 'delegate_task',
      status: 'success',
      createdAt: '2026-07-04T00:00:02.000Z',
      toolKind: 'tool_call',
      detail: JSON.stringify({
        childId: 'child-race',
        status: 'completed',
        summary: 'Race conclusion preserved.',
        detached: true
      }),
      meta: {
        child: {
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          childId: 'child-race',
          childLabel: '通用代理',
          childStatus: 'completed',
          childSeq: 1,
          detached: true
        }
      }
    })

    expect(getState().busy).toBe(false)
    expect(getState().blocks).toHaveLength(1)
    expect(getState().blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_delegate_race',
      status: 'success',
      detail: expect.stringContaining('Race conclusion preserved.'),
      meta: {
        child: {
          childId: 'child-race',
          childStatus: 'completed',
          detached: true
        }
      }
    })
    const settled = getState().blocks[0]
    if (settled?.kind === 'tool') {
      expect(settled.detail).not.toContain('"status":"running"')
    }
  })

  it('keeps pending child lifecycle repair state isolated per thread stream', () => {
    const first = makeSinkHarness({
      activeThreadId: 'thread-first',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const second = makeSinkHarness({
      activeThreadId: 'thread-second',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const firstSink = buildThreadEventSink(first.set, first.get, { threadId: 'thread-first' })
    const secondSink = buildThreadEventSink(second.set, second.get, { threadId: 'thread-second' })

    firstSink.onTool({
      itemId: 'child_lifecycle_shared-child',
      summary: 'child completed',
      status: 'success',
      updateOnly: true,
      createdAt: '2026-07-04T00:00:02.000Z',
      toolKind: 'tool_call',
      detail: JSON.stringify({ childId: 'shared-child', status: 'completed', detached: true }),
      meta: {
        child: {
          parentThreadId: 'thread-first',
          parentTurnId: 'turn-first',
          childId: 'shared-child',
          childStatus: 'completed',
          detached: true
        }
      }
    })

    secondSink.onTool({
      itemId: 'tool_delegate_second',
      summary: 'delegate_task',
      status: 'running',
      createdAt: '2026-07-04T00:00:03.000Z',
      toolKind: 'tool_call',
      detail: JSON.stringify({ childId: 'shared-child', status: 'queued', detached: true }),
      meta: {
        child: {
          parentThreadId: 'thread-second',
          parentTurnId: 'turn-second',
          childId: 'shared-child',
          childStatus: 'queued',
          detached: true
        }
      }
    })

    expect(first.getState().blocks).toEqual([])
    expect(second.getState().blocks).toHaveLength(1)
    expect(second.getState().blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_delegate_second',
      status: 'running',
      meta: { child: { childId: 'shared-child', childStatus: 'queued' } }
    })
  })

  it('adds model request retry events as runtime status instead of a banner error', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeStatus?.({
      kind: 'model_request_retry',
      itemId: 'runtime_status_turn-current_model_retry',
      turnId: 'turn-current',
      createdAt: '2026-06-08T00:00:00.000Z',
      status: 429,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 3000
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      kind: 'system',
      id: 'runtime_status_turn-current_model_retry'
    })
    expect(systemBlocks[0].text).toContain('429')
    expect(systemBlocks[0].text).toContain('1')
    expect(systemBlocks[0].text).toContain('3')
    expect(getState().error).toBeNull()

    sink.onRuntimeStatus?.({
      kind: 'model_request_retry',
      itemId: 'runtime_status_turn-current_model_retry',
      turnId: 'turn-current',
      createdAt: '2026-06-08T00:00:01.000Z',
      attempt: 2,
      maxAttempts: 5,
      delayMs: 6000,
      retryReason: 'network',
      failureSummary: 'upstream TLS handshake failed'
    })

    const networkRetry = getState().blocks.find(
      (block) => block.id === 'runtime_status_turn-current_model_retry'
    )
    const networkRetryText = networkRetry?.kind === 'system' ? networkRetry.text : ''
    expect(networkRetryText).toContain('Model provider connection failed')
    expect(networkRetryText).toContain('2')
    expect(networkRetryText).toContain('5')
    expect(networkRetry?.kind === 'system' ? networkRetry.detail : '').toBe('upstream TLS handshake failed')
  })

  it('adds runtime error events to the timeline with details', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed',
      code: 'provider_unavailable',
      details: { token: 'secret-token' },
      severity: 'error'
    })
    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed again',
      code: 'provider_unavailable',
      severity: 'error'
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      kind: 'system',
      id: 'error-1',
      code: 'provider_unavailable',
      severity: 'error'
    })
    expect(systemBlocks[0].text).toContain('<redacted>')
    expect(systemBlocks[0].detail).not.toContain('secret-token')
  })

  it('deduplicates matching runtime error and turn failure events inside one turn', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'draw a poster' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    const message = `model request failed with status 400: ${JSON.stringify({
      error: {
        code: '400',
        message: `Not supported model ${'mimo-v2.5-pro-ultraspeed'.repeat(10)}`
      }
    })}`

    sink.onRuntimeError?.({
      itemId: 'runtime_error_turn-current',
      createdAt: '2026-06-08T00:00:00.000Z',
      message,
      code: 'http_400',
      severity: 'error'
    })
    sink.onRuntimeError?.({
      itemId: 'item_turn-current_error',
      createdAt: '2026-06-08T00:00:01.000Z',
      message,
      code: 'http_400',
      severity: 'error'
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      id: 'item_turn-current_error',
      code: 'http_400',
      severity: 'error'
    })
    expect(systemBlocks[0].detail).toContain(`Message:\n${message}`)
  })

  it('settles a model_empty_response turn with one conversation card and clears busy state', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      currentTurnId: 'turn-current',
      currentTurnUserId: 'user-current',
      blocks: [{ kind: 'user', id: 'user-current', text: 'please answer' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    const message =
      'Model provider completed without returning text, reasoning, a tool call, or generated output. ' +
      'Check provider/model availability and routing, then resend the message.'

    sink.onRuntimeError?.({
      itemId: 'runtime_error_turn-current',
      turnId: 'turn-current',
      createdAt: '2026-08-18T00:00:00.000Z',
      message,
      code: 'model_empty_response',
      details: { model: 'empty-model', providerId: 'test' },
      severity: 'error'
    })
    sink.onError(
      new Error(JSON.stringify({
        code: 'model_empty_response',
        message,
        details: { model: 'empty-model' },
        severity: 'error'
      })),
      { terminal: true, scope: 'conversation' }
    )

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().error).toBeNull()
    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      code: 'model_empty_response',
      severity: 'error'
    })
    expect(systemBlocks[0].text).toContain('without returning text, reasoning')
    expect(systemBlocks[0].detail).not.toContain('empty-model model-only-secret')
  })

  it('does not keep an aborted turn busy after interrupt', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      threads: []
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    buildThreadEventSink(set, () => state).onError(new Error('turn aborted'))

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })

  it('settles conversation-scoped terminal failures without showing the global banner', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'work toward goal' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      runtimeErrorDetail: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      watchTurnCompletion: { 'thr-1': true },
      unreadThreadIds: { 'thr-1': true },
      queuedMessages: [],
      threads: []
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    const sink = buildThreadEventSink(set, () => state)
    sink.onRuntimeError?.({
      itemId: 'runtime_error_turn-1',
      turnId: 'turn-1',
      message: 'model stream exploded',
      code: 'http_400',
      severity: 'error'
    })
    sink.onError(
      new Error(JSON.stringify({
        code: 'http_400',
        message: 'model stream exploded',
        severity: 'error'
      })),
      { terminal: true, scope: 'conversation' }
    )

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.runtimeErrorDetail).toBeNull()
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.unreadThreadIds).toEqual({})
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error',
      'system'
    ])
    expect(state.blocks[2]).toMatchObject({
      kind: 'system',
      text: 'model stream exploded',
      code: 'http_400',
      runtimeError: true
    })
  })
})
