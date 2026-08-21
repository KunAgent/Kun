import {
  defaultModelProviderSettings,
  type ModelProviderModelProfileV1
} from '@shared/app-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  deleteSharedModelConnection,
  geminiCliApiCatalogPatch,
  kunProviderSelectionPatch,
  modelProvidersSettingsPatch,
  nonEmptyModelId,
  selectSharedModelConnection,
  sharedModelConnectionHasUsableCredential,
  sharedProviderSetupNeedsApiKey,
  shouldUseSharedModelConnectionProbe
} from './settings-section-providers'

const textModelProfile: ModelProviderModelProfileV1 = {
  inputModalities: ['text'],
  outputModalities: ['text'],
  supportsToolCalling: true,
  messageParts: ['text']
}

describe('gemini CLI API catalog sync', () => {
  it('merges synced ids with user-added newer releases and keeps wire casing', () => {
    const patch = geminiCliApiCatalogPatch(
      ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
      ['gemini-3.7-pro-preview', 'GEMINI-3.1-pro-preview'],
      { 'gemini-2.5-pro': textModelProfile }
    )
    expect(patch.models).toEqual([
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro',
      'gemini-3.7-pro-preview'
    ])
    expect(patch.modelProfiles['gemini-2.5-pro']).toBe(textModelProfile)
    const added = patch.modelProfiles['gemini-3.7-pro-preview']
    expect(added).toMatchObject({
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text', 'image_url']
    })
    expect(added?.reasoning).toMatchObject({ defaultEffort: 'medium' })
  })

  it('preserves an existing profile for an id that only differs in casing', () => {
    const profile: ModelProviderModelProfileV1 = {
      ...textModelProfile,
      contextWindowTokens: 1_048_576
    }
    const patch = geminiCliApiCatalogPatch(
      ['gemini-3.7-pro-preview'],
      ['Gemini-3.7-Pro-Preview'],
      { 'Gemini-3.7-Pro-Preview': profile }
    )
    expect(patch.models).toEqual(['gemini-3.7-pro-preview'])
    expect(patch.modelProfiles['gemini-3.7-pro-preview']).toBe(profile)
  })
})

describe('provider settings patch model sanitization', () => {
  it('omits empty agents.kun.model so settings:set cannot receive Too small', () => {
    const provider = defaultModelProviderSettings()
    const patch = modelProvidersSettingsPatch({
      provider,
      providers: provider.providers,
      kun: { providerId: 'opencode-go', model: '' }
    })

    expect(patch.agents?.kun).toEqual({
      providerId: 'opencode-go',
      apiKey: '',
      baseUrl: ''
    })
    expect(patch.agents?.kun).not.toHaveProperty('model')
  })

  it('keeps a non-empty primary model on the kun selection patch', () => {
    const provider = defaultModelProviderSettings()
    const patch = modelProvidersSettingsPatch({
      provider,
      providers: provider.providers,
      kun: { providerId: 'opencode-go', model: 'grok-4.5' }
    })

    expect(patch.agents?.kun).toMatchObject({
      providerId: 'opencode-go',
      model: 'grok-4.5'
    })
  })

  it('builds selection patches that skip blank model ids', () => {
    expect(nonEmptyModelId('')).toBeUndefined()
    expect(nonEmptyModelId('  ')).toBeUndefined()
    expect(nonEmptyModelId('grok-4.5')).toBe('grok-4.5')
    expect(kunProviderSelectionPatch({ providerId: 'custom', model: '' })).toEqual({
      providerId: 'custom'
    })
    expect(kunProviderSelectionPatch({
      providerId: 'opencode-go',
      model: nonEmptyModelId('') ?? nonEmptyModelId('')
    })).toEqual({ providerId: 'opencode-go' })
    expect(kunProviderSelectionPatch({
      providerId: 'opencode-go',
      model: nonEmptyModelId('') ?? 'glm-5.2'
    })).toEqual({
      providerId: 'opencode-go',
      model: 'glm-5.2'
    })
  })
})

