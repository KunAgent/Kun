import {
  ProvidersSettingsSection,
  act,
  activePanelText,
  afterEach,
  baseCtx,
  beforeEach,
  clickProviderTab,
  createElement,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe, expect,
  findButton,
  findButtonContaining,
  getModelProviderPreset,
  instanceText,
  it,
  modelProviderPresetProfile,
  renderProviders,
  rendererText,
  resetSharedProviderMutationCoordinatorForTests, sharedProviderMutationCoordinator,
  vi,
  type AntigravitySubscriptionModelCatalog, type ClaudeSubscriptionProbeResult,
  type CursorSubscriptionModel,
  type ModelProviderProbeResult,
  type ModelProviderProfileV1,
  type ModelsDevCatalogResult,
  type ReactTestInstance, type ReactTestRenderer
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

    it('allows an agent SDK subscription to use its host login without an API key', async () => {
      const provider = defaultModelProviderSettings()
      const claudeSubscription = getModelProviderPreset('claude-subscription')
      expect(claudeSubscription).not.toBeNull()
      const profile = modelProviderPresetProfile(claudeSubscription!)
      expect(profile.kind).toBe('agent-sdk')
      expect(profile.apiKey).toBe('')

      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      expect(rendererText(renderer)).toContain('Ready')
      expect(rendererText(renderer)).not.toContain('Needs configuration')
      const testConnection = findButton(renderer, 'Test connection')
      expect(testConnection.props.disabled).toBe(false)
      claudeSubscriptionProbe.mockClear()

      await act(async () => {
        testConnection.props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(claudeSubscriptionProbe).toHaveBeenCalledOnce()
      expect(claudeSubscriptionProbe).toHaveBeenCalledWith(undefined, profile.id)
      expect(probeModelProvider).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Connected · 23ms')
    })

    it.each([
      ['codex', 'ChatGPT 订阅', 'codexDisconnect'],
      ['grok-subscription', 'Grok 订阅', 'grokDisconnect']
    ])('keeps a secret-free %s Registry login visibly connected', async (
      presetId,
      expectedName,
      disconnectLabel
    ) => {
      const settings = defaultModelProviderSettings()
      const profile = {
        ...modelProviderPresetProfile(getModelProviderPreset(presetId)!),
        apiKey: ''
      }
      const snapshot = {
        schemaVersion: 1,
        revision: 1,
        providers: [{
          id: profile.id,
          accountId: `account:${profile.id}`,
          name: profile.name,
          kind: profile.kind ?? 'http',
          authType: 'subscription',
          baseUrl: profile.baseUrl,
          endpointFormat: profile.endpointFormat,
          useProxy: false,
          configured: true,
          models: profile.models,
          selectedModel: profile.models[0]
        }],
        defaultProviderId: profile.id,
        defaultAccountId: `account:${profile.id}`,
        defaultModel: profile.models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      }
      const runtimeRequest = vi.fn(async (path: string, _method = 'GET', _body?: string) =>
        path.includes('/events?')
          ? new Promise<never>(() => undefined)
          : { ok: true, status: 200, body: JSON.stringify(snapshot) })
      Object.assign(window.kunGui, { runtimeRequest })

      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, profile] },
        kun: { ...defaultKunRuntimeSettings(), providerId: profile.id, model: profile.models[0] }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(activePanelText(renderer)).toContain(expectedName)
      await act(async () => findButton(renderer, disconnectLabel).props.onClick())
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 475))
      })

      const clearCall = runtimeRequest.mock.calls.find(([path, method]) =>
        path === `/v1/model-connections/${profile.id}/credential?expected_revision=1` &&
        method === 'DELETE'
      )
      expect(clearCall).toBeTruthy()
      expect(clearCall?.[2]).toBeUndefined()
    })

    it('clears a protected Claude setup token after ambient login succeeds', async () => {
      const settings = defaultModelProviderSettings()
      const profile = {
        ...modelProviderPresetProfile(getModelProviderPreset('claude-subscription')!),
        apiKey: ''
      }
      const snapshot = {
        schemaVersion: 1,
        revision: 1,
        providers: [{
          id: profile.id,
          accountId: `account:${profile.id}`,
          name: profile.name,
          kind: profile.kind ?? 'agent-sdk',
          authType: 'subscription',
          baseUrl: profile.baseUrl,
          endpointFormat: profile.endpointFormat,
          useProxy: false,
          configured: true,
          models: profile.models,
          selectedModel: profile.models[0]
        }],
        defaultProviderId: profile.id,
        defaultAccountId: `account:${profile.id}`,
        defaultModel: profile.models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      }
      const runtimeRequest = vi.fn(async (path: string, _method = 'GET', _body?: string) =>
        path.includes('/events?')
          ? new Promise<never>(() => undefined)
          : { ok: true, status: 200, body: JSON.stringify(snapshot) })
      Object.assign(window.kunGui, {
        runtimeRequest,
        claudeSubscriptionLogin: vi.fn(async () => ({ ok: true as const, mode: 'ambient' as const }))
      })

      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, profile] },
        kun: { ...defaultKunRuntimeSettings(), providerId: profile.id, model: profile.models[0] }
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      await act(async () => findButton(renderer, 'claudeSubReloginButton').props.onClick())
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 475))
      })

      const clearCall = runtimeRequest.mock.calls.find(([path, method]) =>
        path === `/v1/model-connections/${profile.id}/credential?expected_revision=1` &&
        method === 'DELETE'
      )
      expect(clearCall).toBeTruthy()
      expect(clearCall?.[2]).toBeUndefined()
    })

    it('shows a real Claude authentication failure instead of a false connected state', async () => {
      const provider = defaultModelProviderSettings()
      const preset = getModelProviderPreset('claude-subscription')
      expect(preset).not.toBeNull()
      const profile = modelProviderPresetProfile(preset!)
      claudeSubscriptionProbe.mockResolvedValueOnce({
        ok: false,
        message: 'API Error: 401 Invalid Bearer <redacted>'
      })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      await act(async () => {
        findButton(renderer, 'Test connection').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(claudeSubscriptionProbe).toHaveBeenCalledWith(undefined, profile.id)
      expect(rendererText(renderer)).toContain(
        'Connection failed: API Error: 401 Invalid Bearer <redacted>'
      )
      expect(rendererText(renderer)).not.toContain('Connected ·')
    })

    it('marks a wrapped Claude setup token invalid before a request is sent', async () => {
      const provider = defaultModelProviderSettings()
      const preset = getModelProviderPreset('claude-subscription')
      expect(preset).not.toBeNull()
      const profile = {
        ...modelProviderPresetProfile(preset!),
        apiKey: 'Bearer sk-ant-oat01-wrapped-token'
      }
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, profile]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: profile.id
        }
      })

      expect(rendererText(renderer)).toContain(
        'Paste only the complete sk-ant-oat token.'
      )
      expect(claudeSubscriptionProbe).not.toHaveBeenCalled()
    })

    it('filters the add dialog and keeps custom providers local until confirmation', async () => {
      const runtimeRequest = installDraftRegistry()
      const provider = defaultModelProviderSettings()
      const inspectedProvider = {
        id: 'inspection-provider',
        name: 'Inspection Provider',
        apiKey: 'sk-inspection',
        baseUrl: 'https://api.inspection.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        models: ['inspection-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, inspectedProvider]
        },
        kun: defaultKunRuntimeSettings(),
        update
      })
      update.mockClear()

      await act(async () => findButtonContaining(renderer, 'Inspection Provider').props.onClick())

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      expect(dialog.props['aria-modal']).toBe('true')
      expect(instanceText(dialog)).toContain('Choose a preset or create a custom provider.')

      const regionTablist = renderer.root.findByProps({
        role: 'tablist',
        'aria-label': 'Subscription plan regions'
      })
      const regionTab = (label: string): ReactTestInstance => {
        const tab = regionTablist.findAllByProps({ role: 'tab' })
          .find((candidate) => instanceText(candidate) === label)
        expect(tab, `subscription region tab "${label}"`).toBeTruthy()
        return tab!
      }
      expect(regionTab('All').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Kimi Code')

      await act(async () => regionTab('China').props.onClick())
      expect(regionTab('China').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Zhipu Coding Plan')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Kimi Code')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('ChatGPT 订阅')

      await act(async () => regionTab('United States').props.onClick())
      expect(regionTab('United States').props['aria-selected']).toBe(true)
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Claude (Pro/Max 订阅)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('ChatGPT 订阅')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Ollama Cloud')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('Kimi Code')

      await act(async () => regionTab('All').props.onClick())
      const searchInput = renderer.root.findByProps({ 'aria-label': 'Search provider presets…' })
      await act(async () => searchInput.props.onChange({ target: { value: 'xiaomi' } }))
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('Xiaomi')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('MiniMax')

      await act(async () => searchInput.props.onChange({ target: { value: 'zenmux' } }))
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).toContain('ZenMux API')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' })))
        .toContain('ZenMux Builder Plan (Coding Plan)')
      expect(instanceText(renderer.root.findByProps({ role: 'dialog' }))).not.toContain('Xiaomi')

      await act(async () => findButtonContaining(renderer, 'Custom provider…').props.onClick())
      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      expect(rendererText(renderer)).toContain('Unsaved')
      expect(rendererText(renderer)).toContain('Add this provider')
      expect(activePanelText(renderer)).toContain('Provider connection')
      expect(renderer.root.findAllByProps({ role: 'tab' })
        .find((tab) => instanceText(tab) === 'Connection')?.props['aria-selected']).toBe(true)
      expect(update).not.toHaveBeenCalled()

      await act(async () => findButton(renderer, 'Cancel').props.onClick())
      expect(rendererText(renderer)).not.toContain('Unsaved')
      expect(update).not.toHaveBeenCalled()
      expect(renderer.root.findAllByType('button')
        .find((button) => button.props['aria-pressed'] === true && instanceText(button).includes('Inspection Provider')))
        .toBeTruthy()

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      await act(async () => findButtonContaining(renderer, 'Custom provider…').props.onClick())
      const apiKeyInput = renderer.root.findAllByType('input')
        .find((input) => input.props.placeholder === 'Enter provider API key')
      expect(apiKeyInput).toBeTruthy()
      await act(async () => apiKeyInput!.props.onChange({ target: { value: 'sk-custom' } }))
      expect(rendererText(renderer)).toContain('Click Add to save this provider and switch to it.')

      await act(async () => findButton(renderer, 'Add').props.onClick())
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0][0]).toMatchObject({
        provider: {
          providers: expect.arrayContaining([
            expect.objectContaining({
              id: 'custom-provider-4',
              apiKey: ''
            })
          ])
        },
        agents: {
          kun: expect.objectContaining({ providerId: 'custom-provider-4' })
        }
      })
      expect(runtimeRequest.mock.calls.some(([path, method, body]) =>
        path === '/v1/model-connections/connect' &&
        method === 'POST' &&
        JSON.parse(body as string).credential === 'sk-custom'
      )).toBe(true)
      expect(rendererText(renderer)).not.toContain('Unsaved')
    })

    it('deletes the canonical shared provider before removing it from local settings', async () => {
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
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const sharedProvider = {
        id: target.id,
        accountId: `account:${target.id}`,
        name: target.name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        useProxy: false,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      }
      const snapshot = (revision: number, providers = [sharedProvider]) => ({
        schemaVersion: 1,
        revision,
        providers,
        defaultProviderId: providers[0]?.id,
        defaultAccountId: providers[0]?.accountId,
        defaultModel: providers[0]?.selectedModel,
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let resolveDelete!: (value: { ok: true; status: 200; body: string }) => void
      const deleteRequest = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveDelete = resolve
      })
      const runtimeRequest = vi.fn(async (path: string, method: string) => {
        if (method === 'DELETE') return deleteRequest
        return { ok: true, status: 200, body: JSON.stringify(snapshot(1)) }
      })
      Object.assign(window.kunGui, {
        runtimeRequest,
        confirmDialog: vi.fn(async () => true)
      })
      const update = vi.fn()
      const initialCtx = {
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saving',
        update
      }
      const renderer = await mountProviders(initialCtx)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      await clickProviderTab(renderer, 'Advanced')
      let removePromise!: Promise<void>
      await act(async () => {
        removePromise = findButton(renderer, 'Remove provider').props.onClick()
        await Promise.resolve()
      })

      const unrelatedProvider = {
        ...settings.providers[0]!,
        name: 'Edited while delete was pending'
      }
      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: {
            ...initialCtx,
            provider: {
              ...initialCtx.provider,
              providers: [unrelatedProvider, target]
            }
          }
        }))
        await Promise.resolve()
      })
      resolveDelete({ ok: true, status: 200, body: JSON.stringify(snapshot(2, [])) })
      await act(async () => {
        await removePromise
      })

      const deleteCallIndex = runtimeRequest.mock.calls.findIndex(([path, method]) =>
        method === 'DELETE' && path.includes('/v1/model-connections/custom-provider-2?')
      )
      expect(deleteCallIndex).toBeGreaterThanOrEqual(0)
      expect(update).toHaveBeenCalledTimes(1)
      expect(update.mock.calls[0]?.[0].provider.providers)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ id: unrelatedProvider.id })
        ]))
      expect(update.mock.calls[0]?.[0].provider.providers)
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: target.id })]))
      expect(sharedProviderMutationCoordinator.pendingDeletions.get(target.id)).toMatchObject({
        committedRevision: 2
      })
    })
  })
})
