import { describe, expect, it } from 'vitest'
import { exposableProvider } from '../../domain/model-gateway-export-policy.js'
import { gatewayExportSnapshot } from './gateway-subscription-export.js'

const base = { accountId: 'a', name: 'n', endpointFormat: 'responses', useProxy: false, configured: true, credentialStatus: 'ready', models: ['gpt'] } as const

describe('experimental subscription export', () => {
  const snapshot = { schemaVersion: 1, proxyRoutingVersion: 1, revision: 1, routePools: [], failover: [], proxy: { enabled: false, url: '' },
    localModelGateway: { enabled: true, exposeProviderModels: true },
    providers: [{ ...base, id: 'codex', presetSource: 'codex', kind: 'http', authType: 'oauth' },
      { ...base, id: 'claude-subscription', presetSource: 'claude-subscription', kind: 'agent-sdk', authType: 'subscription' }] } as never
  it('stays blocked unless the ChatGPT connection is opted in', () => {
    const blocked = gatewayExportSnapshot(snapshot, [])
    expect(blocked.providers.filter((provider) => exposableProvider(provider))).toEqual([])
    const shared = gatewayExportSnapshot(snapshot, ['codex', 'claude-subscription'])
    expect(shared.providers.filter((provider) => exposableProvider(provider)).map((provider) => provider.id)).toEqual(['codex'])
  })
})
