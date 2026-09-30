import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type i18next from 'i18next'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  fallbackComposerModel,
  mergeComposerPickList,
  persistComposerMode,
  persistComposerModel,
  persistComposerFastMode,
  persistComposerReasoningEffort,
  rememberThreadComposerMode,
  readStoredComposerFastMode,
  readStoredComposerModel,
  readStoredComposerReasoningEffort
} from './chat-store-helpers'
import { createAppActions } from './chat-store-app-actions'

const COMPOSER_MODEL_STORAGE_KEY = 'kun.composerModel'
const COMPOSER_PROVIDER_STORAGE_KEY = 'kun.composerProviderId'
const THREAD_COMPOSER_SELECTION_STORAGE_KEY = 'kun.threadComposerSelection.v1'
const THREAD_COMPOSER_MODE_STORAGE_KEY = 'kun.threadComposerMode.v1'
const COMPOSER_MODE_STORAGE_KEY = 'kun.composerMode'
const LEGACY_GRAPH_ORCHESTRATION_STORAGE_KEY = 'kun.graphOrchestration.v1'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

type FetchModelsResult =
  | {
      ok: true
      modelIds: string[]
      defaultModelId?: string
      defaultModel?: { providerId: string; modelId: string }
      modelGroups?: ChatState['composerModelGroups']
    }
  | { ok: false; message: string }