describe('shared model connection API-key setup status', () => {
  it('treats missing and unreadable protected credentials as unavailable', () => {
    expect(sharedModelConnectionHasUsableCredential({ configured: true })).toBe(true)
    expect(sharedModelConnectionHasUsableCredential({
      configured: true,
      credentialStatus: 'ready'
    })).toBe(true)
    expect(sharedModelConnectionHasUsableCredential({
      configured: true,
      credentialStatus: 'missing'
    })).toBe(false)
    expect(sharedModelConnectionHasUsableCredential({
      configured: true,
      credentialStatus: 'unreadable'
    })).toBe(false)
  })

  it('accepts a credential held only by the protected shared registry', () => {
    const providers = defaultModelProviderSettings().providers

    expect(sharedProviderSetupNeedsApiKey(providers, {
      schemaVersion: 1,
      revision: 1,
      providers: [{
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        configured: true,
        models: ['deepseek-chat']
      }]
    })).toBe(false)
  })

  it('uses the stored shared credential to probe a custom provider without a preset', () => {
    const customProvider = {
      ...defaultModelProviderSettings().providers[0]!,
      id: 'custom-provider-without-preset',
      presetSource: undefined,
      apiKey: ''
    }

    expect(shouldUseSharedModelConnectionProbe(customProvider, {
      configured: true,
      credentialStatus: 'ready'
    })).toBe(true)
    expect(shouldUseSharedModelConnectionProbe(
      { ...customProvider, apiKey: 'form-api-key' },
      { configured: true, credentialStatus: 'ready' }
    )).toBe(false)
    expect(shouldUseSharedModelConnectionProbe(customProvider, {
      configured: true,
      credentialStatus: 'missing'
    })).toBe(false)
  })

  it('requests setup only after the shared registry confirms no credential', () => {
    const providers = defaultModelProviderSettings().providers

    expect(sharedProviderSetupNeedsApiKey(providers, null)).toBe(false)
    expect(sharedProviderSetupNeedsApiKey(providers, {
      schemaVersion: 1,
      revision: 1,
      providers: [{
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        configured: false,
        models: ['deepseek-chat']
      }]
    })).toBe(true)
  })

  it('requests setup when a legacy credential binding is unreadable', () => {
    const providers = defaultModelProviderSettings().providers

    expect(sharedProviderSetupNeedsApiKey(providers, {
      schemaVersion: 1,
      revision: 2,
      providers: [{
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        baseUrl: 'https://api.deepseek.com',
        endpointFormat: 'chat_completions',
        configured: true,
        credentialStatus: 'unreadable',
        credentialErrorCode: 'credential_unreadable',
        models: ['deepseek-chat']
      }]
    })).toBe(true)
  })
})

describe('shared model connection deletion', () => {
  it('removes the canonical connection and retries one concurrent revision change', async () => {
    const connection = {
      id: 'custom-provider-2',
      accountId: 'account:custom-provider-2',
      name: 'Custom Provider',
      kind: 'http' as const,
      authType: 'api-key' as const,
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions' as const,
      configured: true,
      models: ['custom-model']
    }
    const snapshot = (revision: number, providers = [connection]) => ({
      schemaVersion: 1 as const,
      revision,
      providers
    })
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(3)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(4) })
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(5, [])) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(deleteSharedModelConnection(connection.id)).resolves.toMatchObject({
        revision: 5,
        providers: []
      })
      expect(runtimeRequest.mock.calls.map(([path, method]) => [path, method])).toEqual([
        ['/v1/model-connections', 'GET'],
        ['/v1/model-connections/custom-provider-2?expected_revision=3', 'DELETE'],
        ['/v1/model-connections/custom-provider-2?expected_revision=4', 'DELETE']
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('treats a concurrent deletion as an idempotent success', async () => {
    const connection = {
      id: 'custom-provider-2',
      accountId: 'account:custom-provider-2',
      name: 'Custom Provider',
      kind: 'http' as const,
      authType: 'api-key' as const,
      endpointFormat: 'chat_completions' as const,
      configured: true,
      models: ['custom-model']
    }
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ schemaVersion: 1, revision: 9, providers: [connection] })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: { schemaVersion: 1, revision: 10, providers: [] } })
      })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(deleteSharedModelConnection(connection.id)).resolves.toMatchObject({
        revision: 10,
        providers: []
      })
      expect(runtimeRequest).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('shared model connection selection', () => {
  const connection = (revisionName = 'account:custom-provider-2') => ({
    id: 'custom-provider-2',
    accountId: revisionName,
    name: 'Custom Provider',
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions' as const,
    configured: true,
    models: ['custom-model']
  })
  const snapshot = (revision: number, providers = [connection()]) => ({
    schemaVersion: 1 as const,
    revision,
    providers
  })

  it('reads the latest revision and retries one selection conflict with the refreshed account', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(7)) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: JSON.stringify({ snapshot: snapshot(8, [connection('account:refreshed')]) })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          ...snapshot(9, [connection('account:refreshed')]),
          defaultProviderId: 'custom-provider-2',
          defaultAccountId: 'account:refreshed',
          defaultModel: 'custom-model'
        })
      })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(selectSharedModelConnection('custom-provider-2', 'custom-model'))
        .resolves.toMatchObject({ revision: 9, defaultAccountId: 'account:refreshed' })
      expect(runtimeRequest.mock.calls.map(([path, method, body]) => [
        path,
        method,
        body ? JSON.parse(body) : undefined
      ])).toEqual([
        ['/v1/model-connections', 'GET', undefined],
        ['/v1/model-connections/select', 'POST', {
          expectedRevision: 7,
          providerId: 'custom-provider-2',
          accountId: 'account:custom-provider-2',
          model: 'custom-model'
        }],
        ['/v1/model-connections/select', 'POST', {
          expectedRevision: 8,
          providerId: 'custom-provider-2',
          accountId: 'account:refreshed',
          model: 'custom-model'
        }]
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not select a provider that is tombstoned or absent from the latest registry', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(11)) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify(snapshot(12, [])) })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      await expect(selectSharedModelConnection(
        'custom-provider-2',
        'custom-model',
        () => true
      )).rejects.toThrow(/pending deletion/)
      await expect(selectSharedModelConnection('custom-provider-2', 'custom-model'))
        .rejects.toThrow(/no longer available/)
      expect(runtimeRequest.mock.calls.every(([, method]) => method === 'GET')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
