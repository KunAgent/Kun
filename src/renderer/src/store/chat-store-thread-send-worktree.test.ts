import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({}))
}))
const workspaceMock = vi.hoisted(() => ({
  currentCodeWorkspaceRoot: vi.fn(() => '/repo')
}))
const helpersMock = vi.hoisted(() => ({
  activeClawChannel: vi.fn(() => null),
  readThreadComposerSelection: vi.fn(() => undefined),
  rememberCodeWorkspaceRoots: vi.fn((roots: string[], next: Array<string | undefined>) =>
    [...roots, ...next.filter((v): v is string => Boolean(v))]),
  rememberThreadComposerSelection: vi.fn(),
  rememberTurnModel: vi.fn()
}))
const runtimeHelpersMock = vi.hoisted(() => ({
  findReusableEmptyThreadId: vi.fn(async () => null),
  reconcileOptimisticUserBlock: vi.fn()
}))
const runtimeMock = vi.hoisted(() => ({
  armBusyWatchdog: vi.fn(),
  buildThreadEventSink: vi.fn(() => ({})),
  isCodeThread: vi.fn(() => true),
  looksLikeActiveTurnError: vi.fn(() => false),
  rememberPendingClawFeishuMirror: vi.fn(),
  runtimeErrorDetail: vi.fn(() => ''),
  runtimeStreamRecoveringMessage: vi.fn(() => ''),
  shouldOpenSettingsForError: vi.fn(() => false)
}))
const actionHelpersMock = vi.hoisted(() => ({
  ensureRuntimeProviderForSend: vi.fn(async () => undefined),
  subscribeThreadEventsWithRecovery: vi.fn()
}))
const navigationMock = vi.hoisted(() => ({
  settleAcceptedTurnAfterNavigation: vi.fn()
}))
const checkpointMock = vi.hoisted(() => ({
  startWorkspaceCheckpointSnapshot: vi.fn(() => 'req_cp')
}))
const schedulersMock = vi.hoisted(() => ({
  clearBusyWatchdog: vi.fn(),
  resetBusyRecoveryAttempts: vi.fn()
}))
const persistenceMock = vi.hoisted(() => ({
  saveQueuedMessagesForThread: vi.fn()
}))
const registryMock = vi.hoisted(() => ({
  readDesignThreadRegistry: vi.fn(() => ({})),
  mergeThreadDesignProfile: vi.fn((_t: unknown, _d: unknown) => undefined)
}))

vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: runtimeClientMock
}))
vi.mock('./chat-store-current-workspace', () => workspaceMock)
vi.mock('./chat-store-helpers', () => helpersMock)
vi.mock('./chat-store-runtime-helpers', () => runtimeHelpersMock)
vi.mock('./chat-store-runtime', () => runtimeMock)
vi.mock('./chat-store-thread-action-helpers', () => actionHelpersMock)
vi.mock('./chat-store-thread-send-navigation', () => navigationMock)
vi.mock('./chat-store-thread-send-checkpoint', () => checkpointMock)
vi.mock('./chat-store-schedulers', () => schedulersMock)
vi.mock('./queued-message-persistence', () => persistenceMock)
vi.mock('../design/design-thread-registry', () => ({
  readDesignThreadRegistry: registryMock.readDesignThreadRegistry
}))
vi.mock('../design/design-locked-profile', () => ({
  mergeThreadDesignProfile: registryMock.mergeThreadDesignProfile
}))
vi.mock('./chat-store-send-prompt', () => ({
  runtimePromptForSurface: ({ prompt }: { prompt: string }) => prompt
}))

import { performPreparedThreadSend } from './chat-store-thread-send-direct'
import type { PreparedThreadSend } from './chat-store-thread-send-direct-types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { QueuedUserMessage } from './chat-store-message-types'
import { threadWorkspacePreparing, useTaskWorkspaceStore } from './task-workspace-store'

