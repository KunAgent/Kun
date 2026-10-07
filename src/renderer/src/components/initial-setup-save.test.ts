import { describe, expect, it } from 'vitest'
import {
  getActiveAgentApiKey,
  getKunRuntimeSettings,
  getModelProviderSettings,
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  buildInitialSetupSettings,
  buildInitialSetupSettingsPatch,
  INITIAL_SETUP_PROVIDER_PRESETS,
  initialSetupAutoWirePlan,
  initialSetupDraftFor,
  initialSetupDrafts,
  initialSetupProfileId,
  initialSetupSelection
} from './initial-setup-save'
import { settingsPatchSchema } from '../../../main/ipc/app-ipc-schemas'

function settings(patch: Record<string, unknown> = {}): AppSettingsV1 {
  return normalizeAppSettings(patch as AppSettingsV1)
}

function settingsWithActiveXiaomiWithoutKey(): AppSettingsV1 {
  return settings({
    provider: {
      apiKey: 'sk-deepseek-key',
      baseUrl: 'https://api.deepseek.com',
      providers: [
        { id: 'xiaomi', name: 'Xiaomi', baseUrl: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.5'] }
      ]
    },
    agents: { kun: { providerId: 'xiaomi' } }
  })
}

describe('initialSetupSelection', () => {
  it('preselects the active provider card when it is a known preset', () => {
    const selection = initialSetupSelection(settingsWithActiveXiaomiWithoutKey())
    expect(selection).toEqual({
      presetId: 'xiaomi',
      mode: 'api',
      permissionMode: 'ask-for-approval',
      permissionTouched: false
    })
  })

  it('preselects the token plan mode for token plan profiles', () => {
    const current = settings({ agents: { kun: { providerId: 'minimax-token-plan' } } })
    expect(initialSetupSelection(current)).toEqual({
      presetId: 'minimax',
      mode: 'token-plan',
      permissionMode: 'ask-for-approval',
      permissionTouched: false
    })
  })

  it('falls back to deepseek for unknown or empty active providers', () => {
    const fresh = settings({ agents: { kun: defaultKunRuntimeSettings() } })
    expect(initialSetupSelection(fresh)).toEqual({
      presetId: 'deepseek',
      mode: 'api',
      permissionMode: 'full-access',
      permissionTouched: false
    })
    expect(initialSetupSelection(settings())).toEqual({
      presetId: 'deepseek',
      mode: 'api',
      permissionMode: 'ask-for-approval',
      permissionTouched: false
    })
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'custom-provider-2' } } })))
      .toEqual({
        presetId: 'deepseek',
        mode: 'api',
        permissionMode: 'ask-for-approval',
        permissionTouched: false
      })
  })

  it('preselects any catalog preset and honours a first-run permission default', () => {
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'litellm' } } })).presetId).toBe('litellm')
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'aliyun-token-plan' } } })))
      .toEqual(expect.objectContaining({ presetId: 'aliyun', mode: 'token-plan' }))
    expect(initialSetupSelection(settings({ agents: { kun: { providerId: 'custom-provider-onboarding' } } })).presetId)
      .toBe('custom')
    expect(initialSetupSelection(settings(), { defaultPermissionMode: 'full-access' }).permissionMode)
      .toBe('full-access')
  })

  it('preselects the saved permission mode', () => {
    const current = settings({
      agents: {
        kun: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'user'
        }
      }
    })
    expect(initialSetupSelection(current).permissionMode).toBe('ask-for-approval')

    const delegated = settings({
      agents: {
        kun: {
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'agent'
        }
      }
    })
    expect(initialSetupSelection(delegated).permissionMode).toBe('approve-for-me')

    const nonCanonical = settings({
      agents: { kun: { approvalPolicy: 'auto', sandboxMode: 'workspace-write' } }
    })
    expect(initialSetupSelection(nonCanonical).permissionMode).toBe('ask-for-approval')
  })
})

