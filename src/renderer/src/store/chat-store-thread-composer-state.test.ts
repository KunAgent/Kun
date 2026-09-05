import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { BrowserStorageLike } from '../lib/browser-storage'
import {
  rememberThreadComposerMode,
  rememberThreadComposerSelection
} from './chat-store-helpers'
import {
  clearThreadSnapshotCache,
  getThreadSnapshot,
  snapshotThreadProjection
} from './thread-snapshot-cache'
import { resetThreadPrewarmState } from './thread-detail-prewarm'
import {
  resolveCatalogComposerSelection,
  resolveThreadComposerState,
  rememberCatalogComposerSelection
} from './chat-store-thread-composer-state'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import { createThreadActions } from './chat-store-thread-actions'

type ThreadDetail = {
  blocks: Array<{ kind: 'user' | 'assistant'; id: string; text: string }>
  latestSeq: number
  threadStatus: 'idle'
  model?: string
}

type Harness = {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
}

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function thread(
  id: string,
  overrides: Partial<NormalizedThread> = {}
): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: '',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle',
    ...overrides
  }
}

function buildHarness(): Harness {
  let state: ChatState
  state = {
    activeThreadId: null,
    blocks: [],
    busy: false,
    busyUnconfirmed: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    composerMode: 'agent',
    composerOrchestration: 'direct',
    composerPickList: [],
    composerModelGroups: [],
    composerProviderId: '',
    composerReasoningEffort: 'max',
    currentTurnId: null,
    currentTurnOrchestration: null,
    currentTurnUserId: null,
    error: null,
    extensionComposerContexts: [],
    lastSeq: 0,
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [],
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {}
  } as unknown as ChatState
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({ set, get, sseAbortRef: { current: null } })
  return { actions, state }
}