function buildHarness(initial?: Partial<ChatState>): {
  state: ChatState
  set: ChatStoreSet
  get: ChatStoreGet
} {
  const state = {
    route: 'ade',
    threads: [],
    adeThreads: [],
    blocks: [],
    busy: false,
    busyUnconfirmed: false,
    queuedMessages: [],
    activeThreadId: null,
    lastSeq: 0,
    codeWorkspaceRoots: [],
    clawChannels: [],
    composerIsolation: 'local',
    composerWorktreeStartFrom: undefined,
    turnStartedAtByUserId: {},
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    refreshThreads: vi.fn(async () => undefined),
    error: null,
    ...initial
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  return { state, set, get }
}

function submission(): QueuedUserMessage {
  return { id: 'q_1', text: 'ship it', clientRequestId: 'req_1', deliveryState: 'pending' }
}

function inputFor(
  harness: ReturnType<typeof buildHarness>,
  provider: PreparedThreadSend['provider']
): PreparedThreadSend {
  return {
    context: { set: harness.set, get: harness.get, sseAbortRef: { current: null } },
    runtime: {
      threadSelectionGeneration: 0,
      fenceThreadMutation: vi.fn(() => 1),
      persistActiveQueuedMessages: vi.fn()
    },
    provider,
    trimmedText: 'ship it',
    mode: 'agent',
    overrides: undefined,
    queued: undefined,
    clientRequestId: 'req_1',
    expectedThreadId: '',
    requestedAgentSurface: 'code',
    designProfile: undefined,
    designDocumentTarget: undefined,
    designImagePlacementTarget: undefined,
    messageSource: undefined,
    expectedThreadStillActive: () => true,
    writeContext: undefined,
    now: Date.now(),
    userBlockId: 'u_1',
    attachmentIds: [],
    attachments: [],
    fileReferences: [],
    composerContexts: [],
    ackNoticeIds: undefined,
    activeThreadId: null,
    displayText: 'ship it',
    userDisplayText: undefined,
    generatedTitle: 'task',
    shouldAutoRenameForRoute: false,
    shouldRenameThreadAfterSend: false,
    composerModel: 'opus',
    composerProviderId: '',
    composerAccountId: '',
    composerHarnessId: 'claude-code',
    composerCredentialMode: 'native-login',
    reasoningEffort: undefined,
    serviceTier: undefined,
    guiDesignCanvas: false,
    guiExcalidrawCanvas: false,
    guiDesignMode: false,
    persona: '',
    orchestration: 'direct',
    userModelChip: undefined,
    submittedMessageForQueue: submission()
  }
}

beforeEach(() => {
  useTaskWorkspaceStore.setState({ prepByThread: {} })
})

describe('performPreparedThreadSend ADE worktree isolation', () => {
  it('queues the first send while the requested worktree is still preparing', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'worktree' })
    const provider = {
      createThread: vi.fn(async () => ({
        id: 'thr_new',
        workspace: '/repo',
        workspaceMode: 'ade' as const
      })),
      createTaskWorkspace: vi.fn(async () => ({
        record: {
          workspaceId: 'ws_1',
          ownerThreadId: 'thr_new',
          sourceRoot: '/repo',
          isolation: 'worktree',
          state: 'creating'
        }
      })),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const result = await performPreparedThreadSend(
      inputFor({ state, ...harness }, provider as never)
    )
    expect(result).toBe(true)
    expect(provider.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMode: 'ade', harnessId: 'claude-code' })
    )
    expect(provider.createTaskWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ ownerThreadId: 'thr_new', isolation: 'worktree', sourceRoot: '/repo' })
    )
    // The turn is parked locally — the runtime must not see it yet.
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBe('thr_new')
    expect(state.busy).toBe(false)
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q_1', deliveryState: 'pending' })
    ])
    expect(threadWorkspacePreparing('thr_new')).toBe(true)
  })

  it('sends immediately when the session picked local isolation', async () => {
    const { state, ...harness } = buildHarness({ composerIsolation: 'local' })
    const provider = {
      createThread: vi.fn(async () => ({
        id: 'thr_new',
        workspace: '/repo',
        workspaceMode: 'ade' as const
      })),
      createTaskWorkspace: vi.fn(),
      sendUserMessage: vi.fn(async () => ({ turnId: 'turn_1' }))
    }
    const result = await performPreparedThreadSend(
      inputFor({ state, ...harness }, provider as never)
    )
    expect(result).toBe(true)
    expect(provider.createTaskWorkspace).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_new',
      'ship it',
      expect.objectContaining({ harnessId: 'claude-code', credentialMode: 'native-login' })
    )
  })
})
