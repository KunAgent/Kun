import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { ServerRuntime } from './server-runtime.js'
import { gatewayMessages } from './anthropic-messages-gateway.js'
import { gatewayChatCompletions, gatewayModels } from './openai-model-gateway.js'
import { gatewayHello, gatewayRouteTrace } from './gateway-discovery-routes.js'
import { gatewayClientLimit } from './gateway-limit.js'
import { gatewayCallerAgent, splitAttributedKey, userAgentProduct } from './gateway-caller-agent.js'
import { GatewayContinuationStore } from './gateway-continuations.js'
import { GatewayRouteTraceStore } from './gateway-route-trace.js'
import { metadataEvidence } from '../../contracts/model-metadata-evidence.js'
import { publishGatewayDiscovery, removeGatewayDiscovery } from '../gateway-discovery-file.js'

type Wire = Record<string, any>
const KEY = 'fixture-key'

class ScriptedModel implements ModelClient {
  provider = 'fixture'
  model = 'fixture'
  requests: ModelRequest[] = []
  constructor(private readonly scripts: ModelStreamChunk[][]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push({ ...request, history: structuredClone(request.history) })
    yield* this.scripts[Math.min(this.requests.length - 1, this.scripts.length - 1)]!
  }
}

const capability = (overrides: Wire = {}) => {
  const value: Wire = {
    id: 'x', inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true,
    messageParts: ['text'], contextWindowTokens: 200_000, maxOutputTokens: 32_000,
    reasoning: { supportedEfforts: ['off', 'low', 'high'], defaultEffort: 'high', requestProtocol: 'openai-chat-completions' },
    ...overrides
  }
  return { ...value, evidence: metadataEvidence(value, 'catalog') }
}

function runtime(modelClient: ModelClient, extra: Partial<Record<string, unknown>> = {}): ServerRuntime {
  const providers = [
    { id: 'alpha', name: 'Alpha', kind: 'http', authType: 'api-key', configured: true, credentialStatus: 'ready',
      endpointFormat: 'chat_completions', endpoints: { messages: 'https://alpha.example/anthropic' }, models: ['a1'] },
    { id: 'beta', name: 'Beta', kind: 'http', authType: 'api-key', configured: true, credentialStatus: 'ready',
      endpointFormat: 'chat_completions', models: ['b1'] }
  ]
  return {
    modelClient,
    modelConnections: { snapshot: async () => ({ revision: 1, providers }) },
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => true,
      credentials: { verify: (value: string | null) => value === KEY },
      pools: () => [{ id: 'pool', name: 'Daily coding', modelId: 'coding', enabled: true, targets: [
        { id: 't1', enabled: true, providerId: 'alpha', modelId: 'a1' },
        { id: 't2', enabled: true, providerId: 'beta', modelId: 'b1' }
      ] }],
      modelCapabilities: (modelId: string) => modelId === 'b1'
        ? capability({ inputModalities: ['text'], contextWindowTokens: 128_000,
          reasoning: { supportedEfforts: ['low', 'high', 'max'], defaultEffort: 'high', requestProtocol: 'openai-chat-completions' } })
        : capability(),
      ...extra
    }
  } as unknown as ServerRuntime
}

