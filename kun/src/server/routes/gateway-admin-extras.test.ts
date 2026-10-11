import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GatewayClientPolicySchema } from '../../contracts/gateway-client-policy.js'
import { Router } from '../router.js'
import { EXAMPLE_MIDDLEWARE_FILE, registerGatewayAdminExtras } from './gateway-admin-extras.js'
import { gatewayClientLimitStatus } from './gateway-limit.js'
import { GatewayMiddlewareHost } from './gateway-middleware.js'
import { gatewayRouteTraceStore } from './gateway-route-trace.js'
import type { ServerRuntime } from './server-runtime.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kun-admin-extras-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function runtime(windows: Record<string, unknown>[] = []) {
  const policy = GatewayClientPolicySchema.parse({ allowedRouteIds: ['route-1'], allowedModelIds: ['alpha/a1'],
    tokenBudget: { mode: 'hard', period: 'day', timeZone: 'UTC', tokens: 1_000 },
    costAlert: { usd: 2, period: 'day', timeZone: 'UTC', enforce: true } })
  const gateway = {
    enabled: () => true,
    pools: () => [{ id: 'route-1', modelId: 'coding' }],
    credentials: { listClients: () => [{ clientId: 'gc_1', name: 'Agent · Codex', createdAt: 'x' }] },
    budget: { summary: async () => ({ windows, pendingAttempts: [] }) },
    middleware: new GatewayMiddlewareHost(join(dir, 'gateway-middleware'), () => [])
  }
  return { policy, runtime: { runtimeToken: 't', modelGateway: gateway,
    modelConnections: { gatewayClientPolicy: async () => ({ policy, revision: 1 }) } } as unknown as ServerRuntime }
}

function router(rt: ServerRuntime): Router {
  const r = new Router()
  registerGatewayAdminExtras(r, rt, (request) => request.headers.get('authorization') === 'Bearer admin')
  return r
}
const admin = { authorization: 'Bearer admin' }
async function call(r: Router, method: string, path: string, headers: Record<string, string> = admin) {
  const request = new Request(`http://127.0.0.1${path}`, { method, headers })
  const route = r.match(method, new URL(request.url).pathname)!
  const response = await route.handler(request, { params: route.params })
  const raw = response as { status: number; body?: string }
  return { status: raw.status, body: JSON.parse(raw.body ?? (await (response as Response).text())) as Record<string, any> }
}

describe('client limits', () => {
  it('reports window usage, remaining allowance, reset time and models', async () => {
    const endsAt = Date.parse('2030-01-02T00:00:00Z')
    const { runtime: rt, policy } = runtime([{ active: true, measured: 700, reserved: 100, estimatedCostUsd: 0.5, endsAt }])
    const limit = await gatewayClientLimitStatus(rt, { id: 'gc_1', name: 'Agent · Codex' }, policy)
    expect(limit).toMatchObject({ limited: false, models: ['alpha/a1', 'coding'],
      tokenBudget: { used: 800, left: 200, tokens: 1_000, mode: 'hard', resetsAt: '2030-01-02T00:00:00.000Z' },
      cost: { used: 0.5, left: 1.5, enforce: true }, rate: { requestsPerMinute: 60, active: 0 } })
  })
  it('flags a hard token budget or an enforced cost limit that is used up', async () => {
    const { runtime: tokens, policy } = runtime([{ active: true, measured: 1_000, reserved: 0, estimatedCostUsd: 0, endsAt: Date.now() + 1000 }])
    expect((await gatewayClientLimitStatus(tokens, { id: 'gc_1' }, policy)).limited).toBe(true)
    const { runtime: cost } = runtime([{ active: true, measured: 0, reserved: 0, estimatedCostUsd: 2.01, endsAt: Date.now() + 1000 }])
    expect((await gatewayClientLimitStatus(cost, { id: 'gc_1' }, policy)).limited).toBe(true)
    const { runtime: fresh } = runtime([])
    const empty = await gatewayClientLimitStatus(fresh, { id: 'gc_1' }, policy)
    expect(empty).toMatchObject({ limited: false, tokenBudget: { used: 0, left: 1_000 } })
  })
  it('is served to the admin per client and refuses other callers', async () => {
    const r = router(runtime().runtime)
    expect((await call(r, 'GET', '/v1/model-gateway/clients/gc_1/limit')).body).toMatchObject({ client: { id: 'gc_1', name: 'Agent · Codex' } })
    expect((await call(r, 'GET', '/v1/model-gateway/clients/nope/limit')).status).toBe(404)
    expect((await call(r, 'GET', '/v1/model-gateway/clients/gc_1/limit', {})).status).toBe(401)
  })
})

describe('admin extras', () => {
  it('lists recent route traces', async () => {
    const { runtime: rt } = runtime()
    const r = router(rt)
    gatewayRouteTraceStore(rt.modelGateway!).begin(undefined, { requestId: 'q1', asked: 'coding', agent: 'pi' })
    const listed = await call(r, 'GET', '/v1/model-gateway/route-traces')
    expect(listed.body.traces).toEqual([expect.objectContaining({ requestId: 'q1', agent: 'pi' })])
    expect((await call(r, 'GET', `/v1/model-gateway/route-traces?after=${listed.body.seq}`)).body.traces).toEqual([])
    expect((await call(r, 'GET', '/v1/model-gateway/route-traces?wait=-1')).status).toBe(400)
  })
  it('reports the middleware folder and writes the example script once', async () => {
    const r = router(runtime().runtime)
    const before = await call(r, 'GET', '/v1/model-gateway/middleware')
    expect(before.body).toMatchObject({ middleware: [], directory: join(dir, 'gateway-middleware'), files: [] })
    const created = await call(r, 'POST', '/v1/model-gateway/middleware/example')
    expect(created).toMatchObject({ status: 201, body: { file: EXAMPLE_MIDDLEWARE_FILE } })
    expect(readFileSync(join(dir, 'gateway-middleware', EXAMPLE_MIDDLEWARE_FILE), 'utf8')).toContain('export function onModel')
    writeFileSync(join(dir, 'gateway-middleware', 'not a script.txt'), 'x')
    expect((await call(r, 'GET', '/v1/model-gateway/middleware')).body.files).toEqual([EXAMPLE_MIDDLEWARE_FILE])
    expect((await call(r, 'POST', '/v1/model-gateway/middleware/example')).status).toBe(409)
  })
})