describe('initialSetupDrafts', () => {
  it('seeds drafts from saved profiles and preset defaults', () => {
    const drafts = initialSetupDrafts(settingsWithActiveXiaomiWithoutKey())
    expect(drafts.deepseek).toEqual({ apiKey: 'sk-deepseek-key', baseUrl: 'https://api.deepseek.com' })
    expect(drafts.xiaomi.apiKey).toBe('')
    expect(drafts['xiaomi-token-plan']).toEqual({
      apiKey: '',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1'
    })
    expect(drafts['minimax-token-plan'].baseUrl).toBe('https://api.minimaxi.com/anthropic')
  })

  it('does not seed LiteLLM as an onboarding provider', () => {
    expect(initialSetupDrafts(settings()).litellm).toBeUndefined()
  })

  it('offers the whole catalog but only seeds drafts that preview auto-wiring', () => {
    const drafts = initialSetupDrafts(settings())

    expect(INITIAL_SETUP_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['xiaomi', 'minimax', 'kimi-code', 'moonshot-cn', 'ollama-local', 'codex'])
    )
    for (const id of ['litellm', 'zhipu-coding-plan', 'kimi-code', 'moonshot-cn']) {
      expect(drafts[id]).toBeUndefined()
      expect(initialSetupSelection(settings({ agents: { kun: { providerId: id } } })).presetId).toBe(id)
    }
    expect(initialSetupDraftFor(drafts, 'moonshot-cn')).toEqual({
      apiKey: '',
      baseUrl: INITIAL_SETUP_PROVIDER_PRESETS.find((preset) => preset.id === 'moonshot-cn')!.baseUrl
    })
  })
})