function post(path: string, body: Wire, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:18899${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

describe('caller attribution', () => {
  it('splits an attribution prefix from the real secret', () => {
    expect(splitAttributedKey('kun-claude-code.kun_local_abc')).toEqual({ secret: 'kun_local_abc', agent: 'claude-code' })
    expect(splitAttributedKey('kun_local_abc')).toEqual({ secret: 'kun_local_abc' })
    expect(splitAttributedKey('kun-Bad.kun_local_abc')).toEqual({ secret: 'kun-Bad.kun_local_abc' })
  })
  it('names the agent from the key prefix, x-kun-agent, then the User-Agent product', () => {
    const request = (headers: Record<string, string>) => new Request('http://x/v1/models', { headers })
    expect(gatewayCallerAgent(request({ authorization: 'Bearer kun-opencode.k', 'user-agent': 'claude-cli/2.1' }))).toBe('opencode')
    expect(gatewayCallerAgent(request({ 'x-kun-agent': 'Crush' }))).toBe('crush')
    expect(gatewayCallerAgent(request({ 'user-agent': 'claude-cli/2.1.220 (external, cli)' }))).toBe('claude-code')
    expect(userAgentProduct('codex_cli_rs/0.160.0 (Mac OS)')).toBe('codex')
    expect(userAgentProduct('../../etc/passwd')).toBeUndefined()
  })
  it('authenticates an attributed key by its stripped secret', async () => {
    const model = new ScriptedModel([[{ kind: 'assistant_text_delta', text: 'ok' }, { kind: 'completed', stopReason: 'stop' }]])
    const ok = await gatewayChatCompletions(runtime(model), post('/v1/chat/completions',
      { model: 'coding', messages: [{ role: 'user', content: 'hi' }] }, { authorization: `Bearer kun-pi.${KEY}` }))
    expect((ok as { status: number }).status).toBe(200)
    const bad = await gatewayChatCompletions(runtime(model), post('/v1/chat/completions',
      { model: 'coding', messages: [{ role: 'user', content: 'hi' }] }, { authorization: 'Bearer kun-pi.wrong' }))
    expect((bad as { status: number }).status).toBe(401)
  })
})

describe('/v1/models metadata', () => {
  it('publishes reasoning levels, windows, modalities and native endpoints', async () => {
    const response = await gatewayModels(runtime(new ScriptedModel([])), new Request('http://x/v1/models', { headers: { authorization: `Bearer ${KEY}` } }))
    const body = JSON.parse((response as { body: string }).body) as { data: Wire[] }
    const pool = body.data.find((entry) => entry.id === 'coding')!
    expect(pool).toMatchObject({ display_name: 'Daily coding', context_window: 128_000, max_output_tokens: 32_000,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], modalities: { input: ['text'], output: ['text'] } })
    expect(pool.native_endpoints).toBeUndefined()
    const unknownWindow = await gatewayModels(runtime(new ScriptedModel([]), { modelCapabilities: () => ({ ...capability(),
      evidence: { ...capability().evidence, contextWindowTokens: { source: 'catalog', status: 'unknown' } } }) }),
      new Request('http://x/v1/models', { headers: { authorization: `Bearer ${KEY}` } }))
    const guessed = (JSON.parse((unknownWindow as { body: string }).body) as { data: Wire[] }).data.find((entry) => entry.id === 'coding')!
    expect(guessed.context_window).toBeUndefined()
    const direct = body.data.find((entry) => entry.id === 'alpha/a1')!
    expect(direct).toMatchObject({ display_name: 'a1 · Alpha', reasoning: true, default_reasoning_level: 'high',
      native_endpoints: ['/v1/chat/completions', '/v1/messages'], modalities: { input: ['text', 'image'], output: ['text'] } })
  })
  it('serves one id per line with ?format=text', async () => {
    const response = await gatewayModels(runtime(new ScriptedModel([])), new Request('http://x/v1/models?format=text', { headers: { authorization: `Bearer ${KEY}` } }))
    expect((response as { headers: Record<string, string> }).headers['content-type']).toContain('text/plain')
    expect((response as { body: string }).body.split('\n')).toEqual(expect.arrayContaining(['coding', 'alpha/a1', 'beta/b1']))
  })
})

describe('provider continuations across stateless agent requests', () => {
  it('restores signed thinking blocks onto the replayed tool call by call id', async () => {
    const thinkingBlocks = [{ type: 'thinking' as const, thinking: 'plan', signature: 'real-provider-signature' }]
    const model = new ScriptedModel([
      [{ kind: 'tool_call_complete', callId: 'toolu_1', toolName: 'read', arguments: {}, providerMetadata: { anthropic: { thinkingBlocks } } },
        { kind: 'completed', stopReason: 'tool_calls' }],
      [{ kind: 'assistant_text_delta', text: 'done' }, { kind: 'completed', stopReason: 'stop' }]
    ])
    const rt = runtime(model)
    const tools = [{ name: 'read', input_schema: { type: 'object' } }]
    const first = await gatewayMessages(rt, post('/v1/messages', { model: 'coding', max_tokens: 100, tools, messages: [{ role: 'user', content: 'go' }] }))
    expect((first as { status: number }).status).toBe(200)
    await gatewayMessages(rt, post('/v1/messages', { model: 'coding', max_tokens: 100, tools, messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan', signature: 'kungw1.abc' }, { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }
    ] }))
    const replayed = model.requests[1]!.history.find((item) => item.kind === 'tool_call')
    expect(replayed).toMatchObject({ callId: 'toolu_1', providerMetadata: { anthropic: { thinkingBlocks } } })
  })
  it('scopes remembered state to the caller and expires it', () => {
    let now = 0
    const store = new GatewayContinuationStore(2, 1_000, () => now)
    store.remember('client:a', 'c1', { gemini: { thoughtSignature: 'sig' } })
    expect(store.recall('client:b', 'c1')).toBeUndefined()
    expect(store.recall('client:a', 'c1')).toEqual({ gemini: { thoughtSignature: 'sig' } })
    store.remember('client:a', 'c2', { gemini: { thoughtSignature: 'two' } })
    store.remember('client:a', 'c3', { gemini: { thoughtSignature: 'three' } })
    expect(store.size()).toBe(2)
    now = 5_000
    expect(store.recall('client:a', 'c3')).toBeUndefined()
  })
})

