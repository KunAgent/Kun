import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDispatchIntentSchema, type AgentDispatchIntentFile } from '../../contracts/agent-dispatch-intents.js'
import { AgentDispatchService } from '../../delegation/agent-dispatch-service.js'
import type { AgentDispatchIntentStore } from '../../delegation/agent-dispatch-intent-store.js'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerAgentDispatchIntentRoutes } from './agent-dispatch-intents.js'

const services: AgentDispatchService[] = []
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.stop())) })

describe('User-bound Agent dispatch controls', () => {
  it('redacts the persisted execution payload and original user excerpt', async () => {
    const f = fixture()
    const result = await f.call('GET')
    expect(result.status).toBe(200)
    const publicIntent = (JSON.parse(result.body) as { intent: Record<string, unknown> }).intent
    expect(publicIntent).not.toHaveProperty('payload')
    expect(publicIntent).not.toHaveProperty('requestLedger')
    expect(publicIntent.source).not.toHaveProperty('userIntent')
  })

  it('rejects model gateway tokens even with insecure read access', async () => {
    const f = fixture(true)
    const result = await f.call('POST', { action: 'start_now', expectedRevision: 1, requestId: 'start' }, 'kgw_fake')
    expect(result.status).toBe(401)
    expect(f.start).not.toHaveBeenCalled()
  })

  it('rejects attempts to inject execution authority or opaque payloads', async () => {
    const f = fixture()
    for (const extra of [{ payload: { bypass: true } }, { policySnapshot: { approvalPolicy: 'auto' } },
      { recommendation: { permissionMode: 'full-access' } }]) {
      expect((await f.call('POST', { action: 'update', expectedRevision: 1, requestId: 'forged', ...extra })).status).toBe(400)
    }
    expect(f.start).not.toHaveBeenCalled()
  })

  it('detects stale card revisions and replays a cancellation request', async () => {
    const f = fixture()
    expect((await f.call('POST', { action: 'cancel', expectedRevision: 9, requestId: 'stale' })).status).toBe(409)
    const request = { action: 'cancel', expectedRevision: 1, requestId: 'cancel' }
    const first = await f.call('POST', request)
    const replay = await f.call('POST', request)
    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    expect((JSON.parse(replay.body) as { intent: { state: string } }).intent.state).toBe('cancelled')
    expect(f.start).not.toHaveBeenCalled()
  })
})

function fixture(insecure = false) {
  let file: AgentDispatchIntentFile = { version: 1, intents: [AgentDispatchIntentSchema.parse({
    intentId: 'dispatch1', kind: 'worker', state: 'pending_confirmation', revision: 1,
    source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app', userIntent: 'Private prompt' },
    policySnapshot: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' },
    recommendation: { title: 'Task', task: 'Concrete task', agentId: 'codex', permissionMode: 'ask-for-approval', agentSelection: 'auto' },
    payload: { security: { private: 'value' } }, startRequestId: 'dispatch1:start',
    createdAt: '2026-10-07T02:00:00.000Z', updatedAt: '2026-10-07T02:00:00.000Z'
  })] }
  const store: AgentDispatchIntentStore = {
    list: async () => structuredClone(file.intents),
    get: async (id) => structuredClone(file.intents.find((entry) => entry.intentId === id) ?? null),
    transaction: async (mutate) => { const copy = structuredClone(file); const result = await mutate(copy); file = copy; return structuredClone(result) }
  }
  const service = new AgentDispatchService({ store, applicationSessionId: 'app' })
  services.push(service)
  const start = vi.fn(async () => ({ threadId: 'child' }))
  service.registerHandler('worker', { validate: async () => undefined, start })
  const router = new Router()
  registerAgentDispatchIntentRoutes(router, { agentDispatchService: service, runtimeToken: 'user-token', insecure } as ServerRuntime)
  return { start, async call(method: 'GET' | 'POST', body?: unknown, token = 'user-token') {
    const path = `/v1/agent-dispatch-intents/dispatch1${method === 'POST' ? '/actions' : ''}`
    const route = router.match(method, path)!
    return await route.handler(new Request(`http://localhost${path}`, { method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }), { params: route.params }) as JsonResponse
  } }
}
