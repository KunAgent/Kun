import {
  DEFAULT_MODEL_PROVIDER_ID,
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
  ProvidersSettingsSection,
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

    it('renders task tabs and keeps the selected task while switching providers', async () => {
      const provider = defaultModelProviderSettings()
      const customProvider = {
        id: 'custom-provider-2',
        name: 'Custom Provider',
        apiKey: '',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'messages',
        models: Array.from({ length: 9 }, (_, index) => `custom-model-${index + 1}`),
        modelProfiles: {},
        image: {
          protocol: 'openai-images',
          baseUrl: 'api.example.com/v1',
          models: ['image-model']
        }
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: customProvider.id
        }
      })

      const workspacePanels = renderer.root.findAllByProps({ role: 'tabpanel' })
        .filter((panel) => String(panel.props.id ?? '').startsWith('provider-workspace-panel-'))
      expect(workspacePanels.map((panel) => panel.props.id)).toEqual([
        'provider-workspace-panel-providers',
        'provider-workspace-panel-routes'
      ])
      expect(workspacePanels.map((panel) => panel.props.hidden)).toEqual([false, true])

      const tabs = renderer.root
        .findAllByProps({ role: 'tab' })
        .filter((tab) => String(tab.props.id ?? '').startsWith('provider-settings-tab-'))
      expect(tabs.map(instanceText)).toEqual(['Connection', 'Models', 'Capabilities', 'Advanced'])
      expect(tabs.map((tab) => tab.props['aria-selected'])).toEqual([true, false, false, false])
      expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1, -1])
      expect(tabs.map((tab) => tab.props['aria-controls'])).toEqual([
        'provider-settings-panel-connection',
        'provider-settings-panel-models',
        'provider-settings-panel-capabilities',
        'provider-settings-panel-advanced'
      ])
      const initialPanel = renderer.root.findByProps({ id: 'provider-settings-panel-connection' })
      expect(initialPanel.props.id).toBe('provider-settings-panel-connection')
      expect(initialPanel.props['aria-labelledby']).toBe('provider-settings-tab-connection')
      const taskPanels = renderer.root.findAllByProps({ role: 'tabpanel' })
        .filter((panel) => String(panel.props.id ?? '').startsWith('provider-settings-panel-'))
      expect(taskPanels.map((panel) => panel.props.id)).toEqual([
        'provider-settings-panel-connection',
        'provider-settings-panel-advanced',
        'provider-settings-panel-models',
        'provider-settings-panel-capabilities'
      ])
      expect(taskPanels.map((panel) => panel.props.hidden)).toEqual([false, true, true, true])
      expect(activePanelText(renderer)).toContain('Provider connection')
      expect(activePanelText(renderer)).not.toContain('Provider models')
      expect(renderer.root.findAllByType('select').some((select) => select.props.value === 'messages')).toBe(true)
      expect(rendererText(renderer)).toContain('Enter provider API key')
      expect(rendererText(renderer)).not.toContain('Inherit API key')

      const preventDefault = vi.fn()
      await act(async () => tabs[0].props.onKeyDown({
        key: 'ArrowRight',
        preventDefault
      }))
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(renderer.root
        .findAllByProps({ role: 'tab' })
        .filter((tab) => String(tab.props.id ?? '').startsWith('provider-settings-tab-'))
        .map((tab) => tab.props.tabIndex))
        .toEqual([-1, 0, -1, -1])
      expect(activePanelText(renderer)).toContain('Provider models')
      expect(activePanelText(renderer)).toContain('Fetch models')
      expect(activePanelText(renderer)).not.toContain('Provider connection')
      const modelSearch = renderer.root.findByProps({
        placeholder: 'providerModelSearchPlaceholder'
      })
      await act(async () => {
        modelSearch.props.onChange({ target: { value: 'custom-model-9' } })
      })

      await clickProviderTab(renderer, 'Capabilities')
      expect(activePanelText(renderer)).toContain('Image capability')
      expect(activePanelText(renderer)).toContain('Speech-to-text capability')
      expect(activePanelText(renderer)).toContain('Speech generation capability')
      expect(activePanelText(renderer)).toContain('Music generation capability')
      expect(activePanelText(renderer)).toContain('Video generation capability')
      expect(activePanelText(renderer)).toContain('Needs configuration')
      const imageCapabilityConfigure = renderer.root.findByProps({
        'aria-label': 'Configure: Image capability'
      })
      expect(imageCapabilityConfigure.props['aria-controls']).toBe('provider-capability-image')

      await clickProviderTab(renderer, 'Models')
      expect(renderer.root.findByProps({
        placeholder: 'providerModelSearchPlaceholder'
      }).props.value).toBe('custom-model-9')

      await clickProviderTab(renderer, 'Advanced')
      const customIdInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === 'custom-provider-2')
      expect(customIdInput?.props.readOnly).toBe(false)
      expect(activePanelText(renderer)).toContain('Provider identity')
      expect(activePanelText(renderer)).toContain('Failure retry')
      expect(rendererText(renderer)).toContain('Danger zone')
      expect(findButton(renderer, 'Remove provider')).toBeTruthy()

      await act(async () => findButtonContaining(renderer, 'DeepSeek').props.onClick())
      expect(renderer.root.findAllByProps({ role: 'tab' })
        .find((tab) => instanceText(tab) === 'Advanced')?.props['aria-selected']).toBe(true)
      expect(activePanelText(renderer)).toContain('Provider identity')
      expect(renderer.root.findAllByType('input')
        .find((input) => input.props.value === DEFAULT_MODEL_PROVIDER_ID)?.props.readOnly).toBe(true)
      expect(rendererText(renderer)).not.toContain('Danger zone')
      expect(renderer.root.findAllByType('button')
        .some((button) => instanceText(button).trim() === 'Remove provider')).toBe(false)
    })

    it('renders and persists provider retry controls in the Advanced tab', async () => {
      const provider = defaultModelProviderSettings()
      const update = vi.fn()
      const customProvider = {
        id: 'retry-provider',
        name: 'Retry Provider',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.com/v1',
        endpointFormat: 'chat_completions',
        retry: {
          maxAttempts: 3,
          initialDelayMs: 3000,
          httpStatusCodes: [429, 503],
          defaultsVersion: 1
        },
        models: ['retry-model'],
        modelProfiles: {}
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: {
          ...provider,
          providers: [...provider.providers, customProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: customProvider.id
        }
      })

      await clickProviderTab(renderer, 'Advanced')
      const panelText = activePanelText(renderer)
      expect(panelText).toContain('Failure retry')
      expect(panelText).toContain('Retry HTTP status codes')
      expect(renderer.root.findAllByType('input').some((input) => input.props.value === '429,503')).toBe(true)
      expect(renderer.root.findAllByType('input').some((input) => input.props.value === '429, 503')).toBe(false)
      expect(panelText).toContain('Separate multiple status codes with commas. Current defaults: 429,500,502,503,504.')
      expect(panelText).toContain('Applies to eligible transport failures and the HTTP statuses listed below.')
      expect(panelText.indexOf('Separate multiple status codes with commas. Current defaults: 429,500,502,503,504.'))
        .toBeLessThan(panelText.indexOf('Retry attempts'))

      const retryCountInput = renderer.root.findAllByType('input')
        .find((input) => input.props.type === 'number' && input.props.value === 3)
      expect(retryCountInput).toBeDefined()
      await act(async () => retryCountInput!.props.onChange({ target: { value: '7' } }))

      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      expect(updatedProviders?.find((item) => item.id === customProvider.id)?.retry?.maxAttempts)
        .toBe(7)
    })

    it('restores the five-retry default when provider retries are re-enabled', async () => {
      const provider = defaultModelProviderSettings()
      const update = vi.fn()
      const disabledProvider = {
        ...provider.providers[0]!,
        id: 'retry-disabled',
        name: 'Retry Disabled',
        retry: {
          maxAttempts: 0,
          initialDelayMs: 3000,
          httpStatusCodes: [429, 500, 502, 503, 504],
          defaultsVersion: 1
        }
      } satisfies ModelProviderProfileV1
      const renderer = await mountProviders({
        ...baseCtx(),
        update,
        provider: {
          ...provider,
          providers: [...provider.providers, disabledProvider]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: disabledProvider.id
        }
      })

      await clickProviderTab(renderer, 'Advanced')
      const retryToggle = renderer.root.findByProps({
        role: 'switch',
        'aria-label': 'Failure retry'
      })
      expect(retryToggle.props['aria-checked']).toBe(false)
      await act(async () => retryToggle.props.onClick())

      const updatedProviders = update.mock.calls.at(-1)?.[0]?.provider?.providers as
        | ModelProviderProfileV1[]
        | undefined
      expect(updatedProviders?.find((item) => item.id === disabledProvider.id)?.retry?.maxAttempts)
        .toBe(5)
      expect(updatedProviders?.find((item) => item.id === disabledProvider.id)?.retry?.httpStatusCodes)
        .toEqual([429, 500, 502, 503, 504])
    })

    it('locks preset IDs and blocks probes without required credentials', async () => {
      const provider = defaultModelProviderSettings()
      const xiaomi = getModelProviderPreset('xiaomi')
      expect(xiaomi).not.toBeNull()
      const renderer = await mountProviders({
        ...baseCtx(),
        provider: {
          ...provider,
          providers: [...provider.providers, modelProviderPresetProfile(xiaomi!)]
        },
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'xiaomi'
        }
      })

      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(rendererText(renderer)).toContain('No API key')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
      expect(findButton(renderer, 'Test connection').props.title).toBe('Enter this provider API key first.')

      await clickProviderTab(renderer, 'Advanced')
      const providerIdInput = renderer.root.findAllByType('input')
        .find((input) => input.props.value === 'xiaomi')
      expect(providerIdInput?.props.readOnly).toBe(true)
      expect(rendererText(renderer)).toContain('Provider ID locked')
      expect(rendererText(renderer)).toContain('Danger zone')
      expect(findButton(renderer, 'Remove provider')).toBeTruthy()

      await act(async () => findButtonContaining(renderer, 'DeepSeek').props.onClick())
      expect(rendererText(renderer)).not.toContain('Danger zone')
      expect(renderer.root.findAllByType('button')
        .some((button) => instanceText(button).trim() === 'Remove provider')).toBe(false)
      expect(rendererText(renderer)).toContain('Needs configuration')
      expect(findButton(renderer, 'Test connection').props.disabled).toBe(true)
    })

    it('keeps the local proxy port editor open and preserves invalid input across rerenders', async () => {
      const update = vi.fn()
      const provider = {
        ...defaultModelProviderSettings(),
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
      }
      const ctx = { ...baseCtx(), provider, update }
      const renderer = await mountProviders(ctx)
      let details = renderer.root.findByType('details')

      await act(async () => details.props.onToggle({ currentTarget: { open: true } }))
      expect(renderer.root.findByType('details').props.open).toBe(true)

      const proxyInput = renderer.root.findByProps({ placeholder: 'e.g. 10808' })
      await act(async () => proxyInput.props.onChange({ target: { value: '10808' } }))
      expect(update).toHaveBeenLastCalledWith({
        provider: { proxy: { enabled: true, url: 'http://127.0.0.1:10808' } }
      })

      await act(async () => proxyInput.props.onChange({ target: { value: '65536' } }))
      expect(update).toHaveBeenLastCalledWith({
        provider: { proxy: { enabled: true, url: 'http://127.0.0.1:65536' } }
      })

      await act(async () => {
        renderer.update(createElement(ProvidersSettingsSection, {
          ctx: { ...ctx, provider: { ...provider, proxy: { enabled: true, url: 'http://127.0.0.1:65536' } } }
        }))
      })
      details = renderer.root.findByType('details')
      expect(details.props.open).toBe(true)
      expect(renderer.root.findByProps({ placeholder: 'e.g. 10808' }).props.value)
        .toBe('65536')
      expect(renderer.root.findByProps({ id: 'provider-proxy-url-error' })).toBeTruthy()
    })
  })
})
