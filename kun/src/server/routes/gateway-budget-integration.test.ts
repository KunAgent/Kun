import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompatModelClient } from '../../adapters/model/compat-model-client.js'
import { MultiProviderModelClient } from '../../adapters/model/multi-provider-model-client.js'
import { GatewayCredentialService } from '../../services/gateway-credential-service.js'
import { GatewayTokenBudget } from '../../services/gateway-token-budget.js'
import { GatewayClientPolicySchema } from '../../contracts/gateway-client-policy.js'
import { createAesEncryptor } from '../../security/secret-store.js'
import { gatewayChatCompletions } from './openai-model-gateway.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function setup(inputTokenUpperBound?: number, limits: { requestsPerMinute?: number; burst?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-gateway-budget-')); roots.push(dir)
  const credentials = new GatewayCredentialService(dir, createAesEncryptor(randomBytes(32)))
  await credentials.initialize()
  const { client, key } = await credentials.createClient('Editor')
  const budget = new GatewayTokenBudget(credentials.directory)
  const policy = GatewayClientPolicySchema.parse({ mode: 'scoped', allowedModelIds: ['one/model'],
    allowedConnectionIds: ['one'], maxOutputTokens: 10, ...limits,
    tokenBudget: { mode: 'hard', tokens: 100, period: 'day', timeZone: 'UTC' } })
  const upstream = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(String(init?.body)).max_tokens).toBe(2)
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })
  })
  const one = new CompatModelClient({ providerId: 'one', baseUrl: 'https://one.test/v1', apiKey: 'upstream-secret',
    endpointFormat: 'chat_completions', model: 'model', inputTokenUpperBound, fetchImpl: upstream })
  const direct = new MultiProviderModelClient({ default: one, providers: new Map([['one', one]]), gatewayClients: new Map([['one', one]]) })
  const runtime = { directModelClient: direct, modelClient: direct,
    modelGateway: { credentials, budget, enabled: () => true, exposeProviderModels: () => true, pools: () => [] },
    modelConnections: { gatewayClientPolicy: async () => ({ revision: 1, policy }), assertRevision: async () => undefined,
      snapshot: async () => ({ revision: 1, providers: [{ id: 'one', kind: 'http', authType: 'api-key',
        configured: true, credentialStatus: 'ready', models: ['model'] }], routePools: [], failover: [] }) }
  } as unknown as ServerRuntime
  const call = (stream = false) => gatewayChatCompletions(runtime, new Request('http://127.0.0.1/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'one/model',
      messages: [{ role: 'user', content: 'Hello' }], max_completion_tokens: 2, ...(stream ? { stream: true } : {}) }) })) as Promise<JsonResponse>
  return { call, budget, client, policy, upstream }
}

describe('gateway budget to physical upstream dispatch', () => {
  it('settles actual usage and blocks the next attempt before HTTP without enlarging a caller output limit', async () => {
    const f = await setup(64)
    expect((await f.call()).status).toBe(200)
    expect((await f.budget.summary(f.client.clientId)).windows[0]).toMatchObject({ measured: 4, reserved: 0 })
    f.policy.tokenBudget!.tokens = 60
    const denied = await f.call()
    expect(denied.status).toBe(429)
    expect(JSON.parse(denied.body).error.code).toBe('token_budget_exceeded')
    // The privacy filter rewrites refusal text; the reset time and limit hint must survive it.
    expect(JSON.parse(denied.body).error.message).toMatch(/It resets at .+ See GET \/v1\/kun\/limit/)
    expect(denied.headers['retry-after']).toBeDefined()
    expect(f.upstream).toHaveBeenCalledTimes(1)
  })
  it('rejects unbounded hard mode before contacting the provider', async () => {
    const f = await setup()
    expect((await f.call()).status).toBe(400)
    expect(f.upstream).not.toHaveBeenCalled()
    expect((await f.budget.summary(f.client.clientId)).windows).toEqual([])
  })
  it('refuses a streaming request over budget with a real 429 that says when the window resets', async () => {
    const f = await setup(64)
    expect((await f.call()).status).toBe(200)
    f.policy.tokenBudget!.tokens = 60
    const denied = await f.call(true)
    expect(denied.status).toBe(429)
    expect(denied.headers['content-type']).toContain('application/json')
    expect(JSON.parse(denied.body).error.code).toBe('token_budget_exceeded')
    const window = (await f.budget.summary(f.client.clientId)).windows[0]!
    expect(denied.headers['x-kun-limit-reset']).toBe(new Date(window.endsAt).toISOString())
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0)
    expect(JSON.parse(denied.body).error.message).toContain('It resets at')
    expect(f.upstream).toHaveBeenCalledTimes(1)
  })
  it('tells a rate-limited key how long to wait', async () => {
    const f = await setup(64, { requestsPerMinute: 1, burst: 1 })
    expect((await f.call()).status).toBe(200)
    const limited = await f.call()
    expect(limited.status).toBe(429)
    expect(JSON.parse(limited.body).error.code).toBe('rate_limit_exceeded')
    const waitMs = Number(limited.headers['retry-after-ms'])
    expect(waitMs).toBeGreaterThan(50_000)
    expect(waitMs).toBeLessThanOrEqual(60_000)
    expect(limited.headers['retry-after']).toBe(String(Math.ceil(waitMs / 1_000)))
    expect(JSON.parse(limited.body).error.message).toMatch(/retry in \d+s/)
  })
})