describe('buildInitialSetupSettings', () => {
  it('activates deepseek so the boot gate sees the key the user typed', () => {
    const current = settingsWithActiveXiaomiWithoutKey()
    const drafts = initialSetupDrafts(current)
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'deepseek', mode: 'api' })

    expect(next.initialSetupCompleted).toBe(true)
    expect(getKunRuntimeSettings(next).providerId).toBe('deepseek')
    expect(getActiveAgentApiKey(next)).toBe('sk-deepseek-key')
  })

  it('stores the selected default Agent permission mode', () => {
    const current = settingsWithActiveXiaomiWithoutKey()
    const drafts = initialSetupDrafts(current)
    const next = buildInitialSetupSettings(current, drafts, {
      presetId: 'deepseek',
      mode: 'api',
      permissionMode: 'approve-for-me',
      permissionTouched: true
    })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.approvalPolicy).toBe('on-request')
    expect(runtime.sandboxMode).toBe('workspace-write')
    expect(runtime.approvalReviewer).toBe('agent')
  })

  it('preserves a non-UI permission policy when the selector is untouched', () => {
    // A persisted policy the 3-mode UI cannot represent: stricter approval gate
    // plus a sandboxed filesystem. Reopening onboarding seeds the selector from
    // the lossy projection (-> Ask for approval); when the user does not move
    // it, the save must leave the strict snapshot intact.
    const current = settings({
      provider: { apiKey: 'sk-deepseek-key' },
      agents: {
        kun: { providerId: 'deepseek', approvalPolicy: 'never', sandboxMode: 'external-sandbox' }
      }
    })
    const seededMode = initialSetupSelection(current).permissionMode
    expect(seededMode).toBe('ask-for-approval')

    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api',
      permissionMode: seededMode,
      permissionTouched: false
    })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.approvalPolicy).toBe('never')
    expect(runtime.sandboxMode).toBe('external-sandbox')
    expect(runtime.approvalPolicy).not.toBe('on-request')
    expect(runtime.sandboxMode).not.toBe('danger-full-access')
  })

  it('canonicalizes a projected legacy mode only after the user selects it', () => {
    // The visible Ask card is already selected by projection. The explicit
    // touched flag distinguishes a real click from an untouched lossy view.
    const current = settings({
      provider: { apiKey: 'sk-deepseek-key' },
      agents: {
        kun: { providerId: 'deepseek', approvalPolicy: 'never', sandboxMode: 'external-sandbox' }
      }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api',
      permissionMode: 'ask-for-approval',
      permissionTouched: true
    })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.approvalPolicy).toBe('on-request')
    expect(runtime.sandboxMode).toBe('workspace-write')
    expect(runtime.approvalReviewer).toBe('user')
  })

  it('syncs the deepseek draft into the provider profile used by settings', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-old',
        baseUrl: 'https://old.example/v1'
      },
      agents: { kun: { providerId: 'deepseek' } }
    })
    const drafts = initialSetupDrafts(current)
    drafts.deepseek = {
      apiKey: 'sk-new',
      baseUrl: 'https://new.example/v1'
    }

    const next = buildInitialSetupSettings(current, drafts, { presetId: 'deepseek', mode: 'api' })
    const provider = getModelProviderSettings(next)
    const deepseek = provider.providers.find((profile) => profile.id === 'deepseek')

    expect(provider.apiKey).toBe('sk-new')
    expect(provider.baseUrl).toBe('https://new.example/v1')
    expect(deepseek?.apiKey).toBe('sk-new')
    expect(deepseek?.baseUrl).toBe('https://new.example/v1')
  })

  it('creates a token plan profile and activates it', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts['xiaomi-token-plan'] = {
      apiKey: 'tp-subscription-key',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'token-plan' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi-token-plan')
    expect(profile?.apiKey).toBe('tp-subscription-key')
    expect(profile?.baseUrl).toBe('https://token-plan-sgp.xiaomimimo.com/v1')
    expect(profile?.endpointFormat).toBe('chat_completions')
    expect(profile?.speech).toEqual({
      protocol: 'mimo-asr',
      baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
      models: ['mimo-v2.5-asr']
    })
    expect(profile?.modelProfiles['mimo-v2.5']).toEqual(expect.objectContaining({
      inputModalities: expect.arrayContaining(['image']),
      messageParts: expect.arrayContaining(['image_url'])
    }))
    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('xiaomi-token-plan')
    expect(runtime.model).toBe(profile?.models[0])
    expect(getActiveAgentApiKey(next)).toBe('tp-subscription-key')
  })

  it('auto-wires speech and image to filled pay-as-you-go profiles', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    drafts.minimax = { ...drafts.minimax, apiKey: 'mm-key' }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'xiaomi', mode: 'api' })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.speechToText.enabled).toBe(true)
    expect(runtime.speechToText.providerId).toBe('xiaomi')
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.imageGeneration.providerId).toBe('minimax')
    expect(getModelProviderSettings(next).providers.find((p) => p.id === 'xiaomi')?.speech?.protocol)
      .toBe('mimo-asr')
  })

  it('wires speech from a xiaomi token plan key and image from a minimax token plan key', () => {
    const tokenPlanOnly = initialSetupDrafts(settings())
    tokenPlanOnly['xiaomi-token-plan'] = { ...tokenPlanOnly['xiaomi-token-plan'], apiKey: 'tp-key' }
    tokenPlanOnly['minimax-token-plan'] = { ...tokenPlanOnly['minimax-token-plan'], apiKey: 'mm-tp-key' }
    expect(initialSetupAutoWirePlan(settings(), tokenPlanOnly))
      .toEqual({ speechProviderId: 'xiaomi-token-plan', imageProviderId: 'minimax-token-plan' })
  })

  it('creates a MiniMax token plan profile with image generation and activates it', () => {
    const current = settings()
    const drafts = initialSetupDrafts(current)
    drafts['minimax-token-plan'] = {
      apiKey: 'mm-tp-key',
      baseUrl: 'https://api.minimaxi.com/anthropic'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'minimax', mode: 'token-plan' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'minimax-token-plan')
    expect(profile?.apiKey).toBe('mm-tp-key')
    expect(profile?.image).toEqual({
      protocol: 'minimax-image',
      baseUrl: 'https://api.minimaxi.com',
      models: ['image-01', 'image-01-live']
    })

    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('minimax-token-plan')
    expect(runtime.imageGeneration.enabled).toBe(true)
    expect(runtime.imageGeneration.providerId).toBe('minimax-token-plan')
    expect(getActiveAgentApiKey(next)).toBe('mm-tp-key')
  })

  it('never overrides existing speech or image generation config while auto-wiring', () => {
    const configured = settings({ agents: { kun: { speechToText: { providerId: 'custom' } } } })
    const drafts = initialSetupDrafts(configured)
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    const next = buildInitialSetupSettings(configured, drafts, { presetId: 'xiaomi', mode: 'api' })
    expect(getKunRuntimeSettings(next).speechToText.providerId).toBe('custom')

    const imageConfigured = settings({ agents: { kun: { imageGeneration: { providerId: 'custom-image' } } } })
    const imageDrafts = initialSetupDrafts(imageConfigured)
    imageDrafts['minimax-token-plan'] = { ...imageDrafts['minimax-token-plan'], apiKey: 'mm-tp-key' }
    const nextImage = buildInitialSetupSettings(imageConfigured, imageDrafts, { presetId: 'minimax', mode: 'token-plan' })
    expect(getKunRuntimeSettings(nextImage).imageGeneration.providerId).toBe('custom-image')
  })

  it('prefers the pay-as-you-go profile for speech when both keys are filled', () => {
    const drafts = initialSetupDrafts(settings())
    drafts.xiaomi = { ...drafts.xiaomi, apiKey: 'sk-mimo-key' }
    drafts['xiaomi-token-plan'] = { ...drafts['xiaomi-token-plan'], apiKey: 'tp-key' }
    expect(initialSetupAutoWirePlan(settings(), drafts).speechProviderId).toBe('xiaomi')
  })

  it('keeps the model override when the provider does not change', () => {
    const current = settings({
      provider: { apiKey: 'sk-deepseek-key' },
      agents: { kun: { providerId: 'deepseek', model: 'deepseek-v4-flash' } }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api'
    })
    expect(getKunRuntimeSettings(next).model).toBe('deepseek-v4-flash')
  })

  it('preserves unrelated custom providers', () => {
    const current = settings({
      provider: {
        apiKey: 'sk-deepseek-key',
        providers: [
          { id: 'custom-provider-2', name: 'zenmux', apiKey: 'z-key', baseUrl: 'https://zenmux.ai/api' }
        ]
      }
    })
    const next = buildInitialSetupSettings(current, initialSetupDrafts(current), {
      presetId: 'deepseek',
      mode: 'api'
    })
    const zenmux = getModelProviderSettings(next).providers.find((p) => p.id === 'custom-provider-2')
    expect(zenmux?.apiKey).toBe('z-key')
  })
})