describe('route trace', () => {
  it('records fallbacks and the served model for the caller session only', async () => {
    const model = new ScriptedModel([[
      { kind: 'route_switching', from: { providerId: 'alpha', modelId: 'a1' }, to: { providerId: 'beta', modelId: 'b1' }, reason: 'quota' },
      { kind: 'assistant_text_delta', text: 'hi', route: { routePoolId: 'pool', targetId: 't2', providerId: 'beta', modelId: 'b1', requestedModelId: 'coding' } },
      { kind: 'completed', stopReason: 'stop' }
    ]])
    const rt = runtime(model)
    const response = await gatewayChatCompletions(rt, post('/v1/chat/completions',
      { model: 'coding', messages: [{ role: 'user', content: 'hi' }] }, { 'x-kun-gateway-session-id': 'sess-1', 'user-agent': 'opencode/1.1' }))
    expect((response as { status: number }).status).toBe(200)
    const trace = await gatewayRouteTrace(rt, new Request('http://x/v1/kun/route?session=sess-1', { headers: { authorization: `Bearer ${KEY}` } }))
    const body = JSON.parse((trace as { body: string }).body)
    expect(body.route).toMatchObject({ asked: 'coding', agent: 'opencode', model: 'beta/b1', served: 'beta/b1', done: true,
      status: 'completed', tries: [{ providerId: 'alpha', modelId: 'a1', fail: 'quota' }, { providerId: 'beta', modelId: 'b1' }] })
    const other = await gatewayRouteTrace(rt, new Request('http://x/v1/kun/route?session=sess-2', { headers: { authorization: `Bearer ${KEY}` } }))
    expect(JSON.parse((other as { body: string }).body)).toEqual({ route: null, seq: 0 })
  })
  it('lets a key read its own limits and refuses unknown keys', async () => {
    const rt = runtime(new ScriptedModel([[]]))
    const own = await gatewayClientLimit(rt, new Request('http://x/v1/kun/limit', { headers: { authorization: `Bearer kun-codex.${KEY}` } }))
    expect(JSON.parse((own as { body: string }).body)).toMatchObject({ limited: false, models: 'all' })
    const denied = await gatewayClientLimit(rt, new Request('http://x/v1/kun/limit', { headers: { authorization: 'Bearer nope' } }))
    expect((denied as { status: number }).status).toBe(401)
    const hello = JSON.parse(gatewayHello(rt, new Request('http://127.0.0.1:18899/api/hello')).body)
    expect(hello.gateway.limit).toBe('http://127.0.0.1:18899/v1/kun/limit')
  })
  it('long-polls until the session moves past the given sequence', async () => {
    const store = new GatewayRouteTraceStore()
    const pending = store.wait('s', 0, 5_000)
    const writer = store.begin('s', { requestId: 'r', asked: 'coding' })
    const first = await pending
    expect(first?.asked).toBe('coding')
    const next = store.wait('s', first!.seq, 5_000)
    writer.finish('completed')
    expect((await next)?.done).toBe(true)
    expect(await store.wait('s', 99, 1)).toMatchObject({ done: true })
  })
})