function buildHarness(fetchModelsResult: FetchModelsResult): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
  fetchUpstreamModels: ReturnType<typeof vi.fn>
} {
  let state = {
    activeThreadId: null,
    blocks: [],
    threads: [],
    composerMode: 'agent',
    composerModel: '',
    composerProviderId: '',
    composerHarnessId: '',
    composerReasoningEffort: 'max',
    composerPickList: mergeComposerPickList(false, []),
    composerModelGroups: []
  } as unknown as ChatState
  let loadPromise: Promise<void> | null = null
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state

  const fetchUpstreamModels = vi.fn(async () => fetchModelsResult)
  vi.stubGlobal('window', {
    kunGui: {
      fetchUpstreamModels,
      saveSettingsSilent: vi.fn(async () => state)
    }
  })

  const actions = createAppActions({
    set,
    get,
    i18n: { t: (key: string) => key, changeLanguage: vi.fn(async () => undefined) } as unknown as typeof i18next,
    persistComposerModel,
    persistComposerMode,
    persistComposerFastMode,
    persistComposerReasoningEffort,
    rememberThreadComposerMode,
    readStoredComposerModel,
    mergeComposerPickList,
    fallbackComposerModel,
    getComposerModelLoadPromise: () => loadPromise,
    setComposerModelLoadPromise: (promise) => {
      loadPromise = promise
    },
    applyTheme: () => undefined,
    applyUiFontScale: () => undefined,
    applyChatContentMaxWidth: () => undefined,
    applyCursorSpotlight: () => undefined,
    applyCursorSpotlightColor: () => undefined,
    applyDarkUiColors: () => undefined,
    applyWriteTypography: () => undefined,
    applyDocumentLocale: () => undefined,
    workspaceLabelFromPath: (workspaceRoot) => workspaceRoot,
    normalizeWorkspaceRoot: (workspaceRoot) => workspaceRoot?.trim() ?? ''
  })
  Object.assign(state, actions)

  return {
    state,
    fetchUpstreamModels,
    actions
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

describe('chat-store app actions composer model loading', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not replace a native Codex draft model with the Kun default during catalog refresh', async () => {
    const { state, actions } = buildHarness({ ok: true, modelIds: ['step-5-preview'],
      defaultModel: { providerId: 'stepfun', modelId: 'step-5-preview' },
      modelGroups: [{ providerId: 'stepfun', label: 'StepFun', modelIds: ['step-5-preview'] }] })
    state.composerHarnessId = 'codex'
    state.composerCredentialMode = 'native-login'
    state.composerModel = 'gpt-6.1-sol'
    state.composerReasoningEffort = 'low'
    state.composerProviderId = ''
    await actions.loadComposerModels()
    expect(state.composerModel).toBe('gpt-6.1-sol')
    expect(state.composerProviderId).toBe('')
    expect(state.composerHarnessId).toBe('codex')
    expect(state.composerReasoningEffort).toBe('low')
  })

  it('keeps the saved selection while loading and publishes catalog readiness with the groups', async () => {
    const models: FetchModelsResult = { ok: true, modelIds: ['saved-model'],
      modelGroups: [{ providerId: 'saved-provider', label: 'Saved', modelIds: ['saved-model'] }] }
    const { state, actions, fetchUpstreamModels } = buildHarness(models)
    state.composerModel = 'saved-model'
    state.composerProviderId = 'saved-provider'
    const waiting = deferred<FetchModelsResult>()
    fetchUpstreamModels.mockReturnValueOnce(waiting.promise)
    const load = actions.loadComposerModels()
    expect(state).toMatchObject({ composerModelCatalogStatus: 'loading',
      composerModel: 'saved-model', composerProviderId: 'saved-provider' })
    waiting.resolve(models)
    await load
    expect(state).toMatchObject({ composerModelCatalogStatus: 'ready', composerModelGroups: models.modelGroups,
      composerModel: 'saved-model', composerProviderId: 'saved-provider' })
  })

  it('distinguishes a confirmed empty catalog from a failed lookup', async () => {
    const { state, actions, fetchUpstreamModels } = buildHarness({ ok: false, message: 'No configured providers' })
    await actions.loadComposerModels()
    expect(state).toMatchObject({ composerModelCatalogStatus: 'ready', composerModelGroups: [] })
    state.composerProviderId = 'saved-provider'
    state.composerModel = 'saved-model'
    state.composerModelGroups = [{ providerId: 'saved-provider', label: 'Saved', modelIds: ['saved-model'] }]
    fetchUpstreamModels.mockRejectedValueOnce(new Error('Connection interrupted'))
    await expect(actions.loadComposerModels()).rejects.toThrow('Connection interrupted')
    expect(state).toMatchObject({ composerModelCatalogStatus: 'error', composerProviderId: 'saved-provider',
      composerModel: 'saved-model', composerModelGroups: [{ providerId: 'saved-provider' }] })
  })

  it('clears Kun plan and Graph intent when choosing an external Agent without rewriting queued turns', () => {
    const harness = buildHarness({ ok: true, modelIds: [] })
    harness.state.composerMode = 'plan'
    harness.state.composerOrchestration = 'graph'
    const queued = [{ id: 'q', text: 'Design next', harnessId: 'kun', agentSurface: 'design' as const }]
    harness.state.queuedMessages = queued
    harness.actions.setComposerHarness('codex', 'native-login')
    expect(harness.state).toMatchObject({ composerHarnessId: 'codex', composerMode: 'agent', composerOrchestration: 'direct' })
    expect(harness.state.queuedMessages).toBe(queued)
    expect(harness.state.queuedMessages[0].harnessId).toBe('kun')
  })

  it.each(['thread', 'provider'] as const)('clamps restored Kun execution modes for an unpinned %s Agent', (source) => {
    const { state, actions } = buildHarness({ ok: true, modelIds: [] })
    if (source === 'thread') {
      state.activeThreadId = 'thread-agent'
      state.threads = [{ id: 'thread-agent', harnessId: 'codex' }] as ChatState['threads']
    } else {
      state.composerProviderId = 'subscription'
      state.composerModelGroups = [{ providerId: 'subscription', label: 'Native', kind: 'agent-sdk', modelIds: [] }]
    }
    actions.setComposerMode('auto')
    actions.setComposerOrchestration('graph')
    expect(state.composerMode).toBe('agent')
    expect(state.composerOrchestration).toBe('direct')
    actions.setComposerHarness('kun', 'provider')
    actions.setComposerMode('plan')
    actions.setComposerOrchestration('graph')
    expect(state.composerMode).toBe('plan')
    expect(state.composerOrchestration).toBe('graph')
  })

  it('keeps native model picks out of Kun defaults and honors an explicitly cleared provider', () => {
    const harness = buildHarness({ ok: true, modelIds: [] })
    harness.state.composerHarnessId = 'codex'
    harness.state.composerCredentialMode = 'native-login'
    harness.state.composerModelGroups = [{ providerId: 'http-provider', label: 'HTTP', modelIds: ['shared-model'] }]
    harness.actions.setComposerModel('shared-model', '')
    expect(harness.state.composerProviderId).toBe('')
    expect(window.kunGui.saveSettingsSilent).not.toHaveBeenCalled()
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBeNull()
    harness.state.composerHarnessId = 'kun'
    harness.actions.setComposerModel('shared-model')
    expect(harness.state.composerProviderId).toBe('http-provider')
  })

  it('allows switching a chat with image history from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = [{
      kind: 'user',
      id: 'user-1',
      text: 'describe this',
      meta: { attachments: [{ id: 'att-1', kind: 'image' }] }
    }] as ChatState['blocks']
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'vision-model',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(JSON.parse(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')).toEqual({
      'thread-a': { model: 'text-model', providerId: 'test-provider', source: 'user' }
    })
    expect(window.kunGui.saveSettingsSilent).not.toHaveBeenCalled()
  })

  it('allows switching a text-only chat from vision to text-only (issue #579)', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    // A plain text conversation must not pin the picker to vision models.
    state.blocks = [
      { kind: 'user', id: 'user-1', text: 'hello' },
      { kind: 'assistant', id: 'assistant-1', text: 'hi there' }
    ] as ChatState['blocks']
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
    expect(state.composerProviderId).toBe('test-provider')
  })

  it('allows switching a document-only chat from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    // Documents are text-extracted, so they don't require a vision model.
    state.blocks = [{
      kind: 'user',
      id: 'user-1',
      text: 'summarize',
      meta: { attachments: [{ id: 'doc-1', kind: 'document' }] }
    }] as ChatState['blocks']
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
  })

  it('allows switching an empty chat from vision to text-only', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'vision-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = []
    state.composerModel = 'vision-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('text-model', 'test-provider')

    expect(state.composerModel).toBe('text-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('text-model')
    expect(window.kunGui.saveSettingsSilent).toHaveBeenCalledWith({
      agents: { kun: { model: 'text-model', providerId: 'test-provider' } }
    })
  })

  it('keeps an extension provider binding out of legacy built-in provider settings', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['extension-model'],
      defaultModelId: 'extension-model',
      modelGroups: []
    })
    state.activeThreadId = null
    state.blocks = []
    state.composerModelGroups = [{
      providerId: 'ext-provider-runtime-id',
      label: 'Extension Provider',
      modelIds: ['extension-model'],
      accountId: 'account-extension-1',
      extensionProvider: {
        extensionId: 'acme.models',
        extensionVersion: '1.0.0',
        localProviderId: 'models'
      }
    }]

    actions.setComposerModel('extension-model', 'ext-provider-runtime-id')

    expect(state.composerModel).toBe('extension-model')
    expect(state.composerProviderId).toBe('ext-provider-runtime-id')
    expect(window.kunGui.saveSettingsSilent).not.toHaveBeenCalled()
  })

  it('allows switching an active chat from text-only to vision', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['vision-model', 'text-model'],
      defaultModelId: 'text-model',
      modelGroups: []
    })
    state.route = 'chat'
    state.blocks = [{ kind: 'user', id: 'user-1', text: 'hello' }] as ChatState['blocks']
    state.composerModel = 'text-model'
    state.composerProviderId = 'test-provider'
    state.composerModelGroups = [{
      providerId: 'test-provider',
      label: 'Test',
      modelIds: ['vision-model', 'text-model'],
      modelProfiles: {
        'vision-model': {
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        },
        'text-model': {
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    }]

    actions.setComposerModel('vision-model', 'test-provider')

    expect(state.composerModel).toBe('vision-model')
    expect(state.composerProviderId).toBe('test-provider')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('vision-model')
  })

  it('does not overwrite a stored custom model when only fallback models are available', async () => {
    localStorage.setItem(COMPOSER_MODEL_STORAGE_KEY, 'MiniMax-M2')
    const { actions, state } = buildHarness({
      ok: false,
      message: 'upstream unavailable'
    })

    await actions.loadComposerModels()

    expect(state.composerModel).toBe('deepseek-v4-pro')
    expect(localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)).toBe('MiniMax-M2')
  })

  it('does not downgrade a user-selected per-thread model when the catalog refresh lacks it', async () => {
    // The user explicitly picked k3 on thread-a; a catalog refresh that
    // temporarily lacks k3 (partial load / upstream hiccup) must show the
    // fallback transiently without overwriting the stored user selection.
    localStorage.setItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY, JSON.stringify({
      'thread-a': { model: 'k3', providerId: 'test-provider', source: 'user' }
    }))
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: ['terra'],
      defaultModelId: 'terra',
      modelGroups: []
    })
    state.route = 'chat'
    state.activeThreadId = 'thread-a'
    state.threads = [{
      id: 'thread-a',
      title: 'Thread A',
      workspace: '/tmp/project',
      model: 'terra',
      status: 'idle',
      mode: 'agent',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]
    state.blocks = [{ kind: 'user', id: 'user-1', text: 'first message on terra' }] as ChatState['blocks']

    await actions.loadComposerModels()

    // Fallback shows transiently in state...
    expect(state.composerModel).toBe('terra')
    // ...but the stored user selection survives untouched.
    expect(JSON.parse(localStorage.getItem(THREAD_COMPOSER_SELECTION_STORAGE_KEY) ?? '{}')).toEqual({
      'thread-a': { model: 'k3', providerId: 'test-provider', source: 'user' }
    })

    // Once the catalog recovers k3, the user selection wins again.
    const second = buildHarness({
      ok: true,
      modelIds: ['terra', 'k3'],
      defaultModelId: 'terra',
      modelGroups: [{
        providerId: 'test-provider',
        label: 'Test',
        modelIds: ['terra', 'k3']
      }]
    })
    second.state.route = 'chat'
    second.state.activeThreadId = 'thread-a'
    second.state.threads = [state.threads[0]]
    second.state.blocks = [{ kind: 'user', id: 'user-1', text: 'first message on terra' }] as ChatState['blocks']

    await second.actions.loadComposerModels()

    expect(second.state.composerModel).toBe('k3')
  })

  it('records the return route only on first entry into settings', () => {
    const { actions, state } = buildHarness({
      ok: true,
      modelIds: [],
      modelGroups: []
    })
    state.route = 'design'
    state.settingsReturnRoute = 'chat'

    actions.openSettings('general')
    expect(state.route).toBe('settings')
    expect(state.settingsSection).toBe('general')
    expect(state.settingsReturnRoute).toBe('chat')

    // 设置页内部重复打开(切分类/再点设置)不得覆盖原返回目标。
    state.route = 'settings'
    actions.openSettings('providers')
    expect(state.route).toBe('settings')
    expect(state.settingsSection).toBe('providers')
    expect(state.settingsReturnRoute).toBe('chat')
  })

  it.each(['write', 'design', 'claw', 'plugins', 'extensions', 'schedule', 'workflow', 'chat'] as const)(
    'closeSettings restores the %s return route without re-selecting a thread',
    (returnRoute) => {
      const { actions, state } = buildHarness({
        ok: true,
        modelIds: [],
        modelGroups: []
      })
      state.route = returnRoute
      state.settingsReturnRoute = 'chat'
      state.activeThreadId = 'thread-a'

      actions.openSettings('general')
      expect(state.route).toBe('settings')
      const expectedRoute = returnRoute === 'design' ? 'chat' : returnRoute
      expect(state.settingsReturnRoute).toBe(expectedRoute)

      actions.closeSettings()

      expect(state.route).toBe(expectedRoute)
      // closeSettings 不经过 open*/setRoute 之外的重选会话逻辑,选择保持不变。
      expect(state.activeThreadId).toBe('thread-a')
    }
  )
})