describe('buildInitialSetupSettings for the full catalog', () => {
  it('activates a keyless local provider with the discovered models', () => {
    const current = settings({ provider: { apiKey: 'sk-deepseek-key' } })
    const drafts = initialSetupDrafts(current)
    drafts['ollama-local'] = {
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen3:8b', 'gemma3:12b'],
      model: 'gemma3:12b'
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'ollama-local', mode: 'api' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'ollama-local')
    expect([...(profile?.models ?? [])].sort()).toEqual(['gemma3:12b', 'qwen3:8b'])
    const runtime = getKunRuntimeSettings(next)
    expect(runtime.providerId).toBe('ollama-local')
    expect(runtime.model).toBe('gemma3:12b')
  })

  it('creates the onboarding custom provider from its draft', () => {
    const current = settings({ provider: { apiKey: 'sk-deepseek-key' } })
    const drafts = initialSetupDrafts(current)
    drafts['custom-provider-onboarding'] = {
      apiKey: 'relay-key',
      baseUrl: 'https://relay.example.com/v1',
      name: 'Team relay',
      endpointFormat: 'messages',
      models: ['claude-sonnet-relay']
    }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'custom', mode: 'api' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'custom-provider-onboarding')
    expect(profile).toEqual(expect.objectContaining({
      name: 'Team relay',
      baseUrl: 'https://relay.example.com/v1',
      endpointFormat: 'messages',
      models: ['claude-sonnet-relay']
    }))
    expect(getKunRuntimeSettings(next).providerId).toBe('custom-provider-onboarding')
    expect(getKunRuntimeSettings(next).model).toBe('claude-sonnet-relay')
  })

  it('connects any catalog preset with a key and picks its first model', () => {
    const current = settings({ provider: { apiKey: 'sk-deepseek-key' } })
    const drafts = initialSetupDrafts(current)
    drafts['moonshot-cn'] = { ...initialSetupDraftFor(drafts, 'moonshot-cn'), apiKey: 'sk-moonshot' }
    const next = buildInitialSetupSettings(current, drafts, { presetId: 'moonshot-cn', mode: 'api' })

    const profile = getModelProviderSettings(next).providers.find((p) => p.id === 'moonshot-cn')
    expect(profile?.apiKey).toBe('sk-moonshot')
    expect(getKunRuntimeSettings(next).model).toBe(profile?.models[0])
    expect(getActiveAgentApiKey(next)).toBe('sk-moonshot')
  })
})

describe('buildInitialSetupSettingsPatch', () => {
  it('omits legacy top-level instructions from the settings:set payload', () => {
    const current = settings({
      instructions: { enabled: true },
      provider: { apiKey: '' },
      agents: { kun: { providerId: 'deepseek' } }
    })
    const drafts = initialSetupDrafts(current)
    drafts.deepseek = {
      ...drafts.deepseek,
      apiKey: 'sk-deepseek-key',
      baseUrl: 'https://api.deepseek.com'
    }

    const patch = buildInitialSetupSettingsPatch(current, drafts, {
      presetId: 'deepseek',
      mode: 'api'
    })

    expect('instructions' in patch).toBe(false)
    expect(settingsPatchSchema.parse(patch)).toEqual(patch)
    expect(JSON.stringify(patch)).not.toContain('sk-deepseek-key')
    expect(patch.provider?.providers?.every((provider) => !provider.apiKey)).toBe(true)
  })
})

describe('initialSetupProfileId', () => {
  it('maps selection to profile ids', () => {
    expect(initialSetupProfileId({ presetId: 'deepseek', mode: 'api' })).toBe('deepseek')
    expect(initialSetupProfileId({ presetId: 'xiaomi', mode: 'token-plan' })).toBe('xiaomi-token-plan')
    expect(initialSetupProfileId({ presetId: 'minimax', mode: 'api' })).toBe('minimax')
  })
})
