import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWiringService, createWiringContext } from '../../../kun/src/agent-wiring/service.js'
import { parseAgentWiringAction } from './agent-wiring-actions'
import { AgentWiringBridge } from './agent-wiring-bridge'

let home: string
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'kun-bridge-')) })
afterEach(() => rmSync(home, { recursive: true, force: true }))

function runtime() {
  const calls: { path: string; method?: string; body?: string }[] = []
  const request = vi.fn(async (path: string, method?: string, body?: string) => {
    calls.push({ path, method, body })
    const ok = (value: unknown) => ({ ok: true, status: 200, body: JSON.stringify(value) })
    if (path === '/api/hello') return ok({ name: 'kun', gateway: { enabled: true, anthropic: 'http://127.0.0.1:18899' } })
    if (path === '/v1/model-gateway/catalog') return ok({ data: [
      { id: 'coding', display_name: 'Daily coding', context_window: 200000, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], modalities: { input: ['text', 'image'] } },
      { id: 'alpha/a1' }] })
    if (path === '/v1/model-gateway/clients' && method === 'POST') return ok({ client: { clientId: 'gc_9', name: 'Agent · Codex', createdAt: 'x' }, key: 'kun_local_abc' })
    if (path.endsWith('/allow')) return ok({ allowed: true })
    if (method === 'DELETE') return ok({ revoked: true })
    return { ok: false, status: 404, body: '{}' }
  })
  return { request, calls }
}

describe('agent wiring bridge', () => {
  it('issues an attributed per-agent key, widens it on switch and revokes it on disconnect', async () => {
    const { request, calls } = runtime()
    const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, stateFile: join(home, 'state.json'), which: () => undefined }))
    const bridge = new AgentWiringBridge(request, service)
    const connected = await bridge.handle({ action: 'connect', agentId: 'codex', model: 'coding', effort: 'high' })
    expect(connected).toMatchObject({ ok: true, notice: 'restart', gatewayEnabled: true })
    const config = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    expect(config).toContain('experimental_bearer_token = "kun-codex.kun_local_abc"')
    expect(config).toContain('model_context_window = 200000')
    await bridge.handle({ action: 'connect', agentId: 'codex', model: 'alpha/a1' })
    expect(calls.filter((call) => call.path === '/v1/model-gateway/clients' && call.method === 'POST')).toHaveLength(1)
    expect(calls.find((call) => call.path === '/v1/model-gateway/clients/gc_9/allow')?.body).toBe('{"modelIds":["alpha/a1"]}')
    const disconnected = await bridge.handle({ action: 'disconnect', agentId: 'codex' })
    expect(disconnected.ok).toBe(true)
    expect(calls.some((call) => call.path === '/v1/model-gateway/clients/gc_9' && call.method === 'DELETE')).toBe(true)
  })
  it('refuses models the gateway does not serve', async () => {
    const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, stateFile: join(home, 'state.json'), which: () => undefined }))
    const result = await new AgentWiringBridge(runtime().request, service).handle({ action: 'connect', agentId: 'pi', model: 'ghost' })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('ghost') })
  })
  it('validates renderer actions', () => {
    expect(parseAgentWiringAction({ action: 'connect', agentId: 'codex', model: 'coding', effort: 'high' })).toEqual({ action: 'connect', agentId: 'codex', model: 'coding', effort: 'high' })
    expect(() => parseAgentWiringAction({ action: 'connect', agentId: '../x', model: 'm' })).toThrow()
    expect(() => parseAgentWiringAction({ action: 'connect', agentId: 'codex', model: 'm\n' })).toThrow()
    expect(() => parseAgentWiringAction({ action: 'rm -rf' })).toThrow()
  })
})
