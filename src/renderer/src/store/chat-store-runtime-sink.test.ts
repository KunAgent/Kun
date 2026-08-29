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
import { LIVE_OFFICE_PREVIEW_EVENT } from '../lib/live-office-preview'
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

describe('thread event sink binding', () => {
  it('marks a resolved approval as expired so it cannot be submitted again', () => {
    const approval: ChatBlock = {
      kind: 'approval',
      id: 'approval-appr_1',
      approvalId: 'appr_1',
      summary: 'Run shell command',
      status: 'pending'
    }
    const { getState, set, get } = makeSinkHarness({ blocks: [approval] })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onApprovalStatus?.({
      approvalId: 'appr_1',
      status: 'expired',
      errorMessage: 'turn aborted while awaiting approval'
    })

    expect(getState().blocks[0]).toMatchObject({
      kind: 'approval',
      approvalId: 'appr_1',
      status: 'expired',
      errorMessage: 'turn aborted while awaiting approval'
    })
  })

  it('ignores reasoning deltas from a stream bound to a different active thread', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-new' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-old',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'old reasoning', seq: 7 }])

    expect(getState().liveReasoning).toBe('')
    expect(getState().lastSeq).toBe(0)
  })

  it('ignores queued callbacks after a stream has been aborted', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      liveReasoning: 'current reasoning'
    })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    controller.abort()
    sink.onDeltas([{ kind: 'agent_reasoning', text: 'late old reasoning', seq: 8 }])
    sink.onTurnComplete()

    expect(getState().liveReasoning).toBe('current reasoning')
    expect(getState().blocks).toEqual([])
    expect(getState().busy).toBe(true)
  })

  it('accepts reasoning deltas from the current active stream', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'fresh reasoning', seq: 9 }])

    expect(getState().liveReasoning).toBe('fresh reasoning')
    expect(getState().lastSeq).toBe(9)
    expect(getState().turnReasoningFirstAtByUserId['user-current']).toEqual(expect.any(Number))
  })

  it('drops replayed deltas at or below the subscription floor', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current', lastSeq: 100 })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 100
    })

    sink.onDeltas([
      { kind: 'agent_message', text: 'replayed history', seq: 90 },
      { kind: 'agent_message', text: 'fresh answer', seq: 101 }
    ])

    expect(getState().liveAssistant).toBe('fresh answer')
    expect(getState().lastSeq).toBe(101)
  })

  it('drops duplicate delta seqs across batches', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 11, itemId: 'assistant-current', turnId: 'turn-current' }])
    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 11, itemId: 'assistant-current', turnId: 'turn-current' }])
    sink.onDeltas([{ kind: 'agent_message', text: ' world', seq: 12, itemId: 'assistant-current', turnId: 'turn-current' }])

    expect(getState().liveAssistant).toBe('hello world')
  })

  it('serializes overlapping replays across concurrent sinks so live text is not duplicated', () => {
    // Repro for the design-rail duplicate-text bug: a long, flaky turn can
    // briefly leave two sinks live at once. Their per-sink floors are
    // independent, so each re-appends the same replayed deltas. The shared
    // store-level floor serializes them — each seq folds in at most once.
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      lastSeq: 100,
      liveDeltaSeqFloor: 100
    })
    const sinkA = buildThreadEventSink(set, get, { threadId: 'thread-current', sinceSeq: 100 })
    const sinkB = buildThreadEventSink(set, get, { threadId: 'thread-current', sinceSeq: 100 })

    sinkA.onDeltas([
      { kind: 'agent_message', text: 'alpha', seq: 101, itemId: 'assistant-current', turnId: 'turn-current' },
      { kind: 'agent_message', text: 'beta', seq: 102, itemId: 'assistant-current', turnId: 'turn-current' }
    ])
    // sinkB replays the very same persisted deltas. Its own closure floor is
    // back at 100, so without the shared floor it would re-append them.
    sinkB.onDeltas([
      { kind: 'agent_message', text: 'alpha', seq: 101, itemId: 'assistant-current', turnId: 'turn-current' },
      { kind: 'agent_message', text: 'beta', seq: 102, itemId: 'assistant-current', turnId: 'turn-current' }
    ])

    expect(getState().liveAssistant).toBe('alphabeta')
    expect(getState().liveDeltaSeqFloor).toBe(102)
  })

  it('re-baselining the shared floor lets a new subscription apply lower seqs', () => {
    // A thread switch resets liveDeltaSeqFloor to the new (per-thread) since_seq.
    // Because seqs are per-thread, the shared floor must not strand the new
    // thread's low seqs.
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      liveDeltaSeqFloor: 0
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current', sinceSeq: 0 })

    sink.onDeltas([
      { kind: 'agent_message', text: 'first', seq: 1, itemId: 'assistant-current', turnId: 'turn-current' },
      { kind: 'agent_message', text: ' second', seq: 2, itemId: 'assistant-current', turnId: 'turn-current' }
    ])

    expect(getState().liveAssistant).toBe('first second')
    expect(getState().liveDeltaSeqFloor).toBe(2)
  })

  it('never rewinds lastSeq when a stale heartbeat seq arrives', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current', lastSeq: 500 })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onSeq(3)

    expect(getState().lastSeq).toBe(500)
  })

  it('reconciles a completed turn from persisted detail when live assistant text was missed', async () => {
    const getThreadDetail = vi.fn(async () => ({
      blocks: [
        { kind: 'user' as const, id: 'user-current', turnId: 'turn-current', text: 'check the workspace' },
        { kind: 'assistant' as const, id: 'assistant-current', turnId: 'turn-current', text: 'Workspace is /tmp/project.' }
      ],
      latestSeq: 42,
      threadStatus: 'completed'
    }))
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      blocks: [{ kind: 'user', id: 'user-current', turnId: 'turn-current', text: 'check the workspace' }],
      liveAssistant: '',
      lastSeq: 10,
      busy: true,
      currentTurnId: 'turn-current',
      currentTurnUserId: 'user-current'
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      getThreadDetail
    })

    sink.onTurnComplete({ status: 'completed', turnId: 'turn-current' })
    await Promise.resolve()
    await Promise.resolve()

    expect(getThreadDetail).toHaveBeenCalledWith('thread-current')
    expect(getState().busy).toBe(false)
    expect(getState().lastSeq).toBe(42)
    expect(getState().blocks).toContainEqual({
      kind: 'assistant',
      id: 'assistant-current',
      turnId: 'turn-current',
      text: 'Workspace is /tmp/project.'
    })
  })

  it('reconciles a completed turn even when part of the live assistant text was already visible', async () => {
    const getThreadDetail = vi.fn(async () => ({
      blocks: [
        { kind: 'user' as const, id: 'user-current', turnId: 'turn-current', text: 'check the workspace' },
        {
          kind: 'assistant' as const,
          id: 'assistant-current',
          turnId: 'turn-current',
          createdAt: '2026-07-11T00:00:00.000Z',
          text: 'Workspace is /tmp/project and all files are healthy.'
        }
      ],
      latestSeq: 42,
      threadStatus: 'completed'
    }))
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      blocks: [{ kind: 'user', id: 'user-current', turnId: 'turn-current', text: 'check the workspace' }],
      liveAssistant: 'Workspace is /tmp',
      liveAssistantItemId: 'assistant-current',
      liveAssistantTurnId: 'turn-current',
      liveAssistantCreatedAt: '2026-07-11T00:00:00.000Z',
      lastSeq: 10,
      busy: true,
      currentTurnId: 'turn-current',
      currentTurnUserId: 'user-current'
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      getThreadDetail
    })

    sink.onTurnComplete({ status: 'completed', turnId: 'turn-current' })
    await Promise.resolve()
    await Promise.resolve()

    expect(getThreadDetail).toHaveBeenCalledWith('thread-current')
    expect(getState().blocks.filter((block) => block.kind === 'assistant')).toEqual([{
      kind: 'assistant',
      id: 'assistant-current',
      turnId: 'turn-current',
      createdAt: '2026-07-11T00:00:00.000Z',
      text: 'Workspace is /tmp/project and all files are healthy.'
    }])
    expect(getState().liveAssistant).toBe('')
  })

  it('projects a replayed duplicate completion once, including external effects', () => {
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', {
      kunGui: { showTurnCompleteNotification }
    })
    const refreshThreads = vi.fn(async () => undefined)
    const drainQueuedMessages = vi.fn(async () => undefined)
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-duplicate-completion',
      currentTurnId: 'turn-duplicate-completion',
      currentTurnUserId: 'user-duplicate-completion',
      blocks: [
        { kind: 'user', id: 'user-duplicate-completion', turnId: 'turn-duplicate-completion', text: 'hello' },
        { kind: 'assistant', id: 'assistant-duplicate-completion', turnId: 'turn-duplicate-completion', text: 'done' }
      ],
      threads: [makeThread({ id: 'thread-duplicate-completion', title: 'Duplicate completion' })],
      refreshThreads,
      drainQueuedMessages
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-duplicate-completion' })

    sink.onTurnComplete({ status: 'completed', turnId: 'turn-duplicate-completion' })
    const projectedOnce = getState()
    sink.onTurnComplete({ status: 'completed', turnId: 'turn-duplicate-completion' })

    expect(getState()).toEqual(projectedOnce)
    expect(showTurnCompleteNotification).toHaveBeenCalledTimes(1)
    expect(showTurnCompleteNotification).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'main-agent' })
    )
    expect(refreshThreads).toHaveBeenCalledTimes(1)
    expect(drainQueuedMessages).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('keeps a focused visible active conversation read when its turn completes', () => {
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true
    })
    vi.stubGlobal('window', { kunGui: {} })
    const { getState, set, get } = makeSinkHarness({
      route: 'chat',
      activeThreadId: 'thread-visible',
      sideConversations: {},
      sidePanel: { open: false, activeSideId: null },
      unreadThreadIds: { 'thread-visible': true },
      busy: true,
      currentTurnId: 'turn-visible',
      currentTurnUserId: 'user-visible'
    })

    buildThreadEventSink(set, get, { threadId: 'thread-visible' })
      .onTurnComplete({ status: 'completed', turnId: 'turn-visible' })

    expect(getState().unreadThreadIds).toEqual({})
    vi.unstubAllGlobals()
  })

  it('marks the active conversation unread when it completes while the app is hidden', () => {
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      hasFocus: () => false
    })
    vi.stubGlobal('window', { kunGui: {} })
    const { getState, set, get } = makeSinkHarness({
      route: 'chat',
      activeThreadId: 'thread-hidden',
      sideConversations: {},
      sidePanel: { open: false, activeSideId: null },
      busy: true,
      currentTurnId: 'turn-hidden',
      currentTurnUserId: 'user-hidden'
    })

    const sink = buildThreadEventSink(set, get, { threadId: 'thread-hidden' })
    sink.onTurnComplete({ status: 'completed', turnId: 'turn-hidden' })

    expect(getState().unreadThreadIds).toEqual({ 'thread-hidden': 'completed' })
    vi.unstubAllGlobals()
  })

  it('marks a hidden terminal runtime failure as failed attention', () => {
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      hasFocus: () => false
    })
    vi.stubGlobal('window', { kunGui: {} })
    const { getState, set, get } = makeSinkHarness({
      route: 'chat',
      activeThreadId: 'thread-failed',
      sideConversations: {},
      sidePanel: { open: false, activeSideId: null }
    })

    buildThreadEventSink(set, get, {
      threadId: 'thread-failed',
      getThreadDetail: vi.fn(async () => ({ blocks: [], latestSeq: 0 }))
    }).onError(new Error('boom'), { terminal: true })

    expect(getState().unreadThreadIds).toEqual({ 'thread-failed': 'failed' })
    vi.unstubAllGlobals()
  })

  it('refreshes the active Write workspace exactly for a successful in-workspace file change', () => {
    const originalWriteState = useWriteWorkspaceStore.getState()
    const refreshWorkspace = vi.fn(async () => undefined)
    const syncActiveFileFromDisk = vi.fn(async () => true)
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/write',
      activeFilePath: '/workspace/write/draft.md',
      refreshWorkspace,
      syncActiveFileFromDisk
    })
    const { set, get } = makeSinkHarness({ route: 'write' })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTool({
      itemId: 'tool-write',
      summary: 'write_file',
      status: 'success',
      toolKind: 'file_change',
      filePath: 'draft.md'
    })

    expect(refreshWorkspace).toHaveBeenCalledOnce()
    expect(refreshWorkspace).toHaveBeenCalledWith('/workspace/write')
    expect(syncActiveFileFromDisk).toHaveBeenCalledOnce()
    expect(syncActiveFileFromDisk).toHaveBeenCalledWith('/workspace/write', {
      path: '/workspace/write/draft.md',
      animate: true,
      force: true,
      reviewAsDiff: true
    })
    useWriteWorkspaceStore.setState(originalWriteState, true)
  })

  it('publishes scoped Office file lifecycle events from structured tool payloads', () => {
    const dispatchEvent = vi.fn()
    class PreviewEvent<T> {
      constructor(readonly type: string, readonly init: { detail: T }) {}

      get detail(): T {
        return this.init.detail
      }
    }
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', PreviewEvent)
    const expectedSha256 = 'a'.repeat(64)
    const afterSha256 = 'b'.repeat(64)
    const failedExpectedSha256 = 'c'.repeat(64)
    const { set, get } = makeSinkHarness({
      route: 'chat',
      workspaceRoot: '/workspace/project',
      activeThreadId: 'thread-current',
      currentTurnId: 'turn-current'
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTool({
      itemId: 'tool-office-success',
      turnId: 'turn-current',
      summary: 'office_edit',
      status: 'running',
      toolKind: 'file_change',
      filePath: 'reports/brief.docx',
      meta: { toolName: 'office_edit', expectedSha256 }
    })
    sink.onTool({
      itemId: 'tool-office-success',
      turnId: 'turn-current',
      summary: 'office_edit',
      status: 'success',
      toolKind: 'file_change',
      meta: { toolName: 'office_edit', afterSha256, previewInvalidated: true }
    })
    sink.onTool({
      itemId: 'tool-office-failed',
      turnId: 'turn-current',
      summary: 'office_edit',
      status: 'running',
      toolKind: 'file_change',
      filePath: 'reports/failed.xlsx',
      meta: { toolName: 'office_edit', expectedSha256: failedExpectedSha256 }
    })
    sink.onTool({
      itemId: 'tool-office-failed',
      turnId: 'turn-current',
      summary: 'office_edit',
      status: 'error',
      toolKind: 'file_change',
      meta: { toolName: 'office_edit' }
    })

    expect(dispatchEvent.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        type: LIVE_OFFICE_PREVIEW_EVENT,
        detail: expect.objectContaining({
          path: 'reports/brief.docx',
          workspaceRoot: '/workspace/project',
          turnId: 'turn-current',
          phase: 'editing',
          expectedSha256
        })
      }),
      expect.objectContaining({
        detail: expect.objectContaining({ phase: 'committed', expectedSha256: afterSha256 })
      }),
      expect.objectContaining({
        detail: expect.objectContaining({
          path: 'reports/failed.xlsx',
          phase: 'editing',
          expectedSha256: failedExpectedSha256
        })
      }),
      expect.objectContaining({
        detail: expect.objectContaining({
          path: 'reports/failed.xlsx',
          phase: 'failed',
          expectedSha256: failedExpectedSha256
        })
      })
    ])
    vi.unstubAllGlobals()
  })

  it('queues lifecycle-before-wrapper updates by parent turn without rewriting history', () => {
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
    expect(getState().blocks).toEqual([historical])

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

    expect(getState().blocks).toHaveLength(2)
    expect(getState().blocks[0]).toEqual(historical)
    expect(getState().blocks[1]).toMatchObject({
      kind: 'tool', id: 'tool-resume', turnId: 'turn-resume', status: 'running',
      meta: { child: { parentTurnId: 'turn-resume', childStatus: 'running', resumeCount: 1 } }
    })
  })
})
