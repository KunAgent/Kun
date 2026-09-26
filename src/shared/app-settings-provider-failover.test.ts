import { describe, expect, it } from 'vitest'
import type {
  ModelProviderFailoverV1,
  ModelProviderProfileV1
} from './app-settings-types'
import {
  modelProviderFailoverAfterRemoval,
  modelProviderIsOauthOrDelegated,
  normalizeModelProviderFailover,
  projectFailoverGroupsForRuntime
} from './app-settings-provider-failover'

function profile(patch: Partial<ModelProviderProfileV1>): ModelProviderProfileV1 {
  return {
    id: 'provider',
    name: 'Provider',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    models: ['model-x'],
    modelProfiles: {},
    ...patch
  }
}

function group(patch: Partial<ModelProviderFailoverV1>): ModelProviderFailoverV1 {
  return {
    providerId: 'main',
    accounts: [],
    strategy: 'smart',
    fallbackTargets: [],
    ...patch
  }
}

describe('normalizeModelProviderFailover', () => {
  it('deduplicates the representative from accounts and drops unknown strategies', () => {
    const [entry] = normalizeModelProviderFailover([
      {
        providerId: 'Main',
        accounts: [
          { providerId: 'main', enabled: true },
          { providerId: 'alt', enabled: false },
          { providerId: 'alt', enabled: true }
        ],
        strategy: 'bogus' as never,
        fallbackTargets: [
          { providerId: 'backup', modelId: 'model-x' },
          // A fallback pointing at a member provider is meaningless.
          { providerId: 'alt', modelId: 'model-x' }
        ]
      }
    ])
    expect(entry.providerId).toBe('main')
    expect(entry.accounts).toEqual([{ providerId: 'alt', enabled: false }])
    expect(entry.strategy).toBe('smart')
    expect(entry.fallbackTargets).toEqual([{ providerId: 'backup', modelId: 'model-x' }])
  })
})

describe('projectFailoverGroupsForRuntime', () => {
  const providers = [
    profile({ id: 'main', models: ['model-x', 'model-y'] }),
    profile({ id: 'alt', models: ['model-x'] }),
    profile({ id: 'sub', kind: 'agent-sdk', models: ['model-x'] }),
    profile({
      id: 'codex-2',
      presetSource: { presetId: 'codex', mode: 'api' },
      models: ['gpt-5.5']
    })
  ]

  it('keeps rotate for api-key-only groups', () => {
    const projected = projectFailoverGroupsForRuntime({
      providers,
      failover: [group({ accounts: [{ providerId: 'alt', enabled: true }], strategy: 'rotate' })]
    })
    expect(projected[0].strategy).toBe('rotate')
    expect(projected[0].members.map((member) => member.providerId)).toEqual(['main', 'alt'])
  })

  it('demotes rotate to smart when any member is a delegated-runtime account', () => {
    const projected = projectFailoverGroupsForRuntime({
      providers,
      failover: [group({ accounts: [{ providerId: 'sub', enabled: true }], strategy: 'rotate' })]
    })
    expect(projected[0].strategy).toBe('smart')
  })

  it('demotes least-used to smart when a member resolves to a subscription preset', () => {
    const projected = projectFailoverGroupsForRuntime({
      providers,
      failover: [group({ accounts: [{ providerId: 'codex-2', enabled: true }], strategy: 'least-used' })]
    })
    expect(projected[0].strategy).toBe('smart')
  })

  it('keeps order for OAuth groups since order already preserves priority', () => {
    const projected = projectFailoverGroupsForRuntime({
      providers,
      failover: [group({ accounts: [{ providerId: 'sub', enabled: true }], strategy: 'order' })]
    })
    expect(projected[0].strategy).toBe('order')
  })

  it('drops fallback targets whose provider or model is unknown', () => {
    const projected = projectFailoverGroupsForRuntime({
      providers,
      failover: [group({
        fallbackTargets: [
          { providerId: 'alt', modelId: 'model-x' },
          { providerId: 'alt', modelId: 'missing-model' },
          { providerId: 'ghost', modelId: 'model-x' }
        ]
      })]
    })
    expect(projected[0].fallbackTargets).toEqual([{ providerId: 'alt', modelId: 'model-x' }])
  })
})

describe('modelProviderIsOauthOrDelegated', () => {
  it('flags delegated kinds and subscription presets only', () => {
    expect(modelProviderIsOauthOrDelegated(profile({ kind: 'gemini-cli-api' }))).toBe(true)
    expect(modelProviderIsOauthOrDelegated(profile({ kind: 'http' }))).toBe(false)
    expect(modelProviderIsOauthOrDelegated(profile({
      id: 'codex-3',
      presetSource: { presetId: 'codex', mode: 'api' }
    }))).toBe(true)
    expect(modelProviderIsOauthOrDelegated(profile({
      id: 'deepseek-2',
      presetSource: { presetId: 'deepseek', mode: 'api' }
    }))).toBe(false)
    expect(modelProviderIsOauthOrDelegated(undefined)).toBe(false)
  })
})

describe('modelProviderFailoverAfterRemoval', () => {
  it('drops the group for a removed representative and prunes member references', () => {
    const failover = [
      group({ providerId: 'gone' }),
      group({
        providerId: 'main',
        accounts: [{ providerId: 'gone', enabled: true }, { providerId: 'alt', enabled: true }],
        fallbackTargets: [{ providerId: 'gone', modelId: 'm' }, { providerId: 'alt', modelId: 'm' }]
      })
    ]
    const result = modelProviderFailoverAfterRemoval(failover, 'gone')
    expect(result).toHaveLength(1)
    expect(result[0].accounts).toEqual([{ providerId: 'alt', enabled: true }])
    expect(result[0].fallbackTargets).toEqual([{ providerId: 'alt', modelId: 'm' }])
  })

  it('drops a representative-only group once its last account is removed', () => {
    const failover = [group({
      providerId: 'main',
      accounts: [{ providerId: 'gone', enabled: true }]
    })]
    // With no accounts and no fallbacks left the group is a no-op and is
    // dropped, even though its representative still exists.
    expect(modelProviderFailoverAfterRemoval(failover, 'gone')).toHaveLength(0)
  })
})
