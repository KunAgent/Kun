import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAesEncryptor } from '../../security/secret-store.js'
import { GatewayCredentialService } from '../../services/gateway-credential-service.js'
import { Router } from '../router.js'
import { registerCoreRoutes } from './register-core-routes.js'
import type { ServerRuntime } from './server-runtime.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-gateway-clients-route-'))
  directories.push(dataDir)
  const credentials = new GatewayCredentialService(dataDir, createAesEncryptor(randomBytes(32)))
  await credentials.initialize()
  const router = new Router()
  registerCoreRoutes(router, { runtimeToken: 'strict-admin-token', insecure: true, modelGateway: { credentials } } as unknown as ServerRuntime)
  const call = async (method: string, path: string, key?: string, body?: unknown, query = '') => {
    const request = new Request(`http://127.0.0.1${path}${query}`, {
      method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const route = router.match(method, path)!
    const response = await route.handler(request, { params: route.params })
    if (response instanceof Response) throw new Error('Expected JSON route response')
    return { ...response, value: JSON.parse(response.body) }
  }
  return { credentials, call }
}

describe('gateway client management boundary', () => {
  it('rejects gateway, query-string, and absent tokens even in insecure runtime mode', async () => {
    const { credentials, call } = await fixture()
    const publicKey = (await credentials.createClient('Editor')).key
    for (const [method, path] of [['GET', '/v1/model-gateway/clients'], ['POST', '/v1/model-gateway/clients'], ['DELETE', '/v1/model-gateway/clients/gc_unknown'], ['GET', '/v1/model-gateway/clients/legacy/usage']]) {
      for (const key of [undefined, publicKey, 'kgw_untrusted']) {
        const response = await call(method, path, key)
        expect(response.status).toBe(401)
        expect(response.headers['cache-control']).toBe('no-store')
      }
      expect((await call(method, path, undefined, undefined, '?token=strict-admin-token')).status).toBe(401)
    }
  })

  it('creates once, lists only metadata, and revokes a selected client immediately', async () => {
    const { credentials, call } = await fixture()
    const result = await call('POST', '/v1/model-gateway/clients', 'strict-admin-token', { name: 'Editor' })
    expect(result.status).toBe(201)
    expect(result.headers['cache-control']).toBe('no-store')
    const { client, key } = result.value
    expect(credentials.verify(key)).toBe(true)
    const listed = await call('GET', '/v1/model-gateway/clients', 'strict-admin-token')
    expect(listed.value).toEqual({ clients: [client] })
    expect(listed.body).not.toContain(key)
    const revoked = await call('DELETE', `/v1/model-gateway/clients/${client.clientId}`, 'strict-admin-token')
    expect(revoked.value).toEqual({ revoked: true })
    expect(credentials.verify(key)).toBe(false)
    expect((await call('DELETE', `/v1/model-gateway/clients/${client.clientId}`, 'strict-admin-token')).value).toEqual({ revoked: false })
  })

  it('rejects extra fields, malformed names and oversized control-plane bodies', async () => {
    const { credentials, call } = await fixture()
    for (const body of [{ name: 'Valid', threadId: 'victim' }, { name: '' }, { name: 'a\nb' }, { name: 1 }]) {
      expect((await call('POST', '/v1/model-gateway/clients', 'strict-admin-token', body)).status).toBe(400)
    }
    expect((await call('POST', '/v1/model-gateway/clients', 'strict-admin-token', { name: 'x'.repeat(2_000) })).status).toBe(413)
    expect(credentials.listClients()).toEqual([])
  })
})