describe('discovery', () => {
  let dir: string | undefined
  afterEach(async () => {
    delete process.env.KUN_GATEWAY_DISCOVERY_FILE
    if (dir) await rm(dir, { recursive: true, force: true })
  })
  it('answers /api/hello without credentials and reveals no configuration', async () => {
    const response = gatewayHello(runtime(new ScriptedModel([])), new Request('http://127.0.0.1:18899/api/hello'))
    expect(JSON.parse(response.body)).toMatchObject({ name: 'kun', gateway: { enabled: true, v1: 'http://127.0.0.1:18899/v1' } })
    expect(response.body).not.toContain(KEY)
  })
  it('writes a secret-free rendezvous file and removes only its own', async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-gateway-discovery-'))
    process.env.KUN_GATEWAY_DISCOVERY_FILE = join(dir, 'gateway.json')
    await publishGatewayDiscovery({ baseUrl: 'http://127.0.0.1:18899/', version: '1.0.0', instanceId: 'one' })
    const record = JSON.parse(await readFile(process.env.KUN_GATEWAY_DISCOVERY_FILE, 'utf8'))
    expect(record).toMatchObject({ name: 'kun', v1: 'http://127.0.0.1:18899/v1', hello: 'http://127.0.0.1:18899/api/hello' })
    await removeGatewayDiscovery('other')
    await expect(readFile(process.env.KUN_GATEWAY_DISCOVERY_FILE, 'utf8')).resolves.toContain('"one"')
    await removeGatewayDiscovery('one')
    await expect(readFile(process.env.KUN_GATEWAY_DISCOVERY_FILE, 'utf8')).rejects.toThrow()
  })
})

describe('agent session ids', () => {
  it('reads Codex and Claude Code headers, Claude Code metadata and Kimi cache keys, and ignores the rest', async () => {
    const { gatewaySessionHint } = await import('./gateway-caller-agent.js')
    const request = (headers: Record<string, string> = {}) => new Request('http://x/v1/messages', { headers })
    expect(gatewaySessionHint(request({ session_id: 'codex-1' }))).toBe('codex-1')
    expect(gatewaySessionHint(request({ 'x-claude-code-session-id': 'cc-1' }))).toBe('cc-1')
    expect(gatewaySessionHint(request(), { metadata: { user_id: '{"device_id":"d","session_id":"4fdd74e7-bc52"}' } })).toBe('4fdd74e7-bc52')
    expect(gatewaySessionHint(request(), { prompt_cache_key: 'session_fd45a3d6' })).toBe('session_fd45a3d6')
    expect(gatewaySessionHint(request(), { prompt_cache_key: 'tenant-cache' })).toBeUndefined()
    expect(gatewaySessionHint(request({ session_id: 'bad id!' }), { metadata: { user_id: 'plain-user' } })).toBeUndefined()
  })
  it('reads what current agents send: Codex session-id and client_metadata, OpenCode promptCacheKey', async () => {
    const { gatewaySessionHint } = await import('./gateway-caller-agent.js')
    const request = (headers: Record<string, string> = {}) => new Request('http://x/v1/responses', { headers })
    // Captured from Codex 0.145, Kimi Code 0.29 and OpenCode 1.1.47 through the wiring smoke.
    expect(gatewaySessionHint(request({ 'session-id': '01a114d8-5822-7940-bb83-4c7a4b7037f2' }))).toBe('01a114d8-5822-7940-bb83-4c7a4b7037f2')
    expect(gatewaySessionHint(request(), { prompt_cache_key: '01a114d8-5822', client_metadata: { session_id: '01a114d8-5822' } })).toBe('01a114d8-5822')
    expect(gatewaySessionHint(request(), { promptCacheKey: 'ses_eeb23df1cffemJMMBlLedBjbEu' })).toBe('ses_eeb23df1cffemJMMBlLedBjbEu')
    // Crush 0.97 and Goose 1.53.
    expect(gatewaySessionHint(request({ 'x-session-id': 'c0f86c2404d24718' }))).toBe('c0f86c2404d24718')
    expect(gatewaySessionHint(request({ 'agent-session-id': '20261007_1' }))).toBe('20261007_1')
    // A bare cache key could be a per-prompt hash and is not taken as a session.
    expect(gatewaySessionHint(request(), { prompt_cache_key: '01a114d8-5822' })).toBeUndefined()
  })
  it('groups traces by the agent session when the client sends no Kun session header', async () => {
    const model = new ScriptedModel([[{ kind: 'assistant_text_delta', text: 'hi' }, { kind: 'completed', stopReason: 'stop' }]])
    const rt = runtime(model)
    await gatewayChatCompletions(rt, post('/v1/chat/completions', { model: 'coding', prompt_cache_key: 'session_abc', messages: [{ role: 'user', content: 'hi' }] }))
    const trace = await gatewayRouteTrace(rt, new Request('http://x/v1/kun/route?session=session_abc', { headers: { authorization: `Bearer ${KEY}` } }))
    expect(JSON.parse((trace as { body: string }).body).route).toMatchObject({ asked: 'coding', done: true })
  })
})
