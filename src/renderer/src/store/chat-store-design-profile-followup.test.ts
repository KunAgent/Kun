import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignTaskProfile } from '../agent/design-task-profile'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { isPendingQueuedMessage } from './queued-message-persistence'
import type { ChatState, ChatStoreGet, ChatStoreSet, QueuedUserMessage } from './chat-store-types'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'
import { reduceChatProjection } from './chat-projection-reducer'
import { preserveListedDesignProfiles } from '../design/design-locked-profile'

function lockedProfile(): DesignTaskProfile {
  return {
    version: 1,
    documentTarget: { documentId: 'doc_locked', boardArtifactId: 'board_locked' },
    outputMedium: 'html',
    target: 'web',
    preset: 'none',
    context: { tone: [] },
    lockedAtTurnId: 'turn_design_1'
  }
}

function thread(): NormalizedThread {
  return {
    id: 'thr_design',
    title: 'Design task',
    updatedAt: '2026-08-17T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'running',
    agentSurface: 'code'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state = {
    activeThreadId: 'thr_design',
    blocks: [],
    busy: true,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: 'deepseek-v4-pro',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerProviderId: 'deepseek',
    currentTurnId: 'turn_running',
    currentTurnOrchestration: null,
    currentTurnUserId: 'user_running',
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    loadComposerModels: vi.fn(async () => undefined),
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => false),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {},
    threads: [thread()]
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

describe('design profile follow-up store behavior', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('keeps turn_started designProfile on the thread entry', () => {
    const projected = reduceChatProjection({
      activeThreadId: 'thr_design',
      threads: [thread()]
    } as ChatState, {
      type: 'thread_metadata_changed',
      payload: {
        threadId: 'thr_design',
        agentSurface: 'code',
        designProfile: lockedProfile()
      }
    }, {
      now: Date.parse('2026-08-17T00:00:00.000Z'),
      clearRecoveringError: (error) => error,
      goalTimelineText: () => '',
      runtimeStatusText: () => '',
      runtimeErrorView: () => ({ summary: '', message: '' }),
      upsertRuntimeError: (blocks) => blocks,
      formatRuntimeError: () => '',
      runtimeErrorDetail: () => '',
      isInterruptSettledError: () => false,
      settlePendingRuntimeWork: (blocks) => blocks,
      threadSnapshotLooksRunning: () => false
    })

    expect(projected.threads?.[0]?.designProfile).toEqual(lockedProfile())
  })

  it('does not let a lean list wipe an existing lock', () => {
    const listed = preserveListedDesignProfiles(
      [thread()],
      new Map([['thr_design', { designProfile: lockedProfile() }]])
    )
    expect(listed[0]?.designProfile).toEqual(lockedProfile())
  })

  it('marks design_profile_locked as a single failed item and still drains later Code sends', async () => {
    const sendUserMessage = vi.fn(async (_threadId: string, _text: string, options?: { agentSurface?: string }) => {
      if (options?.agentSurface === 'design') {
        throw new Error(JSON.stringify({
          code: 'design_profile_locked',
          message: 'Design task profile is locked and does not match the submitted profile',
          details: {
            lockedAtTurnId: 'turn_design_1',
            lockedDocumentId: 'doc_locked',
            lockedBoardArtifactId: 'board_locked',
            mismatch: 'profile'
          }
        }))
      }
      return {
        threadId: 'thr_design',
        turnId: 'turn_code',
        userMessageItemId: 'user_code',
        agentSurface: 'code' as const,
        threadAgentSurface: 'code' as const
      }
    })
    registryMock.getProvider.mockReturnValue({
      connect: vi.fn(async () => undefined),
      sendUserMessage,
      getThreadDetail: vi.fn(async () => ({ designProfile: lockedProfile() })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          workspaceRoot: '/workspace/deepseek-gui',
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        workspaceDirectoryExists: vi.fn(async () => true),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    const sending = actions.sendMessage('Revise on a new board', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design',
      waitForRuntimeAdmission: true,
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'doc_new', boardArtifactId: 'board_new' },
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: [] }
      },
      designDocumentTarget: { documentId: 'doc_new', boardArtifactId: 'board_new' }
    })
    await vi.waitFor(() => expect(state.queuedMessages).toHaveLength(1))
    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    await actions.drainQueuedMessages()
    await expect(sending).resolves.toBe(false)

    expect(state.queuedMessages).toEqual([])
    expect(state.threads[0]?.designProfile).toEqual(lockedProfile())
    expect(state.queuedMessages.filter(isPendingQueuedMessage)).toEqual([])

    await expect(actions.sendMessage('Back to code', 'agent', {
      agentSurface: 'code',
      expectedThreadId: 'thr_design',
      designProfile: {
        version: 1,
        documentTarget: { documentId: 'doc_new', boardArtifactId: 'board_new' },
        outputMedium: 'html',
        target: 'web',
        preset: 'none',
        context: { tone: [] }
      },
      designDocumentTarget: { documentId: 'doc_new', boardArtifactId: 'board_new' }
    })).resolves.toBe(true)

    expect(sendUserMessage).toHaveBeenLastCalledWith(
      'thr_design',
      expect.any(String),
      expect.objectContaining({ agentSurface: 'code' })
    )
    expect(sendUserMessage.mock.calls.at(-1)?.[2]).not.toHaveProperty('designProfile')
    expect(sendUserMessage.mock.calls.at(-1)?.[2]).not.toHaveProperty('designDocumentTarget')
  })

  it('only drains pending queue items, leaving a failed Design snapshot behind', () => {
    const failed: QueuedUserMessage = {
      id: 'q-failed',
      text: 'failed design follow-up',
      deliveryState: 'failed',
      agentSurface: 'design'
    }
    const pending: QueuedUserMessage = {
      id: 'q-code',
      text: 'code follow-up',
      deliveryState: 'pending',
      agentSurface: 'code'
    }
    expect([failed, pending].filter(isPendingQueuedMessage)).toEqual([pending])
  })
})
