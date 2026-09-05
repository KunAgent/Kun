import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { graphRuntimeClient } from '../graph/graph-runtime-client'
import { useGraphStore } from '../graph/graph-store'
import type { GraphRun } from '../graph/graph-types'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import i18n from '../i18n'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  queuedMessagesForThread,
  saveQueuedMessagesForThread
} from './queued-message-persistence'
import { clearThreadSnapshotCache, getThreadSnapshot } from './thread-snapshot-cache'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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

function expectSink(sink: ThreadEventSink | null): ThreadEventSink {
  expect(sink).not.toBeNull()
  return sink as ThreadEventSink
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    useGraphStore.setState({
      threadId: null,
      runs: [],
      selectedRunId: null,
      selectedNodeId: null,
      error: null
    })
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('recovers a server-busy thread and retains one queued submission with its request id', async () => {
    const ownerInstanceId = 'af197738-2317-49bb-b9b0-d6d5e7b24cdd'
    const sendUserMessage = vi.fn(async (
      _threadId: string,
      _text: string,
      _options?: { clientRequestId?: string }
    ) => {
      throw new Error(JSON.stringify({
        code: 'thread_busy',
        message: `thread thr_existing is busy in production/${ownerInstanceId}`,
        details: {
          activeTurnId: 'turn_active',
          owner: { instanceId: ownerInstanceId, runtimeFlavor: 'production' }
        }
      }))
    })
    const subscribeThreadEvents = vi.fn(() => new Promise<void>(() => undefined))
    const provider = {
      sendUserMessage,
      getThreadDetail: vi.fn(async () => ({
        blocks: [{
          kind: 'user' as const,
          id: 'user_active',
          turnId: 'turn_active',
          text: 'Long-running task'
        }],
        latestSeq: 41,
        threadStatus: 'running',
        latestTurnId: 'turn_active',
        latestTurnStatus: 'running',
        latestTurnOrchestration: 'direct' as const,
        latestUserMessageId: 'user_active'
      })),
      subscribeThreadEvents
    }
    registryMock.getProvider.mockReturnValue(provider)
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
    state.busy = false
    state.threads = [{ ...thread('thr_existing'), status: 'idle' }]
    state.recoverActiveTurn = actions.recoverActiveTurn

    await expect(actions.sendMessage('send this after the current task', 'agent')).resolves.toBe(true)

    expect(sendUserMessage).toHaveBeenCalledOnce()
    const firstOptions = sendUserMessage.mock.calls[0]![2] as { clientRequestId?: string }
    expect(firstOptions.clientRequestId).toMatch(/^turn_/)
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]).toMatchObject({
      text: 'send this after the current task',
      clientRequestId: firstOptions.clientRequestId,
      deliveryState: 'pending'
    })
    expect(state.blocks).toEqual([expect.objectContaining({ id: 'user_active' })])
    expect(state.blocks.some((block) => block.kind === 'system' && block.runtimeError)).toBe(false)
    expect(state.busy).toBe(true)
    expect(state.currentTurnId).toBe('turn_active')
    expect(state.error).toBe(i18n.t('common:runtimeThreadBusyQueued'))
    expect(state.error).not.toContain(ownerInstanceId)
    expect(state.error).not.toContain('unknown')
    expect(subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      41,
      expect.any(Object),
      expect.any(AbortSignal)
    )

    const retained = state.queuedMessages[0]!
    state.busy = false
    state.currentTurnId = null
    await expect(actions.sendMessage(retained.text, retained.mode, { queued: retained })).resolves.toBe(true)

    expect(sendUserMessage).toHaveBeenCalledTimes(2)
    const retryOptions = sendUserMessage.mock.calls[1]![2] as { clientRequestId?: string }
    expect(retryOptions.clientRequestId).toBe(firstOptions.clientRequestId)
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]?.clientRequestId).toBe(firstOptions.clientRequestId)
  })

  it('returns a thread-bound Design turn as soon as runtime accepts it', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.route = 'chat'
    const pendingRefresh = deferredValue<void>()
    state.refreshThreads = vi.fn(() => pendingRefresh.promise)
    const designDocumentTarget = {
      documentId: 'doc_architecture',
      boardArtifactId: 'board_architecture'
    }
    const designProfile = {
      version: 1 as const,
      documentTarget: designDocumentTarget,
      outputMedium: 'html' as const,
      target: 'web' as const,
      preset: 'none' as const,
      context: { tone: [] }
    }

    await expect(actions.sendMessage('draw an architecture map', 'agent', {
      displayText: 'Draw an architecture map',
      guiDesignCanvas: true,
      agentSurface: 'design',
      designProfile,
      designDocumentTarget,
      expectedThreadId: 'thr_existing',
      serviceTier: 'priority'
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'draw an architecture map',
      expect.objectContaining({
        guiDesignCanvas: true,
        agentSurface: 'design',
        designProfile,
        designDocumentTarget,
        displayText: 'Draw an architecture map',
        serviceTier: 'priority'
      })
    )
    expect(state.blocks.find((block) => block.kind === 'user')).toMatchObject({
      turnId: 'turn_1',
      text: 'Draw an architecture map',
      meta: {
        displayText: 'Draw an architecture map',
        guiDesignCanvas: true
      }
    })
    expect(state.refreshThreads).toHaveBeenCalledOnce()
    pendingRefresh.resolve()
  })

  it('forwards the selected reasoning effort with the next turn', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false

    await expect(actions.sendMessage('disable reasoning', 'agent', {
      reasoningEffort: 'off'
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'disable reasoning',
      expect.objectContaining({ reasoningEffort: 'off' })
    )
  })

  it('consumes matching extension composer context exactly once after the turn starts', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.extensionComposerContexts = [{
      workspaceRoot: '/workspace/deepseek-gui',
      attachment: {
        schemaVersion: 1,
        id: 'selection',
        title: 'Selected edit',
        summary: 'One selected timeline item',
        reference: { projectId: 'project-1', itemIds: ['item-1'] },
        revision: 4,
        generation: 2,
        attachmentId: `extension-context:${'a'.repeat(64)}`,
        provenance: {
          extensionId: 'kun-examples.kun-video-editor',
          extensionVersion: '0.3.0',
          viewContributionId: 'editor',
          workspaceId: 'b'.repeat(64)
        }
      }
    }]

    const reviewContext = {
      schemaVersion: 1 as const,
      id: 'preview-ppt-review-000000000000000000000001',
      title: 'PPT visual review',
      summary: 'One reviewed slide',
      reference: {
        kind: 'ppt-review',
        schemaVersion: 1,
        workflowId: 'ppt_workflow',
        childId: 'child_ppt',
        slides: [{ slideId: 'slide-1', revision: 1 }]
      },
      revision: 1,
      generation: 1,
      attachmentId: `dev-preview-context:${'c'.repeat(64)}`,
      provenance: {
        source: 'dev-preview' as const,
        workspaceId: 'd'.repeat(64)
      }
    }

    await expect(actions.sendMessage('Please refine this edit', 'agent', {
      composerContexts: [reviewContext]
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'Please refine this edit',
      expect.objectContaining({
        composerContexts: [
          reviewContext,
          expect.objectContaining({ id: 'selection', revision: 4, generation: 2 })
        ]
      })
    )
    expect(state.extensionComposerContexts).toEqual([])
  })

  it('snapshots extension composer context into a queued turn before clearing the chip', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_queued',
        userMessageItemId: 'user_queued'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    const composerContext = {
      schemaVersion: 1 as const,
      id: 'selection',
      title: 'Selected edit',
      summary: 'One selected timeline item',
      reference: { projectId: 'project-1', itemIds: ['item-1'] },
      revision: 4,
      generation: 2,
      attachmentId: `extension-context:${'a'.repeat(64)}`,
      provenance: {
        extensionId: 'kun-examples.kun-video-editor',
        extensionVersion: '0.3.0',
        viewContributionId: 'extension:kun-examples.kun-video-editor/editor',
        workspaceId: 'b'.repeat(64)
      }
    }
    state.extensionComposerContexts = [{
      workspaceRoot: '/workspace/deepseek-gui',
      attachment: composerContext
    }]

    await expect(actions.sendMessage('Queued edit', 'agent')).resolves.toBe(true)
    expect(state.extensionComposerContexts).toEqual([])
    // Busy sends are admitted directly to the runtime queue with their
    // composer context snapshot; the local entry only mirrors delivery.
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'Queued edit',
      expect.objectContaining({
        enqueueIfBusy: true,
        composerContexts: [composerContext]
      })
    )
    const queued = state.queuedMessages[0]!
    expect(queued).toEqual(expect.objectContaining({
      deliveryState: 'in_flight',
      deliveryTurnId: 'turn_queued',
      composerContexts: [composerContext]
    }))
  })

  it('sends an override provider from the write route without switching the global runtime provider', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    const setSettings = vi.fn(async () => ({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } },
      codePromptPrefix: '',
      chatWelcomeMessage: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        setSettings,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing') as never

    await expect(actions.sendMessage('make a prototype', 'agent', {
      model: 'MiniMax-M3',
      providerId: 'minimax-token-plan'
    })).resolves.toBe(true)

    expect(setSettings).not.toHaveBeenCalled()
    expect(restartRuntime).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'make a prototype',
      expect.objectContaining({ model: 'MiniMax-M3', providerId: 'minimax-token-plan' })
    )
  })

  it('forwards only first-party PPT review and direction contexts from the Write route', async () => {
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing', turnId: 'turn_1', userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({ workspaceRoot: '/workspace/deepseek-gui' })),
        workspaceDirectoryExists: vi.fn(async () => true),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing') as never
    const pptReview = {
      schemaVersion: 1 as const, id: 'ppt-review', title: 'PPT review', summary: 'One slide',
      reference: { kind: 'ppt-review', workflowId: 'workflow-a', childId: 'child-a', slides: [] },
      revision: 1, generation: 1,
      attachmentId: `dev-preview-context:${'a'.repeat(64)}`,
      provenance: { source: 'dev-preview' as const, workspaceId: 'b'.repeat(64) }
    }
    const unrelated = {
      ...pptReview, id: 'unrelated', attachmentId: `extension-context:${'c'.repeat(64)}`,
      reference: { kind: 'issue', issueId: 'issue-1' },
      provenance: {
        extensionId: 'acme.test', extensionVersion: '1.0.0',
        viewContributionId: 'extension:acme.test/view', workspaceId: 'b'.repeat(64)
      }
    }
    const pptDirection = {
      ...pptReview,
      id: 'ppt-direction',
      attachmentId: `dev-preview-context:${'d'.repeat(64)}`,
      reference: {
        kind: 'ppt-direction', schemaVersion: 1, workflowId: 'workflow-a', childId: 'child-a',
        directions: [{ directionId: 'signal', revision: 2 }]
      }
    }

    await expect(actions.sendMessage('批准', 'agent', {
      composerContexts: [pptReview, pptDirection, unrelated]
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing', '批准', expect.objectContaining({ composerContexts: [pptReview, pptDirection] })
    )
  })

  it('snapshots the selected composer provider when creating the first thread', async () => {
    const provider = {
      connect: vi.fn(async () => undefined),
      createThread: vi.fn(async () => ({
        id: 'thr_new',
        title: 'hello',
        updatedAt: '2026-06-09T00:00:00.000Z',
        model: 'MiniMax-M3',
        providerId: 'minimax-token-plan',
        mode: 'agent',
        workspace: '/workspace/deepseek-gui',
        status: 'idle'
      })),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_new',
        turnId: 'turn_1',
        userMessageItemId: 'user_1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/deepseek-gui',
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: '',
          chatWelcomeMessage: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.busy = false
    state.composerModel = 'MiniMax-M3'
    state.composerProviderId = 'minimax-token-plan'
    state.composerModelGroups = [{
      providerId: 'minimax-token-plan',
      label: 'Extension MiniMax',
      modelIds: ['MiniMax-M3'],
      accountId: 'account-extension-1',
      extensionProvider: {
        extensionId: 'acme.models',
        extensionVersion: '1.0.0',
        localProviderId: 'minimax'
      }
    }]

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(true)

    expect(provider.createThread).toHaveBeenCalledWith(expect.objectContaining({
      model: 'MiniMax-M3',
      providerId: 'minimax-token-plan',
      accountId: 'account-extension-1'
    }))
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_new',
      'hello',
      expect.objectContaining({
        model: 'MiniMax-M3',
        providerId: 'minimax-token-plan',
        accountId: 'account-extension-1'
      })
    )
  })
})
