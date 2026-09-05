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

describe('busy watchdog re-arming on live ticks (#goal-recovering-banner)', () => {
  const BUSY_WATCHDOG_MS = 180_000

  beforeEach(() => {
    vi.useFakeTimers()
    resetBusyRecoveryAttempts()
  })
  afterEach(() => {
    clearBusyWatchdog()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps a long, quiet-but-healthy turn alive: heartbeats (onSeq) postpone recovery', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: true, recoverActiveTurn })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    // Turn starts → watchdog armed (mirrors onUserMessage).
    armBusyWatchdog(set, get)

    // 10 minutes of nothing but the runtime's 15s heartbeat — e.g. one long
    // tool call producing no output. Each heartbeat ticks onSeq.
    for (let elapsed = 0; elapsed < 600_000; elapsed += 15_000) {
      vi.advanceTimersByTime(15_000)
      sink.onSeq(1)
    }

    // Stream is healthy the whole time, so the "正在恢复…" recovery never fires.
    expect(recoverActiveTurn).not.toHaveBeenCalled()
  })

  it('keeps the watchdog alive when the provider receives stale-cursor heartbeats', async () => {
    let onData: (payload: {
      streamId: string
      events: unknown[]
      batchId?: string
    }) => void = () => undefined
    let activeStreamId = ''
    const ackSse = vi.fn(async () => true)
    vi.stubGlobal('window', {
      kunGui: {
        onSseEvent: vi.fn((handler) => {
          onData = handler
          return () => undefined
        }),
        onSseEnd: vi.fn(() => () => undefined),
        onSseError: vi.fn(() => () => undefined),
        onSseOpen: vi.fn(() => () => undefined),
        startSse: vi.fn(async (_threadId: string, _sinceSeq: number, streamId: string) => {
          activeStreamId = streamId
          return { streamId }
        }),
        stopSse: vi.fn(async () => true),
        ackSse
      } as unknown as Window['kunGui']
    })
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({
      busy: true,
      lastSeq: 200,
      recoverActiveTurn
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 200
    })
    const controller = new AbortController()
    const subscription = new KunRuntimeProvider().subscribeThreadEvents(
      'thread-current',
      200,
      sink,
      controller.signal
    )
    armBusyWatchdog(set, get)

    for (let index = 0; index < 4; index += 1) {
      vi.advanceTimersByTime(120_000)
      onData({
        streamId: activeStreamId,
        events: [{ kind: 'heartbeat', seq: 200, threadId: 'thread-current' }],
        batchId: `heartbeat-${index}`
      })
      // Drain the ordered projection and acknowledgement chain.
      for (let turn = 0; turn < 6; turn += 1) await Promise.resolve()
    }

    expect(ackSse).toHaveBeenCalledTimes(4)
    expect(recoverActiveTurn).not.toHaveBeenCalled()
    controller.abort()
    await subscription
  })

  it('still recovers when the stream genuinely stalls (no ticks for the full window)', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: true, recoverActiveTurn })
    buildThreadEventSink(set, get, { threadId: 'thread-current' })

    armBusyWatchdog(set, get)
    vi.advanceTimersByTime(BUSY_WATCHDOG_MS)

    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
  })

  it('does not keep a watchdog alive for an idle (non-busy) thread on heartbeats', () => {
    const recoverActiveTurn = vi.fn().mockResolvedValue(true)
    const { set, get } = makeSinkHarness({ busy: false, recoverActiveTurn })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    armBusyWatchdog(set, get)
    sink.onSeq(1) // heartbeat on an idle thread must not re-arm

    vi.advanceTimersByTime(BUSY_WATCHDOG_MS)
    // Watchdog fires once, sees busy=false, and bails without recovery.
    expect(recoverActiveTurn).not.toHaveBeenCalled()
  })
})
