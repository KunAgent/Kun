import { describe, expect, it } from 'vitest'
import { widenClientPolicy } from './gateway-agent-admin.js'
import { GatewayClientPolicySchema, legacyGatewayClientPolicy } from '../../contracts/gateway-client-policy.js'

describe('agent client policy widening', () => {
  it('unions routes, models and connections without dropping existing grants', () => {
    const base = GatewayClientPolicySchema.parse({ allowedRouteIds: ['pool'], allowedConnectionIds: ['alpha'], maxConcurrent: 4 })
    const widened = widenClientPolicy(base, { modelId: 'beta/b1', connectionIds: ['beta', 'alpha'] })
    expect(widened).toMatchObject({ allowedRouteIds: ['pool'], allowedModelIds: ['beta/b1'], allowedConnectionIds: ['alpha', 'beta'], maxConcurrent: 4 })
    expect(widenClientPolicy(widened, { routeId: 'pool', connectionIds: [] }).allowedRouteIds).toEqual(['pool'])
  })
  it('leaves an unrestricted legacy policy alone', () => {
    expect(widenClientPolicy(legacyGatewayClientPolicy(), { modelId: 'x', connectionIds: ['y'] }).mode).toBe('legacy-unrestricted')
  })
})
