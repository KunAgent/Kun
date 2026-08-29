import {
  act,
  activePanelText,
  afterEach,
  antigravityProviderCatalogPatch,
  baseCtx,
  beforeEach,
  clickProviderTab,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe, expect,
  findButton,
  getModelProviderPreset,
  it,
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

    it('opens the official Cursor User API Keys page from the connection form', async () => {
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        ''
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' }
      })

      expect(activePanelText(renderer)).toContain('Enter an API key created in the Cursor dashboard.')
      await act(async () => findButton(renderer, 'Get Cursor API key').props.onClick())

      expect(openExternal).toHaveBeenCalledOnce()
      expect(openExternal).toHaveBeenCalledWith(
        'https://cursor.com/dashboard/api?section=user-keys#user-api-keys'
      )
    })

    it('renders Gemini CLI direct API as a keyless provider separate from Antigravity', async () => {
      const settings = defaultModelProviderSettings()
      const direct = modelProviderPresetProfile(
        getModelProviderPreset('gemini-cli-subscription')!,
        'must-not-be-stored'
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, direct] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: direct.id,
          model: 'gemini-2.5-flash'
        }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      const panel = activePanelText(renderer)
      expect(panel).toContain('Gemini CLI direct API keeps Kun in charge of long sessions.')
      expect(panel).toContain('Gemini CLI Google login is ready')
      expect(panel).toContain('Gemini CLI API endpoint is fixed.')
      expect(panel).not.toContain('Enter provider API key')
      expect(findButton(renderer, 'Sync Gemini CLI API models')).toBeTruthy()
      expect(geminiCliSubscriptionStatus).toHaveBeenCalled()
      await act(async () => findButton(renderer, 'Models').props.onClick())
      expect(rendererText(renderer)).toContain('gemini-3-flash-preview')
      expect(rendererText(renderer)).not.toContain('gemini-3.6-flash')
    })

    it('maps the authoritative Antigravity catalog to model-specific reasoning profiles', () => {
      const patch = antigravityProviderCatalogPatch(antigravityCatalog)

      expect(patch.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(patch.modelProfiles['gemini-3.6-flash']).toMatchObject({
        inputModalities: ['text', 'image'],
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium',
          requestProtocol: 'none'
        }
      })
      expect(patch.modelProfiles['claude-sonnet-4-6'].inputModalities).toEqual(['text', 'image'])
      expect(patch.modelProfiles['gpt-oss-120b']).toMatchObject({
        inputModalities: ['text'],
        reasoning: {
          supportedEfforts: ['medium'],
          defaultEffort: 'medium'
        }
      })
    })

    it('synchronizes all Antigravity model families and profiles into provider settings', async () => {
      const settings = defaultModelProviderSettings()
      const antigravity = modelProviderPresetProfile(
        getModelProviderPreset('gemini-subscription')!,
        ''
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: { ...settings, providers: [...settings.providers, antigravity] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: antigravity.id,
          model: 'gemini-3.6-flash'
        }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => findButton(renderer, 'Sync Antigravity models').props.onClick())

      expect(geminiSubscriptionModels).toHaveBeenCalledOnce()
      const lastPatch = update.mock.calls.at(-1)?.[0] as {
        provider?: { providers?: ModelProviderProfileV1[] }
      }
      const saved = lastPatch.provider?.providers?.find((provider) => provider.id === antigravity.id)
      expect(saved?.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
      expect(saved?.modelProfiles['gpt-oss-120b']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
    })

    it('preserves Antigravity discovery profiles through the model import flow', async () => {
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'google',
        providerName: 'Google',
        matchMode: 'enrichment-only',
        stale: false,
        models: [
          {
            id: 'gemini-3.6-flash',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            contextWindowTokens: 1_048_576,
            toolCalling: true
          },
          {
            id: 'claude-sonnet-4-6',
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            contextWindowTokens: 200_000,
            toolCalling: true
          }
        ]
      })
      const settings = defaultModelProviderSettings()
      const antigravity = modelProviderPresetProfile(
        getModelProviderPreset('gemini-subscription')!,
        ''
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: { ...settings, providers: [...settings.providers, antigravity] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: antigravity.id,
          model: 'gemini-3.6-flash'
        }
      })

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(findButton(renderer, 'Import 3').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Import 3').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const saved = updatedProviders.find((provider) => provider.id === antigravity.id)
      expect(saved?.models).toEqual([
        'gemini-3.6-flash',
        'claude-sonnet-4-6',
        'gpt-oss-120b'
      ])
      expect(saved?.modelProfiles['gemini-3.6-flash']).toMatchObject({
        contextWindowTokens: 1_048_576,
        reasoning: {
          supportedEfforts: ['low', 'medium', 'high'],
          defaultEffort: 'medium'
        }
      })
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.reasoning?.supportedEfforts)
        .toEqual(['medium'])
      expect(saved?.modelProfiles['claude-sonnet-4-6']?.contextWindowTokens).toBe(200_000)
    })

    it('turns a stale Cursor discovery handler error into restart guidance', async () => {
      cursorSubscriptionDiscover.mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'cursor-subscription:discover': "
          + "Error: No handler registered for 'cursor-subscription:discover'"
        )
      )
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        'cursor-secret'
      )
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' }
      })

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendererText(renderer)).toContain(
        'Connection failed: Fully quit Kun and reopen it, then try again.'
      )
      expect(rendererText(renderer)).not.toContain('No handler registered')
    })

    it('offers the detected system proxy and lets users copy the probe error', async () => {
      probeModelProvider.mockResolvedValueOnce({
        ok: false,
        message: 'Request failed: read ECONNRESET',
        suggestedProxyUrl: 'http://127.0.0.1:10808/'
      })
      const clipboardWrite = vi.fn(async () => undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWrite } })
      const settings = defaultModelProviderSettings()
      const zenmux = modelProviderPresetProfile(getModelProviderPreset('zenmux')!, 'sk-ai-v1-test')
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, zenmux] },
        kun: { ...defaultKunRuntimeSettings(), providerId: zenmux.id, model: 'auto' },
        update
      })

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendererText(renderer)).toContain(
        'System proxy http://127.0.0.1:10808/ can reach this provider.'
      )
      await act(async () => findButton(renderer, 'Copy error').props.onClick())
      expect(clipboardWrite).toHaveBeenCalledWith(
        'Connection failed: Request failed: read ECONNRESET'
      )

      await act(async () => findButton(renderer, 'Use detected proxy').props.onClick())
      expect(update).toHaveBeenCalledWith({
        provider: {
          proxy: { enabled: true, url: 'http://127.0.0.1:10808/' }
        }
      })
      expect(update.mock.calls.some(([patch]) => JSON.stringify(patch).includes(
        `"id":"${zenmux.id}","name"`
      ) && JSON.stringify(patch).includes('"useProxy":true'))).toBe(true)
    })

    it('saves the Provider proxy switch while retaining an inactive selection', async () => {
      const settings = defaultModelProviderSettings()
      const zenmux = {
        ...modelProviderPresetProfile(getModelProviderPreset('zenmux')!, 'sk-ai-v1-test'),
        useProxy: true
      }
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...settings,
          proxy: { enabled: false, url: 'http://127.0.0.1:7890' },
          providers: [...settings.providers, zenmux]
        },
        kun: { ...defaultKunRuntimeSettings(), providerId: zenmux.id, model: 'auto' },
        update
      })

      expect(rendererText(renderer)).toContain('Selected but inactive because the global proxy is disabled.')
      expect(rendererText(renderer)).toContain('delegated SDK/CLI traffic uses its own network settings.')
      const toggle = renderer.root.findByProps({ 'aria-label': 'Use configured app proxy' })
      expect(toggle.props['aria-checked']).toBe(true)

      await act(async () => toggle.props.onClick())
      expect(update.mock.calls.some(([patch]) => JSON.stringify(patch).includes(
        `"id":"${zenmux.id}","name"`
      ) && JSON.stringify(patch).includes('"useProxy":false'))).toBe(true)
    })

    it('imports Cursor mixed-vendor context, vision, and SDK aliases', async () => {
      cursorSubscriptionDiscover.mockResolvedValueOnce({
        account: { apiKeyName: 'test-key', userEmail: 'cursor@example.com' },
        models: [{
          id: 'gemini-3.6-flash',
          displayName: 'Gemini 3.6 Flash',
          aliases: ['gemini-flash-latest']
        }]
      })
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'cursor-mixed',
        providerName: 'Cursor',
        matchMode: 'enrichment-only',
        stale: false,
        models: [{
          id: 'gemini-3.6-flash',
          providerKey: 'google',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          reasoning: true,
          toolCalling: true
        }]
      })
      const settings = defaultModelProviderSettings()
      const cursor = modelProviderPresetProfile(
        getModelProviderPreset('cursor-subscription')!,
        'cursor-secret'
      )
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: { ...defaultKunRuntimeSettings(), providerId: cursor.id, model: 'auto' },
        update
      })

      await act(async () => findButton(renderer, 'Models').props.onClick())
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'cursor-subscription',
        baseUrl: '',
        forceRefresh: true,
        modelHints: [{
          id: 'gemini-3.6-flash',
          aliases: ['gemini-flash-latest']
        }]
      })
      expect(findButton(renderer, 'Import 1').props.disabled).toBe(false)
      await act(async () => findButton(renderer, 'Import 1').props.onClick())

      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedCursor = updatedProviders.find((item) => item.id === cursor.id)
      expect(updatedCursor?.models).toEqual(['gemini-3.6-flash'])
      expect(updatedCursor?.modelProfiles['gemini-3.6-flash']).toEqual(expect.objectContaining({
        aliases: ['gemini-flash-latest'],
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 65_536,
        inputModalities: ['text', 'image'],
        messageParts: ['text', 'image_url'],
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      }))
    })

    it('repairs missing metadata for an existing pulled Cursor model list', async () => {
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'cursor-mixed',
        providerName: 'Cursor',
        matchMode: 'enrichment-only',
        stale: false,
        models: [{
          id: 'gemini-3.6-flash',
          providerKey: 'google',
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          contextWindowTokens: 1_048_576,
          maxOutputTokens: 65_536,
          reasoning: true,
          toolCalling: true
        }]
      })
      const settings = defaultModelProviderSettings()
      const cursor = {
        ...modelProviderPresetProfile(
          getModelProviderPreset('cursor-subscription')!,
          'cursor-secret'
        ),
        models: ['gemini-3.6-flash'],
        modelProfiles: {}
      }
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, cursor] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: cursor.id,
          model: 'gemini-3.6-flash'
        },
        update
      })

      await act(async () => {
        findButton(renderer, 'Models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'cursor-subscription',
        baseUrl: '',
        forceRefresh: false,
        modelHints: [{
          id: 'gemini-3.6-flash'
        }]
      })
      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      const updatedCursor = updatedProviders?.find((item) => item.id === cursor.id)
      expect(updatedCursor?.modelProfiles['gemini-3.6-flash']).toEqual(expect.objectContaining({
        contextWindowTokens: 1_048_576,
        maxOutputTokens: 65_536,
        inputModalities: ['text', 'image'],
        messageParts: ['text', 'image_url'],
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      }))
    })
  })
})
