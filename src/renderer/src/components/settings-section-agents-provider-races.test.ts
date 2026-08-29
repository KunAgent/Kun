import {
  ProviderModelsManager,
  ProvidersSettingsSection,
  act,
  afterEach,
  baseCtx,
  beforeEach,
  createElement,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe, expect, it,
  renderProviders,
  resetSharedProviderMutationCoordinatorForTests,
  vi,
  type AntigravitySubscriptionModelCatalog, type ClaudeSubscriptionProbeResult,
  type CursorSubscriptionModel,
  type ModelProviderProbeResult,
  type ModelProviderProfileV1,
  type ModelsDevCatalogResult,
  type ReactTestRenderer
} from './settings-section-agents.test-support'


describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  describe('provider settings workspace', () => {
    const antigravityCatalog: AntigravitySubscriptionModelCatalog = {
      models: [
        {
          id: 'gemini-3.6-flash',
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        },
        {
          id: 'claude-sonnet-4-6',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        },
        {
          id: 'gpt-oss-120b',
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      ]
    }
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
          description: 'Vision-capable catalog metadata',
          inputModalities: ['text', 'image'],
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
    const claudeSubscriptionStatus = vi.fn(async () => ({
      loggedIn: true,
      source: 'cli' as const
    }))
    const claudeSubscriptionProbe = vi.fn(async (): Promise<ClaudeSubscriptionProbeResult> => ({
      ok: true as const,
      latencyMs: 23
    }))
    const geminiCliSubscriptionStatus = vi.fn(async () => ({
      installed: true,
      authenticated: true,
      path: '/usr/local/bin/gemini',
      credentialSource: 'keychain' as const
    }))
    const geminiCliSubscriptionModels = vi.fn(async () => [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash'
    ])
    const geminiSubscriptionCliStatus = vi.fn(async () => ({
      installed: true,
      path: '/Applications/Kun.app/Contents/Resources/agy'
    }))
    const geminiSubscriptionModels = vi.fn(async () => antigravityCatalog)
    const cursorSubscriptionDiscover = vi.fn(async (): Promise<{
      account: {
        apiKeyName: string
        userEmail?: string
        userFirstName?: string
        userLastName?: string
      }
      models: CursorSubscriptionModel[]
    }> => ({
      account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
      models: [{ id: 'auto', displayName: 'Auto' }]
    }))
    const openExternal = vi.fn(async () => undefined)
    let mountedRenderers: ReactTestRenderer[] = []

    beforeEach(() => {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      probeModelProvider.mockClear()
      fetchModelsDevCatalog.mockClear()
      claudeSubscriptionStatus.mockClear()
      claudeSubscriptionProbe.mockReset()
      claudeSubscriptionProbe.mockResolvedValue({ ok: true, latencyMs: 23 })
      geminiCliSubscriptionStatus.mockClear()
      geminiCliSubscriptionModels.mockClear()
      geminiSubscriptionCliStatus.mockClear()
      geminiSubscriptionModels.mockClear()
      cursorSubscriptionDiscover.mockReset()
      cursorSubscriptionDiscover.mockResolvedValue({
        account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
        models: [{ id: 'auto', displayName: 'Auto' }]
      })
      openExternal.mockClear()
      mountedRenderers = []
      vi.stubGlobal('window', {
        kunGui: {
          probeModelProvider,
          fetchModelsDevCatalog,
          cursorSubscriptionDiscover,
          geminiCliSubscriptionStatus,
          geminiCliSubscriptionModels,
          geminiSubscriptionCliStatus,
          geminiSubscriptionModels,
          onGeminiSubscriptionCliProgress: vi.fn(() => () => undefined),
          openExternal,
          claudeSubscriptionStatus,
          claudeSubscriptionProbe,
          claudeSubscriptionSdkStatus: vi.fn(async () => ({ installed: true })),
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
            useProxy: false,
            configured: true,
            models: request.models,
            selectedModel: request.selectedModel
          }]
          return { ok: true, status: 201, body: JSON.stringify(snapshot()) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      return runtimeRequest
    }

    it('keeps a custom provider rename while a stale registry event races the canonical PATCH', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: 'sk-custom',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        kind: 'http',
        models: ['custom-model'],
        modelProfiles: {
          'custom-model': {
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text']
          }
        }
      } satisfies ModelProviderProfileV1
      const sharedProvider = (name: string) => ({
        id: target.id,
        accountId: `account:${target.id}`,
        name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        useProxy: false,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      })
      const snapshot = (revision: number, name: string) => ({
        schemaVersion: 1,
        proxyRoutingVersion: 1,
        revision,
        providers: [sharedProvider(name)],
        defaultProviderId: target.id,
        defaultAccountId: `account:${target.id}`,
        defaultModel: target.models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let resolveStaleEvent!: (value: { ok: true; status: 200; body: string }) => void
      const staleEvent = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveStaleEvent = resolve
      })
      let eventRequests = 0
      const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
        if (path.includes('/events?')) {
          eventRequests += 1
          if (eventRequests === 1) return staleEvent
          return new Promise<never>(() => undefined)
        }
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(snapshot(1, target.name)) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          expect(JSON.parse(body ?? '{}')).toMatchObject({
            expectedRevision: 1,
            name: 'Renamed Provider'
          })
          return { ok: true, status: 200, body: JSON.stringify(snapshot(2, 'Renamed Provider')) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const update = vi.fn()
      const initialCtx = {
        ...baseCtx(),
        provider: {
          ...settings,
          providers: [
            ...settings.providers.filter((provider) => provider.id !== 'opencode-free'),
            target
          ]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saved',
        update
      }
      const renderer = await mountProviders(initialCtx)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      const nameInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === target.name)
      expect(nameInput).toBeTruthy()
      await act(async () => nameInput!.props.onChange({ target: { value: 'Renamed Provider' } }))
      expect(update).toHaveBeenCalledOnce()
      const localPatch = update.mock.calls[0]![0]
      expect(localPatch.provider.providers.find((item: ModelProviderProfileV1) => item.id === target.id)?.name)
        .toBe('Renamed Provider')

      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: {
            ...initialCtx,
            provider: { ...initialCtx.provider, ...localPatch.provider },
            kun: { ...initialCtx.kun, ...localPatch.agents?.kun }
          }
        }))
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(runtimeRequest.mock.calls.some(([path, method]) =>
        path === `/v1/model-connections/${target.id}` && method === 'PATCH'
      )).toBe(true)
      resolveStaleEvent({ ok: true, status: 200, body: JSON.stringify(snapshot(1, target.name)) })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(update.mock.calls.some(([patch]) =>
        patch.provider?.providers?.some((item: ModelProviderProfileV1) =>
          item.id === target.id && item.name === target.name
        )
      )).toBe(false)
    })

    it('keeps a model catalog edit while a stale registry event races its revision-safe PATCH', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: '',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        kind: 'http',
        models: ['old-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const sharedProvider = (models: string[]) => ({
        id: target.id,
        accountId: `account:${target.id}`,
        name: target.name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        useProxy: false,
        configured: true,
        models,
        selectedModel: models[0]
      })
      const snapshot = (revision: number, models: string[]) => ({
        schemaVersion: 1,
        revision,
        providers: [sharedProvider(models)],
        defaultProviderId: target.id,
        defaultAccountId: `account:${target.id}`,
        defaultModel: models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let resolveStaleEvent!: (value: { ok: true; status: 200; body: string }) => void
      const staleEvent = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveStaleEvent = resolve
      })
      let eventRequests = 0
      const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
        if (path.includes('/events?')) {
          eventRequests += 1
          if (eventRequests === 1) return staleEvent
          return new Promise<never>(() => undefined)
        }
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(snapshot(1, ['old-model'])) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          const request = JSON.parse(body ?? '{}')
          expect(request).toMatchObject({
            expectedRevision: 1,
            models: ['old-model', 'openrouter/free']
          })
          return {
            ok: true,
            status: 200,
            body: JSON.stringify(snapshot(2, ['old-model', 'openrouter/free']))
          }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const update = vi.fn()
      const initialCtx = {
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saved',
        update
      }
      const renderer = await mountProviders(initialCtx)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      const nextTarget = { ...target, models: ['old-model', 'openrouter/free'] }
      await act(async () => {
        renderer.root.findByType(ProviderModelsManager).props.onChange(nextTarget)
      })
      const localPatch = update.mock.calls[0]![0]
      expect(localPatch.provider.providers.find((item: ModelProviderProfileV1) => item.id === target.id)?.models)
        .toEqual(nextTarget.models)
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: {
            ...initialCtx,
            provider: { ...initialCtx.provider, ...localPatch.provider },
            kun: { ...initialCtx.kun, ...localPatch.agents?.kun }
          }
        }))
        resolveStaleEvent({
          ok: true,
          status: 200,
          body: JSON.stringify(snapshot(1, ['old-model']))
        })
        await new Promise((resolve) => setTimeout(resolve, 175))
        await Promise.resolve()
      })

      expect(runtimeRequest.mock.calls.some(([path, method]) =>
        path === `/v1/model-connections/${target.id}` && method === 'PATCH'
      )).toBe(true)
      expect(update.mock.calls.some(([patch]) =>
        patch.provider?.providers?.some((item: ModelProviderProfileV1) =>
          item.id === target.id && !item.models.includes('openrouter/free')
        )
      )).toBe(false)
    })
  })
})
