import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

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
    composerProviderId: '',
    currentTurnId: null,
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
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    useWriteWorkspaceStore.getState().resetWorkspace()
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('snapshots active-turn model and reasoning selections into the next queued input', async () => {
    const { actions, state } = buildHarness()
    state.composerModel = 'deepseek-v4-flash'
    state.composerProviderId = 'deepseek'

    await expect(actions.sendMessage('use these next-turn settings', 'agent', {
      reasoningEffort: 'high'
    })).resolves.toBe(true)

    expect(state.queuedMessages).toHaveLength(1)
    expect(state.queuedMessages[0]).toMatchObject({
      text: 'use these next-turn settings',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      reasoningEffort: 'high'
    })

    state.composerModel = 'deepseek-v4-pro'
    expect(state.queuedMessages[0]?.model).toBe('deepseek-v4-flash')
  })

  it('does not queue GUI plan messages while another turn is active', async () => {
    const { actions, state } = buildHarness()
    const guiPlan: GuiPlanMessageContext = {
      operation: 'draft',
      workspaceRoot: '/workspace/deepseek-gui',
      relativePath: '.kunsdd/plan/feature.md',
      planId: 'plan-1',
      sourceRequest: 'feature'
    }

    await expect(actions.sendMessage('prompt one', 'plan', {
      displayText: 'Generate implementation plan',
      guiPlan
    })).resolves.toBe(false)

    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeTruthy()
  })

  it('rejects a busy Write send instead of accepting a queue that can lose file identity', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md',
      activeFileKind: 'text',
      documentEpoch: 4,
      contentRevision: 2,
      fileContent: 'saved draft',
      persistedContent: 'saved draft',
      saveStatus: 'saved'
    })
    const { actions, state } = buildHarness()
    const ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing')
    state.route = 'write'
    state.busy = true
    state.ensureWriteThreadForWorkspace = ensureWriteThreadForWorkspace as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('revise this', 'agent', {
      writeContext: {
        workspaceRoot: '/workspace/deepseek-gui',
        activeFilePath: '/workspace/deepseek-gui/draft.md',
        documentEpoch: 4,
        contentRevision: 2
      }
    })).resolves.toBe(false)

    expect(ensureWriteThreadForWorkspace).toHaveBeenCalledOnce()
    expect(ensureWriteThreadForWorkspace).toHaveBeenCalledWith(
      '/workspace/deepseek-gui',
      '/workspace/deepseek-gui/draft.md'
    )
    expect(state.queuedMessages).toEqual([])
  })

  it('rejects a Write send whose captured revision is no longer active', async () => {
    vi.stubGlobal('window', { kunGui: {} })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md',
      activeFileKind: 'text',
      documentEpoch: 4,
      contentRevision: 3,
      fileContent: 'new local edit',
      persistedContent: 'saved draft',
      saveStatus: 'dirty'
    })
    const { actions, state } = buildHarness()
    const ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing')
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = ensureWriteThreadForWorkspace as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('revise this', 'agent', {
      writeContext: {
        workspaceRoot: '/workspace/deepseek-gui',
        activeFilePath: '/workspace/deepseek-gui/draft.md',
        documentEpoch: 4,
        contentRevision: 2
      }
    })).resolves.toBe(false)

    expect(ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
  })

  it('ensures the captured Write file exactly once and sends on that thread', async () => {
    const provider = {
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
          codePromptPrefix: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md',
      activeFileKind: 'text',
      documentEpoch: 4,
      contentRevision: 2,
      fileContent: 'saved draft',
      persistedContent: 'saved draft',
      saveStatus: 'saved'
    })
    const { actions, state } = buildHarness()
    const ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing')
    state.route = 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = ensureWriteThreadForWorkspace as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('revise this', 'agent', {
      writeContext: {
        workspaceRoot: '/workspace/deepseek-gui',
        activeFilePath: '/workspace/deepseek-gui/draft.md',
        documentEpoch: 4,
        contentRevision: 2
      }
    })).resolves.toBe(true)

    expect(ensureWriteThreadForWorkspace).toHaveBeenCalledTimes(1)
    expect(ensureWriteThreadForWorkspace).toHaveBeenCalledWith(
      '/workspace/deepseek-gui',
      '/workspace/deepseek-gui/draft.md'
    )
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      expect.stringContaining('revise this'),
      expect.any(Object)
    )
  })

  it('fails closed when another thread becomes active while the Write ensure resolves', async () => {
    const provider = { sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', { kunGui: {} })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md',
      activeFileKind: 'text',
      documentEpoch: 4,
      contentRevision: 2,
      fileContent: 'saved draft',
      persistedContent: 'saved draft',
      saveStatus: 'saved'
    })
    const { actions, state } = buildHarness()
    state.route = 'write'
    state.busy = false
    const ensureWriteThreadForWorkspace = vi.fn(async () => {
      state.activeThreadId = 'thr_selected_elsewhere'
      return 'thr_existing'
    })
    state.ensureWriteThreadForWorkspace = ensureWriteThreadForWorkspace as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('revise this', 'agent', {
      writeContext: {
        workspaceRoot: '/workspace/deepseek-gui',
        activeFilePath: '/workspace/deepseek-gui/draft.md',
        documentEpoch: 4,
        contentRevision: 2
      }
    })).resolves.toBe(false)

    expect(ensureWriteThreadForWorkspace).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
    expect(state.blocks).toEqual([])
  })

  it.each([
    ['route', { route: 'chat' as const }],
    ['file', { activeFilePath: '/workspace/deepseek-gui/other.md' }],
    ['epoch', { documentEpoch: 5 }],
    ['revision', { contentRevision: 3 }]
  ])('rejects a Write send with a mismatched %s before ensuring a thread', async (_label, mismatch) => {
    const provider = { sendUserMessage: vi.fn() }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', { kunGui: {} })
    useWriteWorkspaceStore.setState({
      workspaceRoot: '/workspace/deepseek-gui',
      activeFilePath: '/workspace/deepseek-gui/draft.md',
      activeFileKind: 'text',
      documentEpoch: 4,
      contentRevision: 2,
      fileContent: 'saved draft',
      persistedContent: 'saved draft',
      saveStatus: 'saved',
      ...('activeFilePath' in mismatch ? { activeFilePath: mismatch.activeFilePath } : {}),
      ...('documentEpoch' in mismatch ? { documentEpoch: mismatch.documentEpoch } : {}),
      ...('contentRevision' in mismatch ? { contentRevision: mismatch.contentRevision } : {})
    })
    const { actions, state } = buildHarness()
    const ensureWriteThreadForWorkspace = vi.fn(async () => 'thr_existing')
    state.route = 'route' in mismatch ? mismatch.route : 'write'
    state.busy = false
    state.ensureWriteThreadForWorkspace = ensureWriteThreadForWorkspace as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('revise this', 'agent', {
      writeContext: {
        workspaceRoot: '/workspace/deepseek-gui',
        activeFilePath: '/workspace/deepseek-gui/draft.md',
        documentEpoch: 4,
        contentRevision: 2
      }
    })).resolves.toBe(false)

    expect(ensureWriteThreadForWorkspace).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).not.toHaveBeenCalled()
  })

  it('removes stale queued GUI plan messages before draining normal queued messages', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [
      {
        id: 'q-plan',
        text: 'internal plan prompt',
        mode: 'plan',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/one.md',
          planId: 'plan-1'
        }
      },
      {
        id: 'q-user',
        text: 'normal follow-up',
        mode: 'agent',
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }]
      }
    ]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).toHaveBeenCalledWith('normal follow-up', 'agent', {
      queued: expect.objectContaining({
        id: 'q-user',
        fileReferences: [{
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        }]
      })
    })
  })

  it('guides an eligible queued message into the active turn before removing it', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.queuedMessages = [{
      id: 'q-guide',
      text: 'use the compact logo instead',
      displayText: 'Use the compact logo instead',
      mode: 'agent'
    }]

    await expect(actions.guideQueuedMessage('q-guide')).resolves.toBe(true)

    expect(steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn_active',
      'use the compact logo instead',
      { displayText: 'Use the compact logo instead' }
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
  })

  it('keeps structured queued input when text-only guidance is ineligible', async () => {
    const steerUserMessage = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.queuedMessages = [{
      id: 'q-attachment',
      text: 'inspect this image',
      mode: 'agent',
      attachmentIds: ['attachment-1']
    }]

    await expect(actions.guideQueuedMessage('q-attachment')).resolves.toBe(false)

    expect(steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toHaveLength(1)
    expect(state.error).toBeTruthy()
  })

  it('keeps queued input when the active turn rejects guidance', async () => {
    const steerUserMessage = vi.fn(async () => {
      throw new Error('turn is no longer accepting steering')
    })
    registryMock.getProvider.mockReturnValue({ steerUserMessage })
    const { actions, state } = buildHarness()
    state.currentTurnId = 'turn_active'
    state.queuedMessages = [{
      id: 'q-race',
      text: 'do not lose this follow-up',
      mode: 'agent'
    }]

    await expect(actions.guideQueuedMessage('q-race')).resolves.toBe(false)

    expect(state.queuedMessages).toEqual([
      expect.objectContaining({ id: 'q-race', text: 'do not lose this follow-up' })
    ])
    expect(state.error).toContain('turn is no longer accepting steering')
  })

  it('sends the selected composer provider with the turn without switching the global runtime provider', async () => {
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
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2.5' } },
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M2' } },
          codePromptPrefix: ''
        })),
        setSettings,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerModel = 'mimo-v2.5'
    state.composerProviderId = 'xiaomi-token-plan'

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(true)

    expect(setSettings).not.toHaveBeenCalled()
    expect(restartRuntime).not.toHaveBeenCalled()
    expect(provider.connect).not.toHaveBeenCalled()
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello',
      expect.objectContaining({ model: 'mimo-v2.5', providerId: 'xiaomi-token-plan' })
    )
  })

  it('forwards GUI design canvas turns to the runtime provider', async () => {
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
          codePromptPrefix: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false

    await expect(actions.sendMessage('draw an architecture map', 'agent', {
      guiDesignCanvas: true
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'draw an architecture map',
      expect.objectContaining({ guiDesignCanvas: true })
    )
    expect(state.blocks.find((block) => block.kind === 'user')).toMatchObject({
      meta: { guiDesignCanvas: true }
    })
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
          codePromptPrefix: ''
        })),
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false

    await expect(actions.sendMessage('think carefully', 'agent', {
      reasoningEffort: 'high'
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'think carefully',
      expect.objectContaining({ reasoningEffort: 'high' })
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
          codePromptPrefix: ''
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

    await expect(actions.sendMessage('Please refine this edit', 'agent')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'Please refine this edit',
      expect.objectContaining({
        composerContexts: [expect.objectContaining({ id: 'selection', revision: 4, generation: 2 })]
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
          codePromptPrefix: ''
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
    expect(state.queuedMessages[0]?.composerContexts).toEqual([composerContext])

    state.busy = false
    const queued = state.queuedMessages[0]!
    await expect(actions.sendMessage(queued.text, queued.mode, { queued })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'Queued edit',
      expect.objectContaining({ composerContexts: [composerContext] })
    )
    expect(state.queuedMessages).toEqual([])
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
      codePromptPrefix: ''
    }))
    const restartRuntime = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-pro' } },
          codePromptPrefix: ''
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
          codePromptPrefix: ''
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

describe('chat-store-thread-actions subscribeThreadEventsLive', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('opens SSE with sinceSeq=0 in parallel with the fetch, so deltas flow in immediately', async () => {
    const subscribeCalls: Array<{ threadId: string; sinceSeq: number }> = []
    const getDetailCalls: string[] = []
    let capturedSink: ThreadEventSink | null = null

    const provider = {
      getThreadDetail: vi.fn(async (id: string) => {
        getDetailCalls.push(id)
        return { blocks: [], latestSeq: 0, threadStatus: 'idle' }
      }),
      subscribeThreadEvents: vi.fn(
        async (threadId: string, sinceSeq: number, sink: ThreadEventSink) => {
          subscribeCalls.push({ threadId, sinceSeq })
          capturedSink = sink
          return { streamId: 'stream_1' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true
    state.runtimeConnection = 'ready'

    await actions.subscribeThreadEventsLive('thr_live')

    // Both HTTP fetch and SSE are kicked off in parallel.
    expect(provider.getThreadDetail).toHaveBeenCalledWith('thr_live')
    expect(getDetailCalls).toEqual(['thr_live'])
    // SSE opens with sinceSeq=0 so all events replay.
    expect(subscribeCalls).toEqual([{ threadId: 'thr_live', sinceSeq: 0 }])
    // The chat view switches to the live thread.
    expect(state.activeThreadId).toBe('thr_live')
    // SSE-sourced deltas flow into the chat-store's live state.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'hello', seq: 1 }])
    expect(state.liveAssistant).toBe('hello')
    sink.onDeltas([{ kind: 'agent_message', text: ' world', seq: 2 }])
    expect(state.liveAssistant).toBe('hello world')
  })

  it('merges fetched history without overwriting live buffers, and takes lastSeq = max(fetched, current)', async () => {
    let capturedSink: ThreadEventSink | null = null
    const fetchedBlocks = [
      { id: 'b1', kind: 'user', text: 'prior turn' }
    ]
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: fetchedBlocks,
        latestSeq: 5,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
          capturedSink = sink
          return { streamId: 'stream_2' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_other'
    state.busy = false
    state.runtimeConnection = 'ready'
    state.blocks = []
    state.lastSeq = 0

    await actions.subscribeThreadEventsLive('thr_live')

    // Wait a microtask for the fetch promise to settle into the store.
    await new Promise((r) => setTimeout(r, 0))

    // Fetched blocks are written.
    expect(state.blocks.length).toBeGreaterThan(0)
    expect(state.blocks[0].id).toBe('b1')
    // SSE deltas that arrived during the fetch are preserved.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'live text', seq: 8 }])
    expect(state.liveAssistant).toBe('live text')
    // lastSeq is bumped to the max of fetched and current (SSE advanced it).
    expect(state.lastSeq).toBeGreaterThanOrEqual(8)
  })

  it('falls back gracefully when the fetch fails: SSE stays open and the error is surfaced', async () => {
    let capturedSink: ThreadEventSink | null = null
    const provider = {
      getThreadDetail: vi.fn(async () => {
        throw new Error('network down')
      }),
      subscribeThreadEvents: vi.fn(
        async (_threadId: string, _sinceSeq: number, sink: ThreadEventSink) => {
          capturedSink = sink
          return { streamId: 'stream_3' }
        }
      )
    }
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_other'
    state.busy = false
    state.runtimeConnection = 'ready'

    await actions.subscribeThreadEventsLive('thr_live')
    await new Promise((r) => setTimeout(r, 0))

    // SSE is still open and deltas still flow.
    const sink = expectSink(capturedSink)
    sink.onDeltas([{ kind: 'agent_message', text: 'still works', seq: 1 }])
    expect(state.liveAssistant).toBe('still works')
    // Error is surfaced.
    expect(state.error).toBeTruthy()
  })
})

describe('chat-store-thread-actions recoverActiveTurn settles interrupted work', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  function providerWith(threadStatus: string) {
    return {
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          { id: 'u1', kind: 'user', text: 'do the big thing' },
          { id: 'tool1', kind: 'tool', name: 'delegate_task', status: 'running' }
        ],
        latestSeq: 3,
        threadStatus,
        latestTurnId: 'turn_1',
        latestUserMessageId: 'u1'
      })),
      subscribeThreadEvents: vi.fn(async () => ({ streamId: 'stream_recover' }))
    }
  }

  it('settles a stuck running tool block when the server has already settled (#621)', async () => {
    const provider = providerWith('idle')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(false)
    expect(state.busy).toBe(false)
    // The interrupted delegate_task block is settled, so hasPendingRuntimeWork
    // is no longer true and queued/new messages can actually send.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('error')
  })

  it('keeps a running tool block when the server reports the thread still running', async () => {
    const provider = providerWith('running')
    registryMock.getProvider.mockReturnValue(provider)

    const { actions, state } = buildHarness()
    state.activeThreadId = 'thr_existing'
    state.busy = true

    const busy = await actions.recoverActiveTurn()

    expect(busy).toBe(true)
    // A genuinely live turn must keep its running block so the GUI reconnects.
    const tool = state.blocks.find((block) => block.kind === 'tool')
    expect(tool?.status).toBe('running')
  })
})

describe('chat-store-thread-actions createThread conversation mode', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
  })

  it('refuses to create a project thread when the workspace directory is missing', async () => {
    const createThreadProvider = vi.fn()
    const alertDialog = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: 'E:\\missing-project',
          agents: { kun: { subagents: { profiles: [] } } }
        })),
        workspaceDirectoryExists: vi.fn(async () => false),
        alertDialog
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.busy = false

    await actions.createThread({ workspaceRoot: 'E:\\missing-project', forceNew: true })

    expect(createThreadProvider).not.toHaveBeenCalled()
    expect(alertDialog).toHaveBeenCalledOnce()
    expect(state.error).toBeTruthy()
    expect(state.activeThreadId).toBeNull()
  })

  it('shows the missing workspace dialog only when sending a message', async () => {
    const alertDialog = vi.fn(async () => undefined)
    registryMock.getProvider.mockReturnValue({})
    vi.stubGlobal('window', {
      kunGui: {
        getSettings: vi.fn(async () => ({ workspaceRoot: 'E:\\missing-project' })),
        workspaceDirectoryExists: vi.fn(async () => false),
        alertDialog
      }
    })
    const { actions, state } = buildHarness()
    state.activeThreadId = null
    state.threads = []
    state.busy = false

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(false)

    expect(alertDialog).toHaveBeenCalledOnce()
    expect(state.error).toBeTruthy()
    expect(state.blocks).toEqual([])
  })

  it('creates a conversation thread bound to the auto-created timestamped workspace', async () => {
    const createdPath = '/home/alice/.local/share/Kun/conversations/20260626-153012'
    const selectThread = vi.fn(async () => undefined)
    const refreshThreads = vi.fn(async () => undefined)
    const createThreadProvider = vi.fn(async () => ({
      id: 'thr_new',
      title: 'New',
      updatedAt: '2026-06-26T15:30:12.000Z',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      workspace: createdPath,
      status: 'idle'
    }))
    registryMock.getProvider.mockReturnValue({ createThread: createThreadProvider })

    vi.stubGlobal('window', {
      kunGui: {
        platform: 'linux',
        getSettings: vi.fn(async () => ({
          version: 1,
          locale: 'en',
          theme: 'system',
          uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
          provider: { providers: [], apiKey: '', baseUrl: '', proxy: { enabled: false } },
          agents: { kun: { model: 'deepseek-v4-pro', apiKey: 'k', baseUrl: '' } },
          workspaceRoot: '/tmp/workspace',
          conversationWorkspaceRoot: '~/.local/share/Kun/conversations',
          log: { enabled: false, retentionDays: 7 },
          checkpointCleanup: { enabled: false, intervalDays: 3 },
          notifications: { turnComplete: true },
          appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
          keyboardShortcuts: { bindings: [] },
          write: { workspaces: [], defaultWorkspaceRoot: '', activeWorkspaceRoot: '' },
          claw: { channels: [], tasks: [], im: { workspaceRoot: '' }, enabled: false, skills: { extraDirs: [] } },
          schedule: { tasks: [], defaultWorkspaceRoot: '', skills: { extraDirs: [] } },
          workflow: { workflows: [] },
          terminal: { colors: {} },
          guiUpdate: { channel: 'stable' },
          codePromptPrefix: '',
          disabledSkillIds: []
        })),
        createConversationWorkspace: vi.fn(async () => ({ ok: true, path: createdPath }))
      }
    })

    const { actions, state } = buildHarness()
    state.selectThread = selectThread as never
    state.refreshThreads = refreshThreads as never

    await actions.createThread({ conversation: true })

    expect(window.kunGui.createConversationWorkspace).toHaveBeenCalled()
    expect(createThreadProvider).toHaveBeenCalledWith(expect.objectContaining({ workspace: createdPath }))
    expect(state.activeThreadId).toBe('thr_new')
    expect(selectThread).toHaveBeenCalledWith('thr_new')
    expect(refreshThreads).toHaveBeenCalled()
  })
})
