import { mkdtemp, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Router } from './router.js'
import { startNodeHttpServer } from './node-http-server.js'
import { gatewayModels } from './routes/openai-model-gateway.js'
import { registerProviderConfigurationRoutes } from './routes/provider-configuration.js'
import { GatewayCredentialService } from '../services/gateway-credential-service.js'
import { createAesEncryptor } from '../security/secret-store.js'
import { localModelGatewayApplyIssue } from './runtime-factory-config.js'
import type { ServerRuntime } from './routes/server-runtime.js'

describe('local provider gateway release boundary', () => {
  it('serves loopback data while withholding browser CORS and rejecting gateway credentials at administration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-gateway-release-boundary-'))
    const credentials = new GatewayCredentialService(directory, createAesEncryptor(randomBytes(32)))
    await credentials.initialize()
    const { key } = await credentials.createClient('fixture-scoped-client')
    let administrativeMutations = 0
    const runtime = {
      runtimeToken: 'fixture-administration-only', insecure: true,
      modelGateway: { credentials, enabled: () => true, exposeProviderModels: () => false,
        pools: () => [], configuredPools: () => [] },
      modelConnections: { snapshot: async () => ({ providers: [], failover: [], revision: 0 }),
        configurationSnapshot: async () => ({ revision: 0, connections: [], configuration: {} }),
        previewConfiguration: async () => { administrativeMutations++; return {} },
        commitConfiguration: async () => { administrativeMutations++; return {} } }
    } as unknown as ServerRuntime
    const router = new Router()
    router.add('GET', '/v1/models', (request) => gatewayModels(runtime, request))
    registerProviderConfigurationRoutes(router, runtime)
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const endpoint = `http://127.0.0.1:${server.port}`
    try {
      const origin = 'https://untrusted-browser.example'
      const preflight = await fetch(endpoint + '/v1/models', { method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } })
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
      expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
      const unauthorized = await fetch(endpoint + '/v1/models')
      expect(unauthorized.status).toBe(401)
      const models = await fetch(endpoint + '/v1/models', { headers: { authorization: `Bearer ${key}`, Origin: origin } })
      expect(models.status).toBe(200)
      expect(models.headers.get('access-control-allow-origin')).toBeNull()
      for (const path of ['transactions/preview', 'transactions/commit', 'import/preview', 'import/commit',
        'export', 'routes/preview', 'backup', 'backup/preview', 'recovery/preview', 'recovery/export']) {
        const denied = await fetch(`${endpoint}/v1/provider-config/${path}`, { method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' })
        expect(denied.status, path).toBe(401)
      }
      expect((await fetch(endpoint + '/v1/provider-config', { headers: { authorization: `Bearer ${key}` } })).status).toBe(401)
      expect(administrativeMutations).toBe(0)
      const control = await fetch(endpoint + '/v1/provider-config', { headers: { authorization: 'Bearer fixture-administration-only' } })
      expect(control.status).toBe(200)
      const adminAsData = await fetch(endpoint + '/v1/models', { headers: { authorization: 'Bearer fixture-administration-only' } })
      expect(adminAsData.status).toBe(401)
      expect(localModelGatewayApplyIssue({ host: '0.0.0.0', localModelGateway: { enabled: true, exposeProviderModels: false } }, credentials))
        .toMatchObject({ code: 'gateway_non_loopback_host' })
      expect(localModelGatewayApplyIssue({ host: '127.0.0.1', localModelGateway: { enabled: true, exposeProviderModels: false } }, credentials)).toBeNull()
    } finally {
      await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
