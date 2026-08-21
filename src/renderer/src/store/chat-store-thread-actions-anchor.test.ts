import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { clearThreadSnapshotCache, getThreadSnapshot } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: 'previous error',
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread('thr_existing')]
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

describe('chat-store-thread-actions timeline user anchor', () => {
  it('hydrates a busy thread with the anchored user message as the current turn user', async () => {
    const subscribeThreadEvents = vi.fn(async () => undefined)
    const getThreadDetail = vi.fn(async () => ({
      blocks: [
        { kind: 'user' as const, id: 'user-active', turnId: 'turn-active', text: 'fix the pipeline' },
        { kind: 'tool' as const, id: 'tool-1', turnId: 'turn-active', summary: 'run build', status: 'running' }
      ],
      latestSeq: 42,
      threadStatus: 'running',
      latestTurnId: 'turn-active',
      latestTurnStatus: 'running',
      latestUserMessageId: 'user-active'
    }))
    registryMock.getProvider.mockReturnValue({ getThreadDetail, subscribeThreadEvents })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerPickList = []
    state.composerModelGroups = []
    state.threads = [{ ...thread('thr_busy'), status: 'running' }]

    await actions.selectThread('thr_busy')

    expect(state.threadLoadingId).toBeNull()
    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('turn-active')
    expect(state.currentTurnUserId).toBe('user-active')
    // The user bubble stays visible next to the live process rows instead of
    // being dropped because the running turn produced more items than the
    // newest page budget.
    expect(state.blocks).toEqual([
      expect.objectContaining({ kind: 'user', id: 'user-active', turnId: 'turn-active' }),
      expect.objectContaining({ kind: 'tool', id: 'tool-1', status: 'running' })
    ])
    expect(state.lastSeq).toBe(42)
    expect(subscribeThreadEvents).toHaveBeenCalledWith('thr_busy', 42, expect.anything(), expect.anything())
  })

  it('prepends older history and merges its turn durations', async () => {
    const getThreadDetail = vi.fn(async (_threadId: string, options?: { before?: string }) => ({
      blocks: [
        { kind: 'user' as const, id: 'user-older', text: 'older question' },
        { kind: 'assistant' as const, id: 'assistant-current', text: 'stale duplicate' },
        {
          kind: 'tool' as const,
          id: 'tool_call_1',
          summary: 'Run build',
          status: 'running' as const,
          filePath: '/workspace/build.log',
          meta: { sourceItemId: 'call_item', sourceItemKind: 'tool_call', command: 'npm run build' }
        }
      ],
      latestSeq: 50,
      turnDurationByUserId: { 'user-older': 101_000 },
      historyCursor: 'item_older_cursor',
      hasMoreHistory: true
    }))
    registryMock.getProvider.mockReturnValue({ getThreadDetail })
    const { actions, state } = buildHarness()
    state.busy = false
    state.activeThreadId = 'thr_existing'
    state.blocks = [
      { kind: 'assistant', id: 'assistant-current', text: 'current answer' },
      {
        kind: 'tool',
        id: 'tool_call_1',
        summary: 'Build complete',
        status: 'success',
        detail: 'done',
        meta: { sourceItemId: 'result_item', sourceItemKind: 'tool_result', exit_code: 0 }
      }
    ]
    state.threadHistoryCursor = 'item_current_cursor'
    state.threadHasMoreHistory = true
    state.threadHistoryLoading = false
    state.turnDurationByUserId = { 'user-current': 8_000 }

    await actions.loadEarlierThreadHistory()

    expect(getThreadDetail).toHaveBeenCalledWith('thr_existing', {
      before: 'item_current_cursor'
    })
    expect(state.blocks).toEqual([
      expect.objectContaining({ id: 'user-older' }),
      expect.objectContaining({ id: 'assistant-current', text: 'current answer' }),
      expect.objectContaining({
        id: 'tool_call_1',
        status: 'success',
        detail: 'done',
        filePath: '/workspace/build.log',
        meta: expect.objectContaining({ command: 'npm run build', exit_code: 0 })
      })
    ])
    expect(state.threadHistoryCursor).toBe('item_older_cursor')
    expect(state.threadHasMoreHistory).toBe(true)
    expect(state.threadHistoryLoading).toBe(false)
    expect(state.turnDurationByUserId).toEqual({
      'user-current': 8_000,
      'user-older': 101_000
    })

    state.threads = [thread('thr_existing'), thread('thr_other')]
    await actions.selectThread('thr_other')
    expect(getThreadSnapshot('thr_existing')).toBeNull()
  })
})

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  clearThreadSnapshotCache()
  vi.unstubAllGlobals()
})
