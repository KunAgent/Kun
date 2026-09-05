import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignTaskProfileInput } from '../agent/design-task-profile'
import type { NormalizedThread } from '../agent/types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({ getProvider: registryMock.getProvider }))

import { createThreadActions } from './chat-store-thread-actions'

function designThread(): NormalizedThread {
  return {
    id: 'thr_design',
    title: 'Design task',
    updatedAt: '2026-08-12T00:00:00.000Z',
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
    currentTurnOrchestration: 'direct',
    currentTurnUserId: 'user_running',
    error: null,
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
    threads: [designThread()]
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

describe('queued Design profile delivery', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('freezes profile and document target through queueing and retry delivery', async () => {
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thr_design',
      turnId: 'turn_design',
      userMessageItemId: 'user_design',
      agentSurface: 'design' as const,
      threadAgentSurface: 'code' as const
    }))
    registryMock.getProvider.mockReturnValue({
      connect: vi.fn(async () => undefined),
      sendUserMessage,
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
    const designDocumentTarget = { documentId: 'doc_design', boardArtifactId: 'board_design' }
    const designProfile: DesignTaskProfileInput = {
      version: 1,
      documentTarget: { ...designDocumentTarget },
      outputMedium: 'image',
      target: 'app',
      preset: 'ios',
      context: { tone: ['bold'], brandColor: '#ff3366' }
    }
    const designImagePlacementTarget = {
      shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect' as const
    }

    await expect(actions.sendMessage('Generate a poster', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design',
      designProfile,
      designDocumentTarget,
      designImagePlacementTarget
    })).resolves.toBe(true)

    expect(state.queuedMessages[0]).toMatchObject({
      designProfile: {
        documentTarget: { documentId: 'doc_design', boardArtifactId: 'board_design' },
        outputMedium: 'image',
        context: { tone: ['bold'] }
      },
      designDocumentTarget: { documentId: 'doc_design', boardArtifactId: 'board_design' },
      designImagePlacementTarget: {
        shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect'
      }
    })

    // The busy send was admitted to the runtime queue in one shot; the
    // frozen design snapshot ships with that single admission request.
    expect(sendUserMessage).toHaveBeenCalledTimes(1)
    expect(sendUserMessage).toHaveBeenCalledWith(
      'thr_design',
      expect.any(String),
      expect.objectContaining({
        agentSurface: 'design',
        enqueueIfBusy: true,
        designProfile: expect.objectContaining({
          outputMedium: 'image',
          documentTarget: { documentId: 'doc_design', boardArtifactId: 'board_design' },
          context: expect.objectContaining({ tone: ['bold'] })
        }),
        designDocumentTarget: { documentId: 'doc_design', boardArtifactId: 'board_design' },
        designImagePlacementTarget: {
          shapeId: 'hero_holder', expectedHolderKind: 'implicit-rect'
        }
      })
    )
    expect(state.threads[0]?.agentSurface).toBe('code')
  })

  it('does not resolve a first Design queue submission before runtime admission', async () => {
    const sendUserMessage = vi.fn(async () => ({
      threadId: 'thr_design',
      turnId: 'turn_design',
      userMessageItemId: 'user_design',
      agentSurface: 'design' as const,
      threadAgentSurface: 'code' as const
    }))
    registryMock.getProvider.mockReturnValue({
      connect: vi.fn(async () => undefined),
      sendUserMessage,
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
    const target = { documentId: 'doc_design', boardArtifactId: 'board_design' }
    const sending = actions.sendMessage('Generate a poster', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design',
      designProfile: {
        version: 1,
        documentTarget: target,
        outputMedium: 'image',
        target: 'web',
        preset: 'none',
        context: { tone: [] }
      },
      designDocumentTarget: target,
      waitForRuntimeAdmission: true
    })
    let settled = false
    void sending.then(() => { settled = true })

    await vi.waitFor(() => expect(state.queuedMessages).toHaveLength(1))
    expect(settled).toBe(false)
    expect(state.queuedMessages[0]).toMatchObject({ waitForRuntimeAdmission: true })

    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    await actions.drainQueuedMessages()

    await expect(sending).resolves.toBe(true)
    expect(sendUserMessage).toHaveBeenCalledOnce()
  })

  it('rejects an admission waiter when its queued first Design send is removed', async () => {
    registryMock.getProvider.mockReturnValue({})
    vi.stubGlobal('window', {
      kunGui: {
        workspaceDirectoryExists: vi.fn(async () => true)
      }
    })
    const { actions, state } = buildHarness()
    const target = { documentId: 'doc_design', boardArtifactId: 'board_design' }
    const sending = actions.sendMessage('Generate a poster', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design',
      designProfile: {
        version: 1,
        documentTarget: target,
        outputMedium: 'image',
        target: 'web',
        preset: 'none',
        context: { tone: [] }
      },
      designDocumentTarget: target,
      waitForRuntimeAdmission: true
    })

    await vi.waitFor(() => expect(state.queuedMessages).toHaveLength(1))
    actions.removeQueuedMessage(state.queuedMessages[0]!.id)

    await expect(sending).resolves.toBe(false)
    expect(state.queuedMessages).toEqual([])
  })

  it('rejects and removes a queued first Design send after definitive admission failure', async () => {
    const sendUserMessage = vi.fn(async () => {
      throw new Error('HTTP 409 design_profile_locked')
    })
    registryMock.getProvider.mockReturnValue({
      connect: vi.fn(async () => undefined),
      sendUserMessage
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
    const target = { documentId: 'doc_design', boardArtifactId: 'board_design' }
    const sending = actions.sendMessage('Generate a poster', 'agent', {
      agentSurface: 'design',
      expectedThreadId: 'thr_design',
      designProfile: {
        version: 1,
        documentTarget: target,
        outputMedium: 'image',
        target: 'web',
        preset: 'none',
        context: { tone: [] }
      },
      designDocumentTarget: target,
      waitForRuntimeAdmission: true
    })
    await vi.waitFor(() => expect(state.queuedMessages).toHaveLength(1))

    state.busy = false
    state.currentTurnId = null
    state.currentTurnUserId = null
    await actions.drainQueuedMessages()

    await expect(sending).resolves.toBe(false)
    expect(sendUserMessage).toHaveBeenCalledOnce()
    expect(state.queuedMessages).toEqual([])
  })
})
