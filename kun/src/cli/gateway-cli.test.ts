import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGatewayCliCommand, type GatewayCliIo } from './gateway-cli.js'

let home: string
const previous = { HOME: process.env.HOME, state: process.env.KUN_AGENT_WIRING_STATE }
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kun-gateway-cli-'))
  process.env.HOME = home
  process.env.KUN_AGENT_WIRING_STATE = join(home, 'state.json')
})
afterEach(() => {
  process.env.HOME = previous.HOME
  if (previous.state === undefined) delete process.env.KUN_AGENT_WIRING_STATE
  else process.env.KUN_AGENT_WIRING_STATE = previous.state
  rmSync(home, { recursive: true, force: true })
})

function io(routes: Record<string, unknown>, extra: Partial<GatewayCliIo> = {}) {
  let out = ''
  let err = ''
  const calls: string[] = []
  const value: GatewayCliIo = {
    stdout: { write: (text: string) => { out += text } }, stderr: { write: (text: string) => { err += text } }, env: {},
    runtimeRequest: async (path, method = 'GET') => {
      calls.push(`${method} ${path}`)
      const key = `${method} ${path.split('?')[0]}`
      return key in routes ? { ok: true, status: 200, body: JSON.stringify(routes[key]) } : { ok: false, status: 404, body: '{"message":"missing"}' }
    },
    ...extra
  }
  return { value, out: () => out, err: () => err, calls }
}

describe('kun gateway', () => {
  it('prints status and a models table', async () => {
    const harness = io({ 'GET /api/hello': { name: 'kun', version: '1.2.3', gateway: { enabled: true, v1: 'http://127.0.0.1:18899/v1', anthropic: 'http://127.0.0.1:18899' } },
      'GET /v1/model-gateway/catalog': { data: [{ id: 'coding', display_name: 'Daily coding', context_window: 200000, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] } })
    expect(await runGatewayCliCommand('gateway', ['status'], harness.value)).toBe(0)
    expect(harness.out()).toContain('OpenAI base:    http://127.0.0.1:18899/v1')
    expect(await runGatewayCliCommand('gateway', ['models'], harness.value)).toBe(0)
    expect(harness.out()).toMatch(/coding\s+200K\s+low\/high\s+Daily coding/)
  })
  it('creates a key and prints it once with a warning', async () => {
    const harness = io({ 'POST /v1/model-gateway/clients': { client: { clientId: 'gc_1' }, key: 'kun_local_x' } })
    expect(await runGatewayCliCommand('gateway', ['keys', 'create', 'Laptop', '--model', 'coding'], harness.value)).toBe(0)
    expect(harness.out()).toBe('kun_local_x\n')
    expect(harness.err()).toContain('shown once')
  })
  it('prints a key\'s limits and the recent route list', async () => {
    const harness = io({
      'GET /v1/model-gateway/clients/gc_1/limit': { client: { id: 'gc_1', name: 'Agent · Codex' }, limited: true, models: ['coding'],
        rate: { requestsPerMinute: 60, burst: 20, maxConcurrent: 2, active: 1 },
        tokenBudget: { mode: 'hard', period: 'day', tokens: 1000, used: 1000, left: 0, resetsAt: '2030-01-02T00:00:00.000Z' } },
      'GET /v1/model-gateway/route-traces': { seq: 3, traces: [{ startedAt: '2030-01-01T10:11:12.000Z', agent: 'codex', asked: 'coding',
        served: 'beta/b1', decision: 'rule', rule: 'tests', tries: [{}, {}], status: 'completed' }] }
    })
    expect(await runGatewayCliCommand('gateway', ['keys', 'limit', 'gc_1'], harness.value)).toBe(0)
    expect(harness.out()).toContain('LIMITED  Agent · Codex')
    expect(harness.out()).toContain('tokens: 1000 / 1000 this day (hard), resets 2030-01-02T00:00:00.000Z')
    expect(harness.out()).toContain('1/2 in flight')
    expect(await runGatewayCliCommand('gateway', ['routes'], harness.value)).toBe(0)
    expect(harness.out()).toMatch(/10:11:12\s+codex\s+coding\s+beta\/b1\s+rule:tests\s+2\s+completed/)
  })
  it('reports a missing runtime clearly', async () => {
    const harness = io({}, { runtimeRequest: undefined, env: { KUN_DATA_DIR: join(home, 'none'), KUN_RUNTIME_DISCOVERY_DIR: join(home, 'none') } })
    expect(await runGatewayCliCommand('gateway', ['status'], harness.value)).toBe(1)
    expect(harness.err()).toContain('No running Kun runtime')
  })
})

describe('kun agents and quota', () => {
  const runtime = {
    'GET /api/hello': { gateway: { enabled: true, anthropic: 'http://127.0.0.1:18899' } },
    'GET /v1/model-gateway/catalog': { data: [{ id: 'coding' }] },
    'POST /v1/model-gateway/clients': { client: { clientId: 'gc_9' }, key: 'kun_local_k' },
    'DELETE /v1/model-gateway/clients/gc_9': { revoked: true }
  }
  it('connects and disconnects an agent through the shared bridge', async () => {
    const harness = io(runtime)
    expect(await runGatewayCliCommand('agents', ['connect', 'codex', 'coding'], harness.value)).toBe(0)
    expect(harness.out()).toContain('codex now uses coding through Kun')
    expect(await runGatewayCliCommand('agents', ['disconnect', 'codex'], harness.value)).toBe(0)
    expect(harness.calls).toContain('DELETE /v1/model-gateway/clients/gc_9')
    expect(await runGatewayCliCommand('agents', ['connect', 'codex', 'ghost'], harness.value)).toBe(1)
  })
  it('prints a masked diff for --dry-run and writes nothing', async () => {
    const harness = io(runtime)
    expect(await runGatewayCliCommand('agents', ['connect', 'codex', 'coding', '--dry-run'], harness.value)).toBe(0)
    expect(harness.out()).toContain('(new file)')
    expect(harness.out()).toContain('+model = "coding"')
    expect(harness.out()).toContain('kun-codex.********')
    expect(harness.out()).toContain('Dry run: nothing was written')
    expect(harness.calls).not.toContain('POST /v1/model-gateway/clients')
  })
  it('waits until an exhausted window renews', async () => {
    let now = Date.parse('2026-10-06T10:00:00Z')
    let readings = 0
    const harness = io({}, {
      now: () => now,
      sleep: async (ms) => { now += ms },
      runtimeRequest: async () => {
        readings += 1
        const exhausted = readings < 2
        return { ok: true, status: 200, body: JSON.stringify({ entries: [{ providerId: 'codex', providerName: 'ChatGPT', status: 'available',
          metrics: [{ label: 'Weekly', unit: 'percent', usedPercent: exhausted ? 100 : 5, resetsAt: '2026-10-06T10:20:00Z' }] }] }) }
      }
    })
    expect(await runGatewayCliCommand('quota', ['wait', 'codex'], harness.value)).toBe(0)
    expect(harness.out()).toContain('ChatGPT has allowance again')
    expect(harness.err()).toContain('Waiting')
  })
})
