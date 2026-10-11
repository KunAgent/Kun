import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GatewayCredentialService } from '../../services/gateway-credential-service.js'
import { createAesEncryptor } from '../../security/secret-store.js'
import { GatewayClientPolicySchema } from '../../contracts/gateway-client-policy.js'
import { authorizeGateway, listGatewayModels, resolveGatewayModel } from './model-gateway-core.js'
import type { ServerRuntime } from './server-runtime.js'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-client-policy-')); folders.push(dir)
  const credentials = new GatewayCredentialService(dir, createAesEncryptor(randomBytes(32)))
  await credentials.initialize()
  const { client, key } = await credentials.createClient('Scoped client')
  let policy = GatewayClientPolicySchema.parse({ allowedRouteIds: ['coding'], allowedConnectionIds: ['one'] })
  let revision = 1
  const providers = ['one', 'two'].map((id) => ({ id, kind: 'http', authType: 'api-key',
    configured: true, credentialStatus: 'ready', models: ['model'] }))
  const pool = { id: 'coding', modelId: 'route/coding', enabled: true,
    targets: providers.map((provider) => ({ id: provider.id, providerId: provider.id, modelId: 'model', enabled: true })) }
  const runtime = {
    modelGateway: { credentials, pools: () => [pool], exposeProviderModels: () => true, enabled: () => true },
    modelConnections: { snapshot: async () => ({ providers, routePools: [pool], failover: [], revision }),
      gatewayClientPolicy: async () => ({ policy, revision }) }
  } as unknown as ServerRuntime
  return { runtime, credentials, client, key,
    setPolicy: (next: Partial<typeof policy>) => { policy = { ...policy, ...next }; revision++ },
    request: (path = '/v1/models') => new Request(`http://127.0.0.1${path}`, { headers: { authorization: `Bearer ${key}` } }) }
}

describe('public gateway client policies', () => {
  it('shows only permitted aliases and constrains actual fallback to the same approved connections', async () => {
    const f = await fixture()
    const auth = await authorizeGateway(f.runtime, f.request())
    if (!auth.ok || auth.auth.kind !== 'public') throw new Error('Expected public authorization')
    expect((await listGatewayModels(f.runtime, undefined, auth.auth.policy, auth.auth.policyRevision)).map((row) => row.id))
      .toEqual(['route/coding'])
    expect((await resolveGatewayModel(f.runtime, 'route/coding', undefined, auth.auth.policy, auth.auth.policyRevision))?.gatewayRouting.allowedTargets)
      .toEqual([{ providerId: 'one', modelId: 'model' }])
    expect(await resolveGatewayModel(f.runtime, 'two/model', undefined, auth.auth.policy)).toBeNull()
  })

  it('rejects expired policies, disallowed protocols and conflicting authentication headers', async () => {
    const f = await fixture()
    f.setPolicy({ allowedProtocols: ['responses'] })
    expect(await authorizeGateway(f.runtime, f.request('/v1/messages'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(await authorizeGateway(f.runtime, new Request('http://127.0.0.1/v1/models', {
      headers: { authorization: `Bearer ${f.key}`, 'x-api-key': 'different' }
    }))).toMatchObject({ ok: false, reason: 'unauthorized' })
    f.setPolicy({ expiresAt: '2000-01-01T00:00:00.000Z' })
    expect(await authorizeGateway(f.runtime, f.request())).toMatchObject({ ok: false, reason: 'unauthorized' })
  })

  it('invalidates admission when policy configuration changes during model resolution', async () => {
    const f = await fixture()
    const auth = await authorizeGateway(f.runtime, f.request())
    if (!auth.ok || auth.auth.kind !== 'public') throw new Error('Expected public authorization')
    f.setPolicy({ allowedConnectionIds: [] })
    await expect(resolveGatewayModel(f.runtime, 'route/coding', undefined, auth.auth.policy, auth.auth.policyRevision)).rejects.toThrow('configuration changed')
  })

  it('does not give newly issued keys unlimited model access and rotates them independently', async () => {
    const f = await fixture()
    expect(f.credentials.defaultClientPolicy(f.client.clientId)).toMatchObject({ mode: 'scoped', allowedRouteIds: [], allowedConnectionIds: [] })
    const other = await f.credentials.createClient('Other')
    const rotated = await f.credentials.rotateClient(f.client.clientId)
    expect(f.credentials.verify(f.key)).toBe(false)
    expect(f.credentials.verify(rotated.key)).toBe(true)
    expect(f.credentials.verify(other.key)).toBe(true)
  })
})
