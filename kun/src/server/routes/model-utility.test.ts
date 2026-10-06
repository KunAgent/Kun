import { describe, expect, it } from 'vitest'
import { Router } from '../router.js'
import { registerModelUtilityRoutes } from './model-utility.js'
import type { ServerRuntime } from './server-runtime.js'
import type { ModelRequest } from '../../ports/model-client.js'
import type { JsonResponse } from '../response.js'

describe('runtime text utilities', () => {
  it('requires the runtime token and sends provider IDs to the shared model client without accepting credentials or endpoints', async () => {
    const seen: ModelRequest[] = []
    const runtime = { runtimeToken: 'runtime-token', insecure: true,
      modelConnections: { snapshot: async () => ({ providers: [{ id: 'one', configured: true }] }) },
      modelClient: { async *stream(input: ModelRequest) { seen.push(input); yield { kind: 'assistant_text_delta', text: 'result' }; yield { kind: 'completed', stopReason: 'stop' } } }
    } as unknown as ServerRuntime
    const router = new Router(); registerModelUtilityRoutes(router, runtime)
    const route = router.match('POST', '/v1/model-requests')!
    const call = (token: string, extra = {}) => route.handler(new Request('http://127.0.0.1/v1/model-requests', {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ purpose: 'prompt-optimization',
        providerId: 'one', model: 'model', messages: [{ role: 'user', content: 'text' }], ...extra }) }), { params: {} }) as Promise<JsonResponse>
    expect((await call('gateway-token')).status).toBe(401)
    expect((await call('runtime-token', { baseUrl: 'https://malicious.test', apiKey: 'key' })).status).toBe(400)
    expect(JSON.parse((await call('runtime-token')).body)).toEqual({ ok: true, text: 'result' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ providerId: 'one', model: 'model', tools: [] })
    expect((await call('runtime-token', { providerId: 'removed' })).status).toBe(409)
    expect(seen).toHaveLength(1)
  })
})
