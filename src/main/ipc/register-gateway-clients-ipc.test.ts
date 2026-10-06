import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handle: vi.fn(), writeText: vi.fn(), trusted: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle }, clipboard: { writeText: mocks.writeText } }))
vi.mock('./app-ipc-handler-utils', () => ({ assertTrustedWorkbenchSender: mocks.trusted }))
import { registerGatewayClientsIpc } from './register-gateway-clients-ipc'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'

function fixture(body: unknown, status = 200) {
  const request = vi.fn(async () => ({ ok: status < 400, status, body: JSON.stringify(body) }))
  const ready = vi.fn()
  registerGatewayClientsIpc({ getMainWindow: () => null, assertRendererRuntimeReady: ready, runtimeRequest: request })
  return { request, ready, invoke: mocks.handle.mock.calls[0][1] as (event: unknown, input: unknown) => Promise<Record<string, unknown>> }
}
beforeEach(() => { vi.clearAllMocks() })
describe('gateway client desktop bridge', () => {
  it('reads a key\'s limits, keeping only documented fields and the requested client id', async () => {
    const { invoke, request } = fixture({ client: { id: 'spoofed', name: 'Agent · Codex' }, limited: true, models: ['coding', 3], secret: 'x',
      rate: { requestsPerMinute: 60, burst: 20, maxConcurrent: 2, active: 1, extra: 9 },
      tokenBudget: { mode: 'weird', period: 'day', timeZone: 'UTC', tokens: 1000, used: 1000, left: 0, resetsAt: '2030-01-02T00:00:00.000Z' } })
    const result = await invoke({}, { action: 'limit', clientId: 'gc_1' })
    expect(request).toHaveBeenCalledWith('/v1/model-gateway/clients/gc_1/limit', 'GET', undefined)
    expect(result.limit).toEqual({ client: { id: 'gc_1', name: 'Agent · Codex' }, limited: true, models: ['coding'],
      rate: { requestsPerMinute: 60, burst: 20, maxConcurrent: 2, active: 1 },
      tokenBudget: { mode: 'hard', period: 'day', timeZone: 'UTC', tokens: 1000, used: 1000, left: 0, resetsAt: '2030-01-02T00:00:00.000Z' } })
    await expect(invoke({}, { action: 'limit', clientId: '../x' })).rejects.toThrow('Invalid gateway client ID')
  })
  it('copies the one-time key in Main and strips every extra secret field', async () => {
    const { invoke, request, ready } = fixture({ client: { clientId: 'gc_123', name: 'Codex', createdAt: '2026-10-04', key: 'nested-secret' }, key: 'kun_local_secret', unrelated: 'other-secret' })
    const result = await invoke({}, { action: 'create', name: ' Codex ' })
    expect(mocks.trusted).toHaveBeenCalledOnce(); expect(ready).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('/v1/model-gateway/clients', 'POST', '{"name":"Codex"}')
    expect(mocks.writeText).toHaveBeenCalledWith('kun_local_secret')
    expect(result).toEqual({ ok: true, status: 200, client: { clientId: 'gc_123', name: 'Codex', createdAt: '2026-10-04' }, copied: true })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('returns recoverable client metadata when copy fails, without retrying creation', async () => {
    mocks.writeText.mockImplementationOnce(() => { throw new Error('clipboard unavailable') })
    const { invoke, request } = fixture({ client: { clientId: 'gc_123', name: 'Codex', createdAt: 'now' }, key: 'secret' })
    const result = await invoke({}, { action: 'create', name: 'Codex' })
    expect(result.copied).toBe(false); expect(result.client).toEqual({ clientId: 'gc_123', name: 'Codex', createdAt: 'now' })
    expect(request).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('rejects malformed actions and path injection before dispatch', async () => {
    const { invoke, request } = fixture({})
    for (const input of [{ action: 'create', name: '\n' }, { action: 'create', name: 'x'.repeat(81) }, { action: 'revoke', clientId: '../credential' }, { action: 'reveal' }]) {
      await expect(invoke({}, input)).rejects.toThrow()
    }
    expect(request).not.toHaveBeenCalled()
  })
  it('strips secrets from list metadata and never forwards raw error bodies', async () => {
    const { invoke } = fixture({ clients: [{ clientId: 'gc_1', name: 'Pi', createdAt: 'now', key: 'secret' }] })
    expect(JSON.stringify(await invoke({}, { action: 'list' }))).not.toContain('secret')
    mocks.handle.mockClear()
    const error = fixture({ error: 'secret payload' }, 500)
    expect(await error.invoke({}, { action: 'list' })).toEqual({ ok: false, status: 500, error: 'Gateway client action failed (HTTP 500)' })
  })
  it('projects read-only per-client usage without prompts, secrets or unverified prices', async () => {
    const { invoke, request } = fixture({ usage: { turns: 2, totalTokens: 30, costUsd: 9 }, requests: [
      { timestamp: '2026-10-04', usage: { requestedModelId: 'coding', actualProviderId: 'deepseek', actualModelId: 'deepseek-chat',
        promptTokens: 20, completionTokens: 10, cacheHitTokens: 5, prompt: 'secret prompt', gateway: {
          sessionId: 'gs_hash', status: 'completed', latencyMs: 10, retryCount: 1, failoverCount: 0, tokenUsage: 'upstream', key: 'secret' } } }
    ] })
    const result = await invoke({}, { action: 'usage', clientId: 'gc_123' })
    expect(request).toHaveBeenCalledWith('/v1/model-gateway/clients/gc_123/usage', 'GET', undefined)
    expect(result.usage).toMatchObject({ clientId: 'gc_123', totalRequests: 2, totalTokens: 30,
      requests: [{ actualProviderId: 'deepseek', actualModelId: 'deepseek-chat', sessionId: 'gs_hash', retryCount: 1 }] })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('costUsd')
  })
  it('keeps client-secret endpoints outside the renderer generic request allowlist', () => {
    for (const method of ['GET', 'POST', 'DELETE']) expect(runtimeRequestPayloadSchema.safeParse({ path: '/v1/model-gateway/clients', method }).success).toBe(false)
  })
})
