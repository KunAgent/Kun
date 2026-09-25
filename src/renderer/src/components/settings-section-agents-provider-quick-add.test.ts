import {
  act,
  afterEach,
  baseCtx,
  beforeEach,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe, expect,
  findButton,
  getModelProviderPreset,
  instanceText,
  it,
  modelProviderPresetProfile,
  renderProviders,
  rendererText,
  resetSharedProviderMutationCoordinatorForTests,
  vi,
  type ModelProviderProbeResult,
  type ModelProviderProfileV1,
  type ModelsDevCatalogResult,
  type ReactTestRenderer
} from './settings-section-agents.test-support'

// Quick-add flow (plan B3): preset cards open the compact panel, submission
// commits the credential, discovers models non-interactively, and only then
// switches the Kun provider/model selection.
describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  describe('provider settings workspace', () => {
    const probeModelProvider = vi.fn(async (): Promise<ModelProviderProbeResult> => ({
      ok: true as const,
      latencyMs: 18,
      modelIds: ['model-a', 'model-b']
    }))
    const fetchModelsDevCatalog = vi.fn(async (): Promise<ModelsDevCatalogResult> => ({
      status: 'ok' as const,
      providerKey: 'test-provider',
      providerName: 'Test Provider',
      matchMode: 'catalog' as const,
      stale: false,
      models: [
        {
          id: 'model-a',
          name: 'Model A',
          description: 'Multimodal catalog metadata',
          inputModalities: ['text', 'image', 'audio'],
          outputModalities: ['text'],
          contextWindowTokens: 128_000,
          maxOutputTokens: 16_000,
          toolCalling: true
        },
        {
          id: 'catalog-only',
          inputModalities: ['text'],
          outputModalities: ['text'],
          toolCalling: false
        }
      ]
    }))
    const openExternal = vi.fn(async () => undefined)
    let mountedRenderers: ReactTestRenderer[] = []

    beforeEach(() => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      probeModelProvider.mockClear()
      fetchModelsDevCatalog.mockClear()
      openExternal.mockClear()
      mountedRenderers = []
      vi.stubGlobal('window', {
        kunGui: {
          probeModelProvider,
          fetchModelsDevCatalog,
          cursorSubscriptionDiscover: vi.fn(async () => ({
            account: { apiKeyName: 'test-key' },
            models: []
          })),
          geminiCliSubscriptionStatus: vi.fn(async () => ({ installed: false })),
          geminiCliSubscriptionModels: vi.fn(async () => []),
          geminiSubscriptionCliStatus: vi.fn(async () => ({ installed: false })),
          geminiSubscriptionModels: vi.fn(async () => ({ models: [] })),
          onGeminiSubscriptionCliProgress: vi.fn(() => () => undefined),
          openExternal,
          claudeSubscriptionStatus: vi.fn(async () => ({ loggedIn: false })),
          claudeSubscriptionProbe: vi.fn(async () => ({ ok: false as const, message: 'n/a' })),
          claudeSubscriptionSdkStatus: vi.fn(async () => ({ installed: false })),
          claudeSubscriptionModels: vi.fn(async () => []),
          onClaudeSubscriptionSdkProgress: vi.fn(() => () => undefined)
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        setTimeout: (callback: () => void) => {
          callback()
          return 1
        },
        clearTimeout: vi.fn()
      })
      vi.stubGlobal('document', {
        body: { style: { overflow: '' } },
        activeElement: null
      })
    })

    afterEach(async () => {
      await act(async () => {
        for (const renderer of mountedRenderers) renderer.unmount()
      })
      resetSharedProviderMutationCoordinatorForTests()
      vi.unstubAllGlobals()
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    })

    const mountProviders = async (ctx: Record<string, unknown>): Promise<ReactTestRenderer> => {
      const renderer = await renderProviders(ctx)
      mountedRenderers.push(renderer)
      return renderer
    }

    const installDraftRegistry = (): ReturnType<typeof vi.fn> => {
      let revision = 0
      let providers: Array<Record<string, unknown>> = []
      const snapshot = () => ({
        schemaVersion: 1,
        revision,
        providers,
        defaultProviderId: providers[0]?.id,
        defaultAccountId: providers[0]?.accountId,
        defaultModel: providers[0]?.selectedModel,
        proxy: { enabled: false, url: '' },
        routePools: [],
        localModelGateway: { enabled: false }
      })
      const runtimeRequest = vi.fn(async (path: string, method = 'GET', body?: string) => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
        }
        if (path === '/v1/model-connections/connect' && method === 'POST') {
          const request = JSON.parse(body ?? '{}') as Record<string, unknown>
          revision += 1
          providers = [{
            id: request.id,
            accountId: `account:${String(request.id)}`,
            name: request.name,
            kind: request.kind,
            authType: request.authType,
            baseUrl: request.baseUrl,
            endpointFormat: request.endpointFormat,
            configured: true,
            models: request.models,
            selectedModel: request.selectedModel
          }]
          return { ok: true, status: 201, body: JSON.stringify(snapshot()) }
        }
        if (path.startsWith('/v1/model-connections/') && method === 'PATCH') {
          const id = decodeURIComponent(path.slice('/v1/model-connections/'.length))
          const request = JSON.parse(body ?? '{}') as Record<string, unknown>
          revision += 1
          providers = providers.map((provider) => provider.id === id
            ? {
                ...provider,
                ...(Array.isArray(request.models) ? { models: request.models } : {}),
                ...(typeof request.selectedModel === 'string'
                  ? { selectedModel: request.selectedModel }
                  : {})
              }
            : provider)
          return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
        }
        if (path.endsWith('/credential/fence') && method === 'POST') {
          revision += 1
          return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
        }
        if (path.endsWith('/credential/commit') && method === 'POST') {
          revision += 1
          providers = providers.map((provider) => ({ ...provider, credentialStatus: 'ready' }))
          return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
        }
        if (path.endsWith('/credential') && (method === 'PUT' || method === 'DELETE')) {
          revision += 1
          return { ok: true, status: 200, body: JSON.stringify(snapshot()) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      return runtimeRequest
    }

    const submitQuickAdd = async (renderer: ReactTestRenderer, presetLabel: string, apiKey = 'sk-test'): Promise<void> => {
      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      const entry = dialog.findAllByType('button')
        .find((button) => instanceText(button).includes(presetLabel))
      await act(async () => entry!.props.onClick())

      const quickAdd = renderer.root.findByProps({ 'aria-labelledby': 'provider-quick-add-title' })
      const apiKeyInput = quickAdd.findAllByType('input')
        .find((input) => input.props.type === 'password')
      await act(async () => apiKeyInput!.props.onChange({ target: { value: apiKey } }))
      const submitButton = quickAdd.findAllByType('button')
        .find((button) => instanceText(button).trim() === 'Add provider')
      await act(async () => {
        submitButton!.props.onClick()
        for (let index = 0; index < 16; index += 1) await Promise.resolve()
      })
    }

    it('discovers quick-added models before switching the selection', async () => {
      installDraftRegistry()
      const settings = defaultModelProviderSettings()
      const update = vi.fn()
      probeModelProvider.mockResolvedValueOnce({
        ok: true,
        latencyMs: 7,
        modelIds: Array.from({ length: 30 }, (_, index) => `probe-${index + 1}`)
      })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: settings,
        kun: { ...defaultKunRuntimeSettings(), providerId: 'deepseek', model: 'deepseek-chat' },
        update
      })

      await submitQuickAdd(renderer, 'OpenAI API', 'sk-openai')

      const savedSnapshots = update.mock.calls
        .map((call) => (call[0] as { provider?: { providers?: ModelProviderProfileV1[] } }).provider?.providers)
        .filter((providers) => providers?.some((provider) => provider.id === 'openai-api'))
      const savedOpenAi = savedSnapshots.at(-1)?.find((provider) => provider.id === 'openai-api')
      expect(savedOpenAi?.models).toHaveLength(24)
      expect(savedOpenAi?.models[0]).toBe('probe-1')
      expect(update.mock.calls.some((call) => {
        const kun = (call[0] as { agents?: { kun?: { providerId?: string; model?: string } } }).agents?.kun
        return kun?.providerId === 'openai-api' && kun.model === 'probe-1'
      })).toBe(true)
    })

    it('keeps the current selection when quick-add discovery fails', async () => {
      installDraftRegistry()
      const settings = defaultModelProviderSettings()
      const update = vi.fn()
      probeModelProvider.mockResolvedValueOnce({ ok: false, message: 'upstream boom' })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: settings,
        kun: { ...defaultKunRuntimeSettings(), providerId: 'deepseek', model: 'deepseek-chat' },
        update
      })

      await submitQuickAdd(renderer, 'OpenAI API', 'sk-openai')

      const savedProviders = update.mock.calls
        .map((call) => (call[0] as { provider?: { providers?: ModelProviderProfileV1[] } }).provider?.providers)
        .find((providers) => providers?.some((provider) => provider.id === 'openai-api'))
      expect(savedProviders?.some((provider) => provider.id === 'openai-api')).toBe(true)
      expect(probeModelProvider).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'openai-api' })
      )
      expect(update.mock.calls.every((call) =>
        (call[0] as { agents?: { kun?: { providerId?: string } } }).agents?.kun?.providerId !== 'openai-api'
      )).toBe(true)
    })

    it('continues to refresh a pay-as-you-go preset without creating a duplicate account', async () => {
      const settings = defaultModelProviderSettings()
      const xiaomi = getModelProviderPreset('xiaomi')!
      const existing = {
        ...modelProviderPresetProfile(xiaomi, 'sk-xiaomi'),
        name: 'Work Xiaomi',
        models: [...modelProviderPresetProfile(xiaomi).models, 'private-model']
      }
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, existing] },
        kun: { ...defaultKunRuntimeSettings(), providerId: existing.id, model: existing.models[0] },
        update
      })

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      const xiaomiEntry = dialog.findAllByType('button')
        .find((button) =>
          instanceText(button).includes('Xiaomi') && instanceText(button).includes('1 accounts'))
      expect(xiaomiEntry).toBeDefined()
      const updatePresetButton = dialog.findAllByType('button')
        .find((button) => instanceText(button).trim() === 'Update preset')
      await act(async () => {
        updatePresetButton!.props.onClick()
        await Promise.resolve()
      })

      expect(update).toHaveBeenCalledTimes(1)
      const savedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const savedXiaomi = savedProviders.filter((provider) => provider.id === 'xiaomi')
      expect(savedXiaomi).toHaveLength(1)
      expect(savedXiaomi[0]).toMatchObject({
        name: 'Work Xiaomi',
        apiKey: 'sk-xiaomi',
        models: expect.arrayContaining(['private-model']),
        presetSource: { presetId: 'xiaomi', mode: 'api' }
      })
      expect(rendererText(renderer)).not.toContain('Unsaved')
    })
  })
})
