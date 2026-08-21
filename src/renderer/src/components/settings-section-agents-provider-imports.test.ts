import {
  ProvidersSettingsSection,
  act,
  afterEach,
  baseCtx,
  beforeEach,
  clickProviderTab,
  createElement,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe, expect,
  findButton,
  getModelProviderPreset,
  instanceText,
  it,
  modelProviderPresetAccountProfile,
  modelProviderPresetProfile,
  renderProviders,
  rendererText,
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

    const sharedImportFixture = () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'shared-provider', name: 'Shared Provider', apiKey: '',
        baseUrl: 'https://api.example.com/v1', endpointFormat: 'chat_completions',
        models: ['old-model'], modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const snapshot = (revision: number, models = target.models) => ({
        schemaVersion: 1,
        revision,
        providers: [{
          ...target,
          accountId: `account:${target.id}`,
          kind: 'http',
          authType: 'api-key',
          configured: true,
          credentialStatus: 'ready',
          models,
          selectedModel: models[0]
        }],
        defaultProviderId: target.id,
        defaultAccountId: `account:${target.id}`,
        defaultModel: models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      return { settings, target, snapshot }
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
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      return runtimeRequest
    }

    it('uses the canonical models.dev source for a numbered provider account', async () => {
      const settings = defaultModelProviderSettings()
      const kimi = getModelProviderPreset('kimi-code')!
      const first = modelProviderPresetAccountProfile(kimi, 'api', [])!
      const second = {
        ...modelProviderPresetAccountProfile(kimi, 'api', [first])!,
        apiKey: 'sk-second'
      }
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, first, second] },
        kun: { ...defaultKunRuntimeSettings(), providerId: second.id, model: second.models[0] }
      })

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'kimi-code',
        baseUrl: second.baseUrl,
        forceRefresh: true
      })
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
        .find((button) => instanceText(button).includes('Xiaomi') && instanceText(button).includes('Update preset'))
      await act(async () => {
        xiaomiEntry!.props.onClick()
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

    it('separates readiness, save failure, and fresh probe state', async () => {
      const provider = defaultModelProviderSettings()
      const probeProvider = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: ['probe-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const providerContext = (profile: ModelProviderProfileV1): Record<string, unknown> => ({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        },
        saveStatus: 'error',
        saveError: 'Disk is read-only'
      })
      const renderer = await mountProviders(providerContext(probeProvider))

      expect(rendererText(renderer)).toContain('Ready')
      expect(rendererText(renderer)).toContain('Could not apply')
      const providersPanel = renderer.root.findByProps({
        id: 'provider-workspace-panel-providers'
      })
      expect(providersPanel.findAllByType('span')
        .filter((span) => span.props.title === 'Disk is read-only')).toHaveLength(1)
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(false)

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
      })
      expect(probeModelProvider).toHaveBeenCalledWith({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-probe',
        endpointFormat: 'chat_completions'
      })
      expect(fetchModelsDevCatalog).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Connected · 18ms · 2 models')
      expect(rendererText(renderer)).toContain('Could not apply')

      const changedProvider = { ...probeProvider, baseUrl: 'https://api.changed.example/v1' }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, { ctx: providerContext(changedProvider) }))
      })
      expect(rendererText(renderer)).not.toContain('Connected · 18ms · 2 models')
      expect(rendererText(renderer)).toContain('Ready')

      const invalidProvider = { ...probeProvider, baseUrl: 'api.changed.example/v1' }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, { ctx: providerContext(invalidProvider) }))
      })
      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(rendererText(renderer)).toContain('URL must start with http:// or https://')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
      expect(rendererText(renderer)).toContain('Could not apply')
    })

    it('fetches both model sources and persists metadata only for confirmed selections', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: [],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(probeModelProvider).toHaveBeenCalledWith({
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        endpointFormat: target.endpointFormat
      })
      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: target.id,
        baseUrl: target.baseUrl,
        forceRefresh: true
      })
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('models.dev only')
      expect(findButton(renderer, 'Import 2').props.disabled).toBe(false)

      await act(async () => findButton(renderer, 'Import 2').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedTarget = updatedProviders.find((item) => item.id === target.id)
      expect(updatedTarget?.models).toEqual(['model-a', 'model-b'])
      expect(updatedTarget?.models).not.toContain('catalog-only')
      expect(updatedTarget?.speech).toBeUndefined()
      expect(updatedTarget?.modelProfiles['model-a']).toEqual(expect.objectContaining({
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000,
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      }))
    })

    it('applies catalog metadata to models that were already configured', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: ['model-a', 'model-b'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(findButton(renderer, 'Apply model metadata').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Apply model metadata').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedTarget = updatedProviders.find((item) => item.id === target.id)
      expect(updatedTarget?.models).toEqual(target.models)
      expect(updatedTarget?.modelProfiles['model-a']).toEqual(expect.objectContaining({
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000,
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        messageParts: ['text', 'image_url']
      }))
    })

    it('waits for a shared catalog commit before closing the import dialog', async () => {
      const { settings, target, snapshot } = sharedImportFixture()
      let revision = 1
      let registryModels = [...target.models]
      const currentSnapshot = () => snapshot(revision, registryModels)
      const patchBodies: Array<{ models: string[] }> = []
      const runtimeRequest = vi.fn(async (path: string, method = 'GET', body?: string) => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(currentSnapshot()) }
        }
        if (path === `/v1/model-connections/${target.id}/probe` && method === 'POST') {
          return { ok: true, status: 200, body: JSON.stringify({ ok: true, models: ['old-model', 'new-model'] }) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          const request = JSON.parse(body ?? '{}') as { models: string[] }
          patchBodies.push(request)
          registryModels = [...request.models]
          revision += 1
          return { ok: true, status: 200, body: JSON.stringify(currentSnapshot()) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id, model: target.models[0] },
        update: vi.fn()
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(findButton(renderer, 'Import 2').props.disabled).toBe(false)
      await act(async () => {
        findButton(renderer, 'Import 2').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(patchBodies).toHaveLength(1)
      expect(patchBodies[0]?.models).toEqual(['old-model', 'new-model'])
      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
    })

    it('keeps the picker open when a shared catalog commit fails', async () => {
      const { settings, target, snapshot } = sharedImportFixture()
      const shared = snapshot(1)
      const runtimeRequest = vi.fn(async (path: string, method = 'GET') => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(shared) }
        }
        if (path === `/v1/model-connections/${target.id}/probe` && method === 'POST') {
          return { ok: true, status: 200, body: JSON.stringify({ ok: true, models: ['old-model', 'new-model'] }) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          return { ok: false, status: 422, body: JSON.stringify({ message: 'catalog rejected' }) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id, model: target.models[0] },
        update: vi.fn()
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        findButton(renderer, 'Import 2').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
      expect(rendererText(renderer)).toContain('catalog rejected')
      expect(findButton(renderer, 'Import 2').props.disabled).toBe(false)
    })

    it('blocks a shared catalog above the runtime model limit before PATCH', async () => {
      const { settings, target, snapshot } = sharedImportFixture()
      const fetchedModels = Array.from({ length: 501 }, (_, index) => `model-${index}`)
      const shared = snapshot(1)
      const runtimeRequest = vi.fn(async (path: string, method = 'GET') => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(shared) }
        }
        if (path === `/v1/model-connections/${target.id}/probe` && method === 'POST') {
          return { ok: true, status: 200, body: JSON.stringify({ ok: true, models: fetchedModels }) }
        }
        if (path === `/v1/model-connections/${target.id}` && method === 'PATCH') {
          throw new Error('PATCH must not be called for an oversized catalog')
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id, model: target.models[0] },
        update: vi.fn()
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async () => {
        findButton(renderer, 'Import 501').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(1)
      expect(rendererText(renderer)).toContain('providerModelImportSubmitFailed')
      expect(runtimeRequest.mock.calls.some(([path, method]) =>
        path === `/v1/model-connections/${target.id}` && method === 'PATCH'
      )).toBe(false)
    })

    it('keeps catalog-only candidates unchecked when the provider model request fails', async () => {
      probeModelProvider.mockResolvedValueOnce({ ok: false, message: '401 unauthorized' })
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'probe-provider',
        name: 'Probe Provider',
        apiKey: 'sk-probe',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        models: [],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: { ...defaultKunRuntimeSettings(), providerId: target.id }
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      const dialogText = instanceText(renderer.root.findByProps({ role: 'dialog' }))
      expect(dialogText).toContain('Provider verification failed: 401 unauthorized')
      expect(dialogText).toContain('models.dev only')
      expect(findButton(renderer, 'Import 0').props.disabled).toBe(true)
    })
  })
})
