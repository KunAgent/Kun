import {
  act,
  afterEach,
  baseCtx,
  beforeEach,
  clickProviderTab,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe,
  enqueueSharedModelMutation,
  expect,
  findButton,
  getModelProviderPreset,
  instanceText,
  it,
  modelProviderPresetProfile, modelProviderTokenPlanProfile,
  renderProviders,
  rendererText,
  resetSharedProviderMutationCoordinatorForTests, sharedProviderMutationCoordinator,
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

    it('fences a delayed credential prepare so only the latest generation can commit', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        ...settings.providers[0]!,
        apiKey: ''
      }
      const sharedProvider = {
        id: target.id,
        accountId: `account:${target.id}`,
        name: target.name,
        kind: 'http',
        authType: 'api-key',
        baseUrl: target.baseUrl,
        endpointFormat: target.endpointFormat,
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      }
      const snapshot = (revision: number) => ({
        schemaVersion: 1,
        revision,
        providers: [sharedProvider],
        defaultProviderId: target.id,
        defaultAccountId: sharedProvider.accountId,
        defaultModel: target.models[0],
        proxy: settings.proxy,
        routePools: settings.routePools,
        localModelGateway: { enabled: settings.localGateway.enabled }
      })
      let revision = 1
      let latestFence = ''
      let resolveFirstPut!: (value: { ok: true; status: 200; body: string }) => void
      const firstPut = new Promise<{ ok: true; status: 200; body: string }>((resolve) => {
        resolveFirstPut = resolve
      })
      let firstPutStarted!: () => void
      const firstStarted = new Promise<void>((resolve) => { firstPutStarted = resolve })
      const fenceBodies: Array<{ operationToken: string }> = []
      const credentialBodies: Array<{
        expectedRevision: number
        credential: string
        operationToken: string
      }> = []
      const commitBodies: Array<{ expectedRevision: number; operationToken: string }> = []
      const preparedCredentials = new Map<string, string>()
      const consumedCredentials: string[] = []
      const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          return { ok: true, status: 200, body: JSON.stringify(snapshot(revision)) }
        }
        if (path === `/v1/model-connections/${target.id}/credential/fence` && method === 'POST') {
          const request = JSON.parse(body ?? '{}') as { operationToken: string }
          fenceBodies.push(request)
          latestFence = request.operationToken
          return { ok: true, status: 200, body: JSON.stringify(snapshot(revision)) }
        }
        if (path === `/v1/model-connections/${target.id}/credential` && method === 'PUT') {
          const request = JSON.parse(body ?? '{}') as {
            expectedRevision: number
            credential: string
            operationToken: string
          }
          credentialBodies.push(request)
          preparedCredentials.set(request.operationToken, request.credential)
          if (credentialBodies.length === 1) {
            firstPutStarted()
            return firstPut
          }
          return { ok: true, status: 200, body: JSON.stringify(snapshot(revision)) }
        }
        if (path === `/v1/model-connections/${target.id}/credential/commit` && method === 'POST') {
          const request = JSON.parse(body ?? '{}') as {
            expectedRevision: number
            operationToken: string
          }
          commitBodies.push(request)
          if (request.operationToken !== latestFence) {
            return {
              ok: false,
              status: 409,
              body: JSON.stringify({ snapshot: snapshot(revision) })
            }
          }
          consumedCredentials.push(preparedCredentials.get(request.operationToken) ?? '')
          revision += 1
          return { ok: true, status: 200, body: JSON.stringify(snapshot(revision)) }
        }
        throw new Error(`Unexpected runtime request: ${method} ${path}`)
      })
      Object.assign(window.kunGui, { runtimeRequest })
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saved',
        update
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()
      const apiKeyInput = () => renderer.root.findAllByType('input')
        .find((input) => input.props.type === 'password')!
      expect(apiKeyInput().props.placeholder).toBe('••••••••••••')

      await act(async () => apiKeyInput().props.onChange({ target: { value: 'first-secret' } }))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 475))
      })
      await firstStarted
      await act(async () => apiKeyInput().props.onChange({ target: { value: 'latest-secret' } }))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 475))
      })
      expect(fenceBodies).toHaveLength(2)
      expect(credentialBodies).toEqual([{
        expectedRevision: 1,
        credential: 'first-secret',
        operationToken: fenceBodies[0]!.operationToken
      }])

      resolveFirstPut({ ok: true, status: 200, body: JSON.stringify(snapshot(revision)) })
      await act(async () => {
        await Promise.resolve()
        await enqueueSharedModelMutation(async () => undefined)
      })

      expect(credentialBodies).toEqual([
        {
          expectedRevision: 1,
          credential: 'first-secret',
          operationToken: fenceBodies[0]!.operationToken
        },
        {
          expectedRevision: 1,
          credential: 'latest-secret',
          operationToken: fenceBodies[1]!.operationToken
        }
      ])
      expect(commitBodies).toEqual([{
        expectedRevision: 1,
        operationToken: fenceBodies[1]!.operationToken
      }])
      expect(consumedCredentials).toEqual(['latest-secret'])
      expect(update).not.toHaveBeenCalled()
      expect(sharedProviderMutationCoordinator.pendingCredentials.has(target.id)).toBe(false)
      expect(apiKeyInput().props.value).toBe('')
    })

    it('keeps the local provider and shows an error when the shared registry cannot delete it', async () => {
      const settings = defaultModelProviderSettings()
      const target = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: 'sk-custom',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        kind: 'http',
        useProxy: false,
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
        configured: true,
        models: target.models,
        selectedModel: target.models[0]
      }
      let registryReads = 0
      const runtimeRequest = vi.fn(async (path: string, method: string) => {
        if (path.includes('/events?')) return new Promise<never>(() => undefined)
        if (path === '/v1/model-connections' && method === 'GET') {
          registryReads += 1
          if (registryReads > 1) {
            return {
              ok: false,
              status: 503,
              body: JSON.stringify({ message: 'Shared registry unavailable' })
            }
          }
        }
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            providers: [sharedProvider],
            defaultProviderId: target.id,
            defaultAccountId: sharedProvider.accountId,
            defaultModel: target.models[0],
            proxy: settings.proxy,
            routePools: settings.routePools,
            localModelGateway: { enabled: settings.localGateway.enabled }
          })
        }
      })
      Object.assign(window.kunGui, {
        runtimeRequest,
        confirmDialog: vi.fn(async () => true)
      })
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id,
          model: target.models[0]
        },
        saveStatus: 'saving',
        update
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      update.mockClear()

      await clickProviderTab(renderer, 'Advanced')
      await act(async () => {
        findButton(renderer, 'Remove provider').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(runtimeRequest.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false)
      expect(update).not.toHaveBeenCalled()
      expect(rendererText(renderer)).toContain('Shared registry unavailable')
      expect(rendererText(renderer)).toContain('Custom Provider')
    })

    it('configures Ollama Cloud and imports only provider-confirmed models with catalog metadata', async () => {
      const settings = defaultModelProviderSettings()
      const preset = getModelProviderPreset('ollama')
      expect(preset).not.toBeNull()
      const target = {
        ...modelProviderPresetProfile(preset!, 'ollama-secret'),
        models: [],
        modelProfiles: {}
      }
      const update = vi.fn()
      probeModelProvider.mockResolvedValueOnce({
        ok: true,
        latencyMs: 12,
        modelIds: ['gpt-oss:120b', 'ollama-new:model']
      })
      fetchModelsDevCatalog.mockResolvedValueOnce({
        status: 'ok',
        providerKey: 'ollama-cloud',
        providerName: 'Ollama Cloud',
        matchMode: 'enrichment-only',
        stale: false,
        models: [
          {
            id: 'gpt-oss:120b',
            reasoning: true,
            toolCalling: true,
            inputModalities: ['text'],
            outputModalities: ['text'],
            contextWindowTokens: 131_072,
            maxOutputTokens: 32_768
          },
          {
            id: 'catalog-only',
            inputModalities: ['text'],
            outputModalities: ['text']
          }
        ]
      })
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, target] },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: target.id
        },
        update
      })

      expect(rendererText(renderer)).toContain('Ollama Cloud')
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'Ollama Cloud')).toBe(true)
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'https://ollama.com/v1')).toBe(true)
      expect(renderer.root.findAllByType('input')
        .some((input) => input.props.value === 'ollama-secret')).toBe(true)

      await clickProviderTab(renderer, 'Models')
      await act(async () => {
        findButton(renderer, 'Fetch models').props.onClick()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(probeModelProvider).toHaveBeenCalledWith({
        providerId: 'ollama',
        baseUrl: 'https://ollama.com/v1',
        apiKey: 'ollama-secret',
        endpointFormat: 'chat_completions',
        useProxy: false
      })
      expect(fetchModelsDevCatalog).toHaveBeenCalledWith({
        providerId: 'ollama',
        baseUrl: 'https://ollama.com/v1',
        forceRefresh: true
      })
      const importDialog = renderer.root.findByProps({ role: 'dialog' })
      expect(instanceText(importDialog)).toContain('gpt-oss:120b')
      expect(instanceText(importDialog)).toContain('ollama-new:model')
      expect(instanceText(importDialog)).not.toContain('catalog-only')

      await act(async () => findButton(renderer, 'Import 2').props.onClick())
      const updatedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      const updatedOllama = updatedProviders.find((provider) => provider.id === 'ollama')
      expect(updatedOllama?.models).toEqual(['gpt-oss:120b', 'ollama-new:model'])
      expect(updatedOllama?.modelProfiles['gpt-oss:120b']).toMatchObject({
        contextWindowTokens: 131_072,
        maxOutputTokens: 32_768,
        supportsToolCalling: true,
        reasoning: {
          supportedEfforts: ['auto'],
          defaultEffort: 'auto',
          requestProtocol: 'none'
        }
      })
      expect(updatedOllama?.modelProfiles['ollama-new:model']).toBeUndefined()
    })

    it('adds repeated Token Plan accounts with independent numbered identities', async () => {
      const runtimeRequest = installDraftRegistry()
      const settings = defaultModelProviderSettings()
      const minimax = getModelProviderPreset('minimax')
      const first = modelProviderTokenPlanProfile(minimax!, 'sk-first')!
      const update = vi.fn()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: { ...settings, providers: [...settings.providers, first] },
        kun: { ...defaultKunRuntimeSettings(), providerId: first.id, model: first.models[0] },
        update
      })
      update.mockClear()

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const dialog = renderer.root.findByProps({ role: 'dialog' })
      expect(instanceText(dialog)).toContain('1 accounts')
      const minimaxPlanEntry = dialog.findAllByType('button')
        .find((button) => {
          const text = instanceText(button)
          return text.includes('MiniMax') && text.includes('Token Plan') && text.includes('1 accounts')
        })
      expect(minimaxPlanEntry).toBeDefined()
      expect(instanceText(minimaxPlanEntry!)).toContain('Add an independent account')

      await act(async () => minimaxPlanEntry!.props.onClick())
      expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
      expect(rendererText(renderer)).toContain('Unsaved')
      expect(rendererText(renderer)).toContain('MiniMax Token Plan 2')

      await act(async () => findButton(renderer, 'Cancel').props.onClick())
      expect(rendererText(renderer)).not.toContain('Unsaved')
      expect(update).not.toHaveBeenCalled()

      await act(async () => findButton(renderer, 'Add provider').props.onClick())
      const reopenedDialog = renderer.root.findByProps({ role: 'dialog' })
      const reopenedEntry = reopenedDialog.findAllByType('button')
        .find((button) => {
          const text = instanceText(button)
          return text.includes('MiniMax') && text.includes('Token Plan') && text.includes('1 accounts')
        })
      await act(async () => reopenedEntry!.props.onClick())

      const apiKeyInput = renderer.root.findAllByType('input')
        .find((input) => input.props.placeholder === 'Enter provider API key')
      await act(async () => apiKeyInput!.props.onChange({ target: { value: 'sk-second' } }))
      await act(async () => findButton(renderer, 'Add').props.onClick())

      const savedProviders = update.mock.calls[0]?.[0]?.provider?.providers as ModelProviderProfileV1[]
      expect(savedProviders.filter((provider) => provider.presetSource?.presetId === 'minimax')).toEqual([
        expect.objectContaining({
          id: 'minimax-token-plan',
          name: 'MiniMax Token Plan',
          apiKey: 'sk-first',
          presetSource: { presetId: 'minimax', mode: 'token-plan' }
        }),
        expect.objectContaining({
          id: 'minimax-token-plan-2',
          name: 'MiniMax Token Plan 2',
          apiKey: '',
          presetSource: { presetId: 'minimax', mode: 'token-plan' }
        })
      ])
      expect(update.mock.calls[0]?.[0]?.agents?.kun?.providerId).toBe('minimax-token-plan-2')
      expect(runtimeRequest.mock.calls.some(([path, method, body]) =>
        path === '/v1/model-connections/connect' &&
        method === 'POST' &&
        JSON.parse(body as string).credential === 'sk-second'
      )).toBe(true)
    })
  })
})
