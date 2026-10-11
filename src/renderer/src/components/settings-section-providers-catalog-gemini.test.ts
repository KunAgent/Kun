import {
  defaultModelProviderSettings,
  defaultModelRequestRetrySettings
} from '@shared/app-settings'
import { describe, expect, it, vi } from 'vitest'
import {
  commitSharedModelConnectionCatalog,
  projectSharedModelConnections,
  sharedConnectionBaseUrlOptional
} from './settings-section-providers'
import type { SharedModelConnectionsSnapshot } from './settings-section-providers-shared-api'

describe('keyless gemini-cli-api shared connections', () => {
  const geminiProvider = {
    id: 'gemini-cli-subscription',
    name: 'Gemini CLI subscription',
    apiKey: '',
    baseUrl: '',
    endpointFormat: 'custom_endpoint' as const,
    useProxy: false,
    kind: 'gemini-cli-api' as const,
    retry: defaultModelRequestRetrySettings(),
    models: ['gemini-3.7-pro-preview'],
    modelProfiles: {}
  }

  it('treats gemini-cli-api as a keyless transport without requiring baseUrl', () => {
    expect(sharedConnectionBaseUrlOptional('gemini-cli-api')).toBe(true)
    expect(sharedConnectionBaseUrlOptional('gemini-code-assist')).toBe(true)
    expect(sharedConnectionBaseUrlOptional('http')).toBe(false)
    expect(sharedConnectionBaseUrlOptional(undefined)).toBe(false)
  })

  it('projects a connected keyless gemini connection back into settings', () => {
    const current = defaultModelProviderSettings()
    const snapshot: SharedModelConnectionsSnapshot = {
      schemaVersion: 1,
      proxyRoutingVersion: 1 as const,
      revision: 3,
      providers: [{
        id: 'gemini-cli-subscription',
        accountId: 'account:gemini-cli-subscription',
        name: 'Gemini CLI subscription',
        kind: 'gemini-cli-api',
        authType: 'subscription',
        endpointFormat: 'custom_endpoint',
        useProxy: false,
        configured: true,
        models: ['gemini-3.7-pro-preview']
      }],
      defaultProviderId: 'gemini-cli-subscription',
      defaultAccountId: 'account:gemini-cli-subscription',
      defaultModel: 'gemini-3.7-pro-preview'
    }
    const projected = projectSharedModelConnections(current, snapshot)
    const projectedProvider = projected.provider.providers
      .find((item) => item.id === 'gemini-cli-subscription')
    expect(projectedProvider).toMatchObject({
      kind: 'gemini-cli-api',
      baseUrl: '',
      models: ['gemini-3.7-pro-preview']
    })
    expect(projected.kun).toEqual({
      providerId: 'gemini-cli-subscription',
      model: 'gemini-3.7-pro-preview'
    })
  })

  it('connects a catalog commit for a keyless gemini provider without baseUrl or credential', async () => {
    const pending = {
      generation: 1,
      baseModels: ['gemini-3.1-pro-preview'],
      baseModelProfiles: {},
      localModels: ['gemini-3.7-pro-preview', 'gemini-3.1-pro-preview'],
      localModelProfiles: {},
      committedRevision: null
    }
    const snapshot = (revision: number, includeConnection = false) => ({
      schemaVersion: 1 as const,
      proxyRoutingVersion: 1 as const,
      revision,
      providers: includeConnection
        ? [{
            id: 'gemini-cli-subscription',
            accountId: 'account:gemini-cli-subscription',
            name: 'Gemini CLI subscription',
            kind: 'gemini-cli-api' as const,
            authType: 'subscription' as const,
            endpointFormat: 'custom_endpoint' as const,
            useProxy: false,
            configured: true,
            models: [],
            selectedModel: 'gemini-3.7-pro-preview'
          }]
        : []
    })
    let connected = false
    const runtimeRequest = vi.fn(async (path: string, method: string, body?: string) => {
      if (path === '/v1/model-connections' && method === 'GET') {
        return { ok: true, status: 200, body: JSON.stringify(snapshot(connected ? 8 : 7, connected)) }
      }
      if (path === '/v1/model-connections/connect' && method === 'POST') {
        connected = true
        return { ok: true, status: 201, body: JSON.stringify(snapshot(8, true)) }
      }
      if (
        path === '/v1/model-connections/gemini-cli-subscription' && method === 'PATCH'
      ) {
        return { ok: true, status: 200, body: JSON.stringify(snapshot(9)) }
      }
      throw new Error(`Unexpected runtime request: ${method} ${path}`)
    })
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })

    try {
      const result = await commitSharedModelConnectionCatalog(
        'gemini-cli-subscription',
        pending,
        () => false,
        { provider: geminiProvider }
      )
      expect(result.revision).toBe(9)
      const connectCall = runtimeRequest.mock.calls.find(
        ([path, method]) => path === '/v1/model-connections/connect' && method === 'POST'
      )
      expect(connectCall).toBeDefined()
      const connectBody = JSON.parse(connectCall![2] as string) as Record<string, unknown>
      expect(connectBody.kind).toBe('gemini-cli-api')
      expect(connectBody).not.toHaveProperty('baseUrl')
      expect(connectBody).not.toHaveProperty('credential')
      expect(connectBody.models).toEqual(['gemini-3.7-pro-preview', 'gemini-3.1-pro-preview'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
