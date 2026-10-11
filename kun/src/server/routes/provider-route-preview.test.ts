import { describe, expect, it, vi } from 'vitest'
import { previewProviderRoute } from './provider-route-preview.js'
import { GatewayClientPolicySchema } from '../../contracts/gateway-client-policy.js'
import type { ServerRuntime } from './server-runtime.js'

describe('read-only route explanation', () => {
  it('intersects client scope and required capabilities without running inference or consuming strategy state', async () => {
    const stream = vi.fn(), begin = vi.fn()
    const targets = ['one', 'two'].map((providerId) => ({ id: providerId, providerId, modelId: 'model', enabled: true }))
    const runtime = { modelClient: { stream }, modelConnections: {
      snapshot: async () => ({ revision: 4, providers: targets.map((target) => ({ id: target.providerId, kind: 'http', authType: 'api-key',
        configured: true, credentialStatus: 'ready', models: ['model'] })), routePools: [{ id: 'coding', modelId: 'coding', enabled: true, strategy: 'round-robin', targets }] }),
      gatewayClientPolicy: async () => ({ revision: 4, policy: GatewayClientPolicySchema.parse({ allowedRouteIds: ['coding'], allowedConnectionIds: ['one'] }) })
    }, modelGateway: { health: { available: () => true, begin }, modelCapabilities: (_model: string, provider: string) => ({
      id: 'model', inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'],
      supportsToolCalling: provider === 'one', contextWindowTokens: provider === 'one' ? 100 : 200
    }) } } as unknown as ServerRuntime
    const unrestricted = await previewProviderRoute(runtime, { routeId: 'coding' })
    expect(unrestricted.guarantees).toMatchObject({ tools: false, vision: false, contextWindowTokens: 100 })
    const scoped = await previewProviderRoute(runtime, { routeId: 'coding', clientId: 'client', tools: true })
    expect(scoped.targets.map((target) => target.reason)).toEqual(['eligible', 'client_scope'])
    expect(scoped).toMatchObject({ dispatches: 0, maxAttempts: 4, revision: 4 })
    expect(stream).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled()
  })
})