function detail(blocks: ThreadDetail['blocks'] = [], model = ''): ThreadDetail {
  return {
    blocks,
    latestSeq: blocks.length,
    threadStatus: 'idle',
    ...(model ? { model } : {})
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function expectComposerState(
  state: ChatState,
  expected: {
    composerMode: 'plan' | 'agent' | 'auto'
    composerModel: string
    composerProviderId: string
  }
): void {
  expect(state.composerMode).toBe(expected.composerMode)
  expect(state.composerModel).toBe(expected.composerModel)
  expect(state.composerProviderId).toBe(expected.composerProviderId)
}

function seedComposerPreferences(): void {
  rememberThreadComposerMode('thread-a', 'plan')
  rememberThreadComposerSelection('thread-a', 'model-a', 'provider-a', 'user')
  rememberThreadComposerMode('thread-b', 'agent')
  rememberThreadComposerSelection('thread-b', 'model-b', 'provider-b', 'user')
}

describe('thread composer state restoration', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    resetThreadPrewarmState()
    vi.stubGlobal('localStorage', new MemoryStorage())
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
  })

  afterEach(() => {
    resetThreadPrewarmState()
    clearThreadSnapshotCache()
    vi.unstubAllGlobals()
  })

  it('restores per-thread mode and model through cold-load round trips', async () => {
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.threads = [thread('thread-a'), thread('thread-b')]
    seedComposerPreferences()

    await actions.selectThread('thread-a')
    expectComposerState(state, {
      composerMode: 'plan',
      composerModel: 'model-a',
      composerProviderId: 'provider-a'
    })

    await actions.selectThread('thread-b')
    expectComposerState(state, {
      composerMode: 'agent',
      composerModel: 'model-b',
      composerProviderId: 'provider-b'
    })

    await actions.selectThread('thread-a')
    expectComposerState(state, {
      composerMode: 'plan',
      composerModel: 'model-a',
      composerProviderId: 'provider-a'
    })
  })

  it('resolves cached snapshots from durable thread preferences, not stale composer fields', async () => {
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(async () => detail()),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.threads = [thread('thread-a'), thread('thread-b')]

    await actions.selectThread('thread-a')
    state.composerMode = 'plan'
    state.composerModel = 'stale-cached-model'
    state.composerProviderId = 'stale-cached-provider'
    snapshotThreadProjection(state, 1)
    rememberThreadComposerMode('thread-a', 'agent')
    rememberThreadComposerSelection('thread-a', 'fresh-model', 'fresh-provider', 'user')

    await actions.selectThread('thread-b')
    expect(getThreadSnapshot('thread-a')).not.toBeNull()
    await actions.selectThread('thread-a')

    expectComposerState(state, {
      composerMode: 'agent',
      composerModel: 'fresh-model',
      composerProviderId: 'fresh-provider'
    })
  })

  it('projects the target thread preferences before its detail request finishes', async () => {
    const pending = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.threads = [thread('thread-a'), thread('thread-b')]
    seedComposerPreferences()
    state.activeThreadId = 'thread-a'
    state.composerMode = 'plan'
    state.composerModel = 'model-a'
    state.composerProviderId = 'provider-a'

    const selecting = actions.selectThread('thread-b')

    expect(state.activeThreadId).toBe('thread-b')
    expectComposerState(state, {
      composerMode: 'agent',
      composerModel: 'model-b',
      composerProviderId: 'provider-b'
    })

    pending.resolve(detail())
    await selecting
    expectComposerState(state, {
      composerMode: 'agent',
      composerModel: 'model-b',
      composerProviderId: 'provider-b'
    })
  })

  it('keeps a newer thread selection when an older detail response lands', async () => {
    const first = deferred<ThreadDetail>()
    const second = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn((id: string) => id === 'thread-a' ? first.promise : second.promise),
      subscribeThreadEvents: vi.fn(async () => undefined)
    })
    const { actions, state } = buildHarness()
    state.threads = [thread('thread-a'), thread('thread-b')]
    seedComposerPreferences()

    const selectFirst = actions.selectThread('thread-a')
    const selectSecond = actions.selectThread('thread-b')
    second.resolve(detail())
    await selectSecond
    first.resolve(detail())
    await selectFirst

    expect(state.activeThreadId).toBe('thread-b')
    expectComposerState(state, {
      composerMode: 'agent',
      composerModel: 'model-b',
      composerProviderId: 'provider-b'
    })
  })

  it('resolves the current thread from the catalog state after a switch', () => {
    const { state } = buildHarness()
    seedComposerPreferences()
    state.activeThreadId = 'thread-b'
    state.threads = [thread('thread-a'), thread('thread-b')]
    state.blocks = [{ kind: 'user', id: 'u-b', text: 'on B' }]

    const selection = resolveCatalogComposerSelection(state, {
      runtimeDefaultModel: 'model-a',
      runtimeDefaultProviderId: 'provider-a'
    })

    expect(selection).toEqual({ model: 'model-b', providerId: 'provider-b' })
  })

  it('keeps a user selection durable while the catalog temporarily lacks it', () => {
    const { state } = buildHarness()
    rememberThreadComposerSelection('thread-a', 'model-a', 'provider-a', 'user')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a', { model: 'runtime-model' })]
    state.blocks = [{ kind: 'user', id: 'u-a', text: 'on A' }]
    state.composerPickList = ['runtime-model']
    state.composerModelGroups = [{
      providerId: 'provider-runtime',
      label: 'Runtime',
      modelIds: ['runtime-model']
    }]

    const selection = resolveCatalogComposerSelection(state)

    expect(selection).toEqual({ model: 'runtime-model', providerId: 'provider-runtime' })
    expect(state.composerPickList).toContain('runtime-model')
    expect(localStorage.getItem('kun.threadComposerSelection.v1')).toContain('model-a')
  })

  it('restores legacy mode and model metadata when no per-thread preference exists', () => {
    const { state } = buildHarness()
    const legacy = thread('thread-legacy', { mode: 'plan', model: 'legacy-model' })
    state.threads = [legacy]
    state.composerPickList = ['legacy-model']
    state.composerModelGroups = [{
      providerId: 'provider-legacy',
      label: 'Legacy',
      modelIds: ['legacy-model']
    }]

    const restored = resolveThreadComposerState(state, legacy)

    expect(restored.composerMode).toBe('plan')
    expect(restored.composerModel).toBe('legacy-model')
    expect(restored.composerProviderId).toBe('provider-legacy')
  })

  it('uses the runtime default for a fresh thread instead of inheriting the previous plan mode', () => {
    const { state } = buildHarness()
    rememberThreadComposerMode('thread-a', 'plan')
    const fresh = thread('thread-new', { model: 'runtime-default' })
    state.threads = [fresh]
    state.composerPickList = ['runtime-default']
    state.composerModelGroups = [{
      providerId: 'provider-runtime',
      label: 'Runtime',
      modelIds: ['runtime-default']
    }]

    const restored = resolveThreadComposerState(state, fresh, {
      hasUserMessages: false,
      runtimeDefaultModel: 'runtime-default',
      runtimeDefaultProviderId: 'provider-runtime'
    })

    expect(restored.composerMode).toBe('agent')
    expect(restored.composerModel).toBe('runtime-default')
    expect(restored.composerProviderId).toBe('provider-runtime')
  })

  it('keeps same-name models bound to their stored provider and reasoning effort', () => {
    const { state } = buildHarness()
    rememberThreadComposerSelection('thread-a', 'shared-model', 'provider-b', 'user')
    state.threads = [thread('thread-a')]
    state.composerPickList = ['shared-model']
    state.composerModelGroups = [
      {
        providerId: 'provider-a',
        label: 'Provider A',
        modelIds: ['shared-model'],
        modelProfiles: {
          'shared-model': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            reasoning: {
              supportedEfforts: ['low'],
              defaultEffort: 'low',
              requestProtocol: 'openai-chat-completions'
            }
          }
        }
      },
      {
        providerId: 'provider-b',
        label: 'Provider B',
        modelIds: ['shared-model'],
        modelProfiles: {
          'shared-model': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text'],
            reasoning: {
              supportedEfforts: ['high'],
              defaultEffort: 'high',
              requestProtocol: 'openai-chat-completions'
            }
          }
        }
      }
    ]

    const restored = resolveThreadComposerState(state, state.threads[0])

    expect(restored.composerModel).toBe('shared-model')
    expect(restored.composerProviderId).toBe('provider-b')
    expect(restored.composerReasoningEffort).toBe('high')
  })

  it('prefers a thread provider identity when no stored composer selection exists', () => {
    const { state } = buildHarness()
    state.threads = [thread('thread-legacy', {
      model: 'shared-model',
      providerId: 'provider-b'
    })]
    state.composerPickList = ['shared-model']
    state.composerModelGroups = [
      {
        providerId: 'provider-a',
        label: 'Provider A',
        modelIds: ['shared-model']
      },
      {
        providerId: 'provider-b',
        label: 'Provider B',
        modelIds: ['shared-model']
      }
    ]

    const restored = resolveThreadComposerState(state, state.threads[0])

    expect(restored.composerModel).toBe('shared-model')
    expect(restored.composerProviderId).toBe('provider-b')
  })

  it('does not persist a same-model provider fallback over an explicit user selection', () => {
    const { state } = buildHarness()
    rememberThreadComposerSelection('thread-a', 'shared-model', 'provider-b', 'user')
    state.activeThreadId = 'thread-a'
    state.threads = [thread('thread-a')]
    state.composerPickList = ['shared-model']
    state.composerModelGroups = [{
      providerId: 'provider-a',
      label: 'Provider A',
      modelIds: ['shared-model']
    }]

    rememberCatalogComposerSelection(state, {
      model: 'shared-model',
      providerId: 'provider-a'
    })

    expect(localStorage.getItem('kun.threadComposerSelection.v1')).toContain('provider-b')
  })

  it('restores a legacy thread provider after a temporary same-model fallback', () => {
    const { state } = buildHarness()
    const legacy = thread('thread-legacy', {
      model: 'shared-model',
      providerId: 'provider-b'
    })
    state.activeThreadId = legacy.id
    state.threads = [legacy]
    state.composerPickList = ['shared-model']
    state.composerModelGroups = [
      {
        providerId: 'provider-a',
        label: 'Provider A',
        modelIds: ['shared-model']
      },
      {
        providerId: 'provider-b',
        label: 'Provider B',
        modelIds: ['shared-model']
      }
    ]

    rememberCatalogComposerSelection(state, {
      model: 'shared-model',
      providerId: 'provider-b'
    })
    state.composerModelGroups = state.composerModelGroups.filter(
      (group) => group.providerId === 'provider-a'
    )
    rememberCatalogComposerSelection(state, {
      model: 'shared-model',
      providerId: 'provider-a'
    })
    expect(localStorage.getItem('kun.threadComposerSelection.v1')).toContain('provider-b')

    state.composerModelGroups = [
      {
        providerId: 'provider-a',
        label: 'Provider A',
        modelIds: ['shared-model']
      },
      {
        providerId: 'provider-b',
        label: 'Provider B',
        modelIds: ['shared-model']
      }
    ]
    const restored = resolveThreadComposerState(state, legacy)

    expect(restored.composerModel).toBe('shared-model')
    expect(restored.composerProviderId).toBe('provider-b')
  })

  it('does not persist a fallback over a legacy thread provider before it is stored', () => {
    const { state } = buildHarness()
    state.activeThreadId = 'thread-legacy'
    state.threads = [thread('thread-legacy', {
      model: 'shared-model',
      providerId: 'provider-b'
    })]
    state.composerPickList = ['shared-model']
    state.composerModelGroups = [{
      providerId: 'provider-a',
      label: 'Provider A',
      modelIds: ['shared-model']
    }]

    rememberCatalogComposerSelection(state, {
      model: 'shared-model',
      providerId: 'provider-a'
    })

    expect(localStorage.getItem('kun.threadComposerSelection.v1')).toBeNull()
  })
})
