import {
  DEFAULT_MODEL_PROVIDER_ID,
  PptAgentSettingsPanel,
  act,
  createElement,
  createRenderer,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  describe,
  expect,
  getModelProviderPreset,
  it,
  modelProviderPresetProfile,
  modelProvidersSettingsPatch,
  t,
  useChatStore,
  type ModelProviderModelGroup,
  type ModelProviderModelProfileV1,
  type ModelProviderProfileV1,
  type ReactTestRenderer
} from './settings-section-agents.test-support'


describe('AgentsSettingsSection Kun diagnostics smoke', () => {
  it('builds a single patch when adding and selecting a model provider', () => {
    const provider = defaultModelProviderSettings()
    const customProvider = {
      id: 'custom-provider-2',
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'responses',
      models: [],
      modelProfiles: {}
    } satisfies ModelProviderProfileV1

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, customProvider],
      kun: { providerId: customProvider.id }
    })

    expect(patch.provider?.providers).toEqual([...provider.providers, customProvider])
    expect(patch.agents?.kun?.providerId).toBe(customProvider.id)
    expect(patch.agents?.kun?.apiKey).toBe('')
    expect(patch.agents?.kun?.baseUrl).toBe('')
  })

  it('builds a single patch when removing the active model provider', () => {
    const provider = defaultModelProviderSettings()

    const patch = modelProvidersSettingsPatch({
      provider: {
        ...provider,
        providers: [
          ...provider.providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: '',
            baseUrl: 'https://api.example.com/v1',
            endpointFormat: 'responses',
            models: [],
            modelProfiles: {}
          }
        ]
      },
      providers: provider.providers,
      kun: { providerId: DEFAULT_MODEL_PROVIDER_ID }
    })

    expect(patch.provider?.providers).toEqual(provider.providers)
    expect(patch.agents?.kun?.providerId).toBe(DEFAULT_MODEL_PROVIDER_ID)
    expect(patch.agents?.kun?.apiKey).toBe('')
    expect(patch.agents?.kun?.baseUrl).toBe('')
  })

  it('builds a single patch when adding a preset model provider', () => {
    const provider = defaultModelProviderSettings()
    const xiaomi = getModelProviderPreset('xiaomi')
    expect(xiaomi).not.toBeNull()
    const xiaomiProvider = modelProviderPresetProfile(xiaomi!)

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, xiaomiProvider],
      kun: {
        providerId: xiaomiProvider.id,
        model: xiaomiProvider.models[0]
      }
    })

    expect(patch.provider?.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'xiaomi',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        endpointFormat: 'chat_completions',
        models: expect.arrayContaining(['mimo-v2.5'])
      })
    ]))
    expect(patch.agents?.kun).toEqual(expect.objectContaining({
      providerId: 'xiaomi',
      model: xiaomiProvider.models[0]
    }))
  })

  it('defaults MiniMax media generation when adding a configured MiniMax provider', () => {
    const provider = defaultModelProviderSettings()
    const minimax = getModelProviderPreset('minimax')
    expect(minimax).not.toBeNull()
    const minimaxProvider = modelProviderPresetProfile(minimax!, 'sk-minimax')

    const patch = modelProvidersSettingsPatch({
      provider,
      providers: [...provider.providers, minimaxProvider],
      currentKun: defaultKunRuntimeSettings(),
      kun: {
        providerId: minimaxProvider.id,
        model: minimaxProvider.models[0]
      }
    })

    expect(patch.agents?.kun).toEqual(expect.objectContaining({
      providerId: 'minimax',
      model: minimaxProvider.models[0],
      textToSpeech: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'speech-2.8-hd'
      }),
      musicGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'music-2.6'
      }),
      videoGeneration: expect.objectContaining({
        enabled: true,
        providerId: 'minimax',
        model: 'MiniMax-Hailuo-2.3'
      })
    }))
  })

  it('gates the PPT fast toggle on Codex priority support', async () => {
    const codexModelProfile: ModelProviderModelProfileV1 = {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      serviceTiers: ['priority']
    }
    const modelProviders: ModelProviderProfileV1[] = [{
      id: 'codex-2',
      name: 'Codex',
      apiKey: '',
      baseUrl: '',
      endpointFormat: 'chat_completions',
      models: ['gpt-5.4'],
      presetSource: { presetId: 'codex', mode: 'api' },
      modelProfiles: { 'gpt-5.4': codexModelProfile }
    }]
    const groups: ModelProviderModelGroup[] = [{
      providerId: 'codex-2',
      presetSource: 'codex',
      label: 'Codex',
      modelIds: ['gpt-5.4'],
      modelProfiles: { 'gpt-5.4': codexModelProfile }
    }]
    const mount = async (): Promise<ReactTestRenderer> => {
      let renderer!: ReactTestRenderer
      await act(async () => {
        renderer = createRenderer(createElement(PptAgentSettingsPanel, {
          t,
          value: {
            pptAgent: {
              enabled: true,
              model: 'gpt-5.4',
              providerId: 'codex-2',
              fast: true,
              imageFirst: true
            },
            conversationVisualization: { enabled: false }
          },
          modelProviders,
          leadProviderId: 'codex-2',
          leadModel: 'gpt-5.4',
          selectControlClass: 'select',
          onChange: () => undefined
        }))
      })
      return renderer
    }

    useChatStore.setState({ composerModelGroups: groups })
    let renderer = await mount()
    let switches = renderer.root.findAllByProps({ role: 'switch' })
    expect(switches.map((node) => node.props['aria-checked'])).toEqual([true, true, true])
    expect(switches.map((node) => node.props['aria-disabled'])).toEqual([false, false, false])

    useChatStore.setState({ composerModelGroups: [] })
    renderer = await mount()
    switches = renderer.root.findAllByProps({ role: 'switch' })
    expect(switches.map((node) => node.props['aria-checked'])).toEqual([true, true, false])
    expect(switches.map((node) => node.props['aria-disabled'])).toEqual([false, false, true])
  })

})
