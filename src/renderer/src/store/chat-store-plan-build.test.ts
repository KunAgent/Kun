import { beforeEach, describe, expect, it, vi } from 'vitest'

const registryMock = vi.hoisted(() => ({ provider: {} as Record<string, unknown> }))
const helpersMock = vi.hoisted(() => ({
  rememberThreadComposerSelection: vi.fn()
}))
const runtimeHelpersMock = vi.hoisted(() => ({
  clearedThreadSelection: vi.fn(() => ({
    activeThreadId: null,
    blocks: [],
    lastSeq: 0,
    busy: false,
    queuedMessages: []
  }))
}))
const worktreeMock = vi.hoisted(() => ({
  prepareAdeThreadWorktree: vi.fn(
    async (_args: { submittedMessageForQueue?: unknown }): Promise<{ workspaceId: string } | null> =>
      null
  )
}))
const snapshotMock = vi.hoisted(() => ({ snapshotThreadProjection: vi.fn() }))
const watchMock = vi.hoisted(() => ({ watchPlanBuildReview: vi.fn() }))
const runtimeMock = vi.hoisted(() => ({
  syncTurnCompletionPoll: vi.fn(),
  turnCompleteNotificationSource: vi.fn(() => null),
  watchTurnCompletionNotification: vi.fn()
}))

vi.mock('../agent/registry', () => ({ getProvider: () => registryMock.provider }))
vi.mock('./chat-store-helpers', () => helpersMock)
vi.mock('./chat-store-runtime', () => runtimeMock)
vi.mock('./chat-store-runtime-helpers', () => runtimeHelpersMock)
vi.mock('./chat-store-thread-send-worktree', () => worktreeMock)
vi.mock('./thread-snapshot-cache', () => snapshotMock)
vi.mock('./plan-build-watch', () => watchMock)

import { createPlanBuildActions } from './chat-store-plan-build'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { QueuedUserMessage } from './chat-store-message-types'

function buildHarness(initial?: Partial<ChatState>): {
  state: ChatState
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: { current: AbortController | null }
} {
  const state = {
    route: 'code',
    activeThreadId: 'thr_plan',
    busy: false,
    blocks: [],
    threads: [],
    adeThreads: [],
    queuedMessages: [],
    refreshAdeThreads: vi.fn(async () => undefined),
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  return { state, set, get: () => state, sseAbortRef: { current: null } }
}

const input = {
  prompt: 'Implement the plan steps',
  displayText: 'Build: docs/plans/x.md',
  title: 'x',
  workspaceRoot: '/repo',
  harnessId: 'claude-code',
  credentialMode: 'native-login',
  model: 'opus',
  providerId: '',
  accountId: ''
}

describe('dispatchExternalPlanBuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryMock.provider = {}
    worktreeMock.prepareAdeThreadWorktree.mockResolvedValue(null)
  })

  it('creates an ADE thread pinned to the external harness and parks a planBuild turn', async () => {
    const { state, set, get, sseAbortRef } = buildHarness()
    const createThread = vi.fn(async () => ({ id: 'thr_build', workspace: '/repo' }))
    registryMock.provider = { createThread, createTaskWorkspace: vi.fn() }
    const actions = createPlanBuildActions(
      { set, get, sseAbortRef },
      { threadSelectionGeneration: 0, fenceThreadMutation: vi.fn(() => 1), persistActiveQueuedMessages: vi.fn() }
    )

    const ok = await actions.dispatchExternalPlanBuild(input)

    expect(ok).toBe(true)
    expect(createThread).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/repo',
      workspaceMode: 'ade',
      agentSurface: 'code',
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      model: 'opus'
    }))
    expect(state.route).toBe('ade')
    expect(state.activeThreadId).toBe('thr_build')
    expect(state.adeThreads?.[0]?.id).toBe('thr_build')
    const queued = worktreeMock.prepareAdeThreadWorktree.mock.calls[0]?.[0]
      .submittedMessageForQueue as QueuedUserMessage
    expect(queued).toMatchObject({
      text: 'Implement the plan steps',
      displayText: 'Build: docs/plans/x.md',
      mode: 'agent',
      planBuild: true,
      expectedThreadId: 'thr_build',
      harnessId: 'claude-code',
      credentialMode: 'native-login',
      model: 'opus'
    })
    expect(worktreeMock.prepareAdeThreadWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thr_build',
        workspaceRoot: '/repo',
        startFrom: { kind: 'current-head' },
        label: 'x'
      })
    )
  })

  it('starts the review watcher once the task workspace is created', async () => {
    const { set, get, sseAbortRef } = buildHarness()
    registryMock.provider = {
      createThread: vi.fn(async () => ({ id: 'thr_build', workspace: '/repo' })),
      createTaskWorkspace: vi.fn()
    }
    worktreeMock.prepareAdeThreadWorktree.mockResolvedValue({ workspaceId: 'ws_1' })
    const actions = createPlanBuildActions(
      { set, get, sseAbortRef },
      { threadSelectionGeneration: 0, fenceThreadMutation: vi.fn(() => 1), persistActiveQueuedMessages: vi.fn() }
    )

    await actions.dispatchExternalPlanBuild(input)

    expect(watchMock.watchPlanBuildReview).toHaveBeenCalledWith('ws_1', 'thr_build')
  })

  it('fails without a task-workspace provider surface', async () => {
    const { state, set, get, sseAbortRef } = buildHarness()
    registryMock.provider = { createThread: vi.fn() }
    const actions = createPlanBuildActions(
      { set, get, sseAbortRef },
      { threadSelectionGeneration: 0, fenceThreadMutation: vi.fn(() => 1), persistActiveQueuedMessages: vi.fn() }
    )

    const ok = await actions.dispatchExternalPlanBuild(input)

    expect(ok).toBe(false)
    expect(state.error).toBeTruthy()
    expect(registryMock.provider.createThread).not.toHaveBeenCalled()
  })

  it('surfaces createThread failures without switching threads', async () => {
    const { state, set, get, sseAbortRef } = buildHarness()
    registryMock.provider = {
      createThread: vi.fn(async () => {
        throw new Error('runtime offline')
      }),
      createTaskWorkspace: vi.fn()
    }
    const actions = createPlanBuildActions(
      { set, get, sseAbortRef },
      { threadSelectionGeneration: 0, fenceThreadMutation: vi.fn(() => 1), persistActiveQueuedMessages: vi.fn() }
    )

    const ok = await actions.dispatchExternalPlanBuild(input)

    expect(ok).toBe(false)
    expect(state.activeThreadId).toBe('thr_plan')
    expect(state.error).toBeTruthy()
  })
})
