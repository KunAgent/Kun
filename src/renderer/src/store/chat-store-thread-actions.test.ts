import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadEventSink } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'
import { rendererRuntimeClient } from '../agent/runtime-client'

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
    composerModel: '',
    composerProviderId: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
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
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
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

  it('applies the selected composer provider before sending a turn', async () => {
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
    const saveSettingsSilent = vi.fn(async () => ({
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
        saveSettingsSilent,
        restartRuntime,
        logError: vi.fn(async () => undefined)
      }
    })
    const { actions, state } = buildHarness()
    state.busy = false
    state.composerModel = 'mimo-v2.5'
    state.composerProviderId = 'xiaomi-token-plan'

    await expect(actions.sendMessage('hello', 'agent')).resolves.toBe(true)

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'xiaomi-token-plan', model: 'mimo-v2.5' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello',
      expect.objectContaining({ model: 'mimo-v2.5' })
    )
  })

  it('applies an override provider before sending from the write route', async () => {
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
    const saveSettingsSilent = vi.fn(async () => ({
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
        saveSettingsSilent,
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

    expect(saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { providerId: 'minimax-token-plan', model: 'MiniMax-M3' } }
    })
    expect(restartRuntime).toHaveBeenCalledTimes(1)
    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'make a prototype',
      expect.objectContaining({ model: 'MiniMax-M3' })
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

describe('chat-store-thread-actions createThread conversation mode', () => {
  beforeEach(() => {
    rendererRuntimeClient.invalidateSettings()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    rendererRuntimeClient.invalidateSettings()
    vi.unstubAllGlobals()
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
