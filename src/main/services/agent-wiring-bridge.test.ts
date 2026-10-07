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
    if (path.endsWith('/rotate')) return ok({ client: { clientId: 'gc_9' }, key: 'kun_local_rotated' })
    if (method === 'DELETE') return ok({ revoked: true })
    return { ok: false, status: 404, body: '{}' }
  })
  return { request, calls }
}

describe('agent wiring bridge', () => {
  it('hands Zed its key once through the delivery hook, keeps it across switches and rotates it on request', async () => {
    const { request, calls } = runtime()
    const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, platform: 'darwin', stateFile: join(home, 'state.json'), which: () => undefined }))
    const delivered: string[] = []
    const bridge = new AgentWiringBridge(request, service, { deliverKey: (key) => delivered.push(key) })
    const connected = await bridge.handle({ action: 'connect', agentId: 'zed', model: 'coding' })
    expect(connected).toMatchObject({ ok: true, notice: 'key-copied' })
    expect(delivered).toEqual(['kun-zed.kun_local_abc'])
    // The result the renderer receives never carries the key.
    expect(JSON.stringify(connected)).not.toContain('kun_local_abc')
    expect(readFileSync(join(home, '.config', 'zed', 'settings.json'), 'utf8')).not.toContain('kun_local_abc')
    const switched = await bridge.handle({ action: 'connect', agentId: 'zed', model: 'alpha/a1' })
    expect(switched).toMatchObject({ ok: true })
    expect(switched.ok && switched.notice).toBeFalsy()
    expect(delivered).toHaveLength(1)
    expect(calls.filter((call) => call.path === '/v1/model-gateway/clients' && call.method === 'POST')).toHaveLength(1)
    const copied = await bridge.handle({ action: 'copy-key', agentId: 'zed' })
    expect(copied).toMatchObject({ ok: true, notice: 'key-copied' })
    expect(delivered.at(-1)).toBe('kun-zed.kun_local_rotated')
    expect(JSON.stringify(copied)).not.toContain('kun_local_rotated')
    expect(parseAgentWiringAction({ action: 'copy-key', agentId: 'zed' })).toEqual({ action: 'copy-key', agentId: 'zed' })
  })
  it('refuses to connect Zed where no key hand-over exists', async () => {
    const { request } = runtime()
    const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, platform: 'darwin', stateFile: join(home, 'state.json'), which: () => undefined }))
    const result = await new AgentWiringBridge(request, service).handle({ action: 'connect', agentId: 'zed', model: 'coding' })
    expect(result).toMatchObject({ ok: false })
  })
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
  it('previews a connection as a masked diff without creating a client or touching disk', async () => {
    const { request, calls } = runtime()
    const service = new AgentWiringService(createWiringContext({ home, env: { PATH: '' }, stateFile: join(home, 'state.json'), which: () => undefined }))
    const bridge = new AgentWiringBridge(request, service)
    const result = await bridge.handle({ action: 'preview', agentId: 'codex', model: 'coding', effort: 'high' })
    if (!result.ok || !result.preview) throw new Error('expected a preview')
    expect(result.preview).toMatchObject({ agentId: 'codex', restartRequired: true })
    const [file] = result.preview.files
    expect(file).toMatchObject({ file: join(home, '.codex', 'config.toml'), created: true })
    expect(file!.diff).toContain('+model = "coding"')
    expect(file!.diff).toContain('kun-codex.********')
    expect(calls.some((call) => call.path === '/v1/model-gateway/clients' && call.method === 'POST')).toBe(false)
    expect(() => readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toThrow()
    // Once connected, the preview masks the real key and shows only what would change.
    await bridge.handle({ action: 'connect', agentId: 'codex', model: 'coding' })
    const again = await bridge.handle({ action: 'preview', agentId: 'codex', model: 'alpha/a1' })
    if (!again.ok || !again.preview) throw new Error('expected a preview')
    const diff = again.preview.files[0]!.diff
    expect(diff).not.toContain('kun_local_abc')
    expect(diff).toContain('-model = "coding"')
    expect(diff).toContain('+model = "alpha/a1"')
    expect(parseAgentWiringAction({ action: 'preview', agentId: 'codex', model: 'coding' })).toEqual({ action: 'preview', agentId: 'codex', model: 'coding' })
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
