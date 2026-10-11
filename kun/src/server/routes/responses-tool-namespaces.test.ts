import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { makeModelRequest, responsesToChatInput } from './model-gateway-core.js'
import { gatewayResponses } from './openai-model-gateway.js'
import { ResponsesToolNamespaces } from './responses-tool-namespaces.js'
import type { ServerRuntime } from './server-runtime.js'

type Wire = Record<string, any>
const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
const fn = (name = 'read') => ({ type: 'function', name, description: 'Read one file', strict: false, parameters: schema })
const group = (name: string, tools: Wire[] = [fn()]) => ({ type: 'namespace', name, description: `${name} file tools`, tools })
const input = [{ role: 'user', content: 'Read both files' }]
const signal = () => new AbortController().signal
function wire(response: { body: string } | Response): Wire { return JSON.parse((response as { body: string }).body) }
function events(text: string): Wire[] {
  return text.split('\n\n').flatMap((frame) => {
    const line = frame.split('\n').find((entry) => entry.startsWith('data: '))
    return line ? [JSON.parse(line.slice(6))] : []
  })
}
function request(body: Wire): Request {
  return new Request('http://localhost/v1/responses', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ model: 'local', ...body }) })
}
function runtime(modelClient: ModelClient): ServerRuntime {
  return {
    modelClient,
    modelConnections: { snapshot: async () => ({ providers: [{ id: 'fixture', kind: 'http', authType: 'api-key', configured: true, credentialStatus: 'ready', models: ['model'] }] }) },
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => false, credentials: { verify: (value: string) => value === 'fixture' },
      pools: () => [{ id: 'pool', modelId: 'local', enabled: true, targets: [{ id: 'target', providerId: 'fixture', modelId: 'model', enabled: true }] }]
    }
  } as unknown as ServerRuntime
}

class NamespaceModel implements ModelClient {
  provider = 'fixture'
  model = 'fixture'
  requests: ModelRequest[] = []
  constructor(private readonly script: (request: ModelRequest, count: number) => ModelStreamChunk[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield* this.script(request, this.requests.length)
  }
}

describe('Responses namespace declarations', () => {
  it('preserves schema, namespace description and global functions with repeated leaf names', () => {
    const mapper = new ResponsesToolNamespaces({ model: 'local', input, tools: [fn(), group('alpha'), group('beta')] })
    const sent = makeModelRequest(responsesToChatInput(mapper.input, mapper), signal())
    expect(sent.tools).toHaveLength(3)
    expect(sent.tools[0].name).toBe('read')
    expect(new Set(sent.tools.map((tool) => tool.name)).size).toBe(3)
    for (const tool of sent.tools) expect(tool.inputSchema).toEqual(schema)
    expect(sent.tools[1].description).toContain('alpha file tools')
    expect(sent.tools[1].description).toContain('Function "read": Read one file')
    expect(mapper.wireIdentity(sent.tools[1].name)).toEqual({ namespace: 'alpha', name: 'read' })
    expect(mapper.wireIdentity(sent.tools[2].name)).toEqual({ namespace: 'beta', name: 'read' })
    expect(mapper.wireIdentity('read')).toEqual({ name: 'read' })
  })

  it('uses bounded stable names independent of tool order or lossy delimiter joins', () => {
    const tools = [group('a_b', [fn('c')]), group('a', [fn('b_c')]), group('x'.repeat(100), [fn('y'.repeat(100))])]
    const first = new ResponsesToolNamespaces({ input, tools })
    const reordered = new ResponsesToolNamespaces({ input, tools: [...tools].reverse() })
    const aliases = (first.input.tools as Wire[]).map((tool) => tool.name)
    expect(new Set(aliases).size).toBe(3)
    expect(aliases.every((alias) => /^[A-Za-z0-9_-]{1,64}$/.test(alias))).toBe(true)
    expect((reordered.input.tools as Wire[]).map((tool) => tool.name)).toEqual([...aliases].reverse())
  })

  it('fails closed if a caller-supplied global name collides with an internal alias', () => {
    const first = new ResponsesToolNamespaces({ input, tools: [group('alpha')] })
    const alias = (first.input.tools as Wire[])[0].name
    expect(() => new ResponsesToolNamespaces({ input, tools: [fn(alias), group('alpha')] })).toThrow('collides')
    expect(() => new ResponsesToolNamespaces({ input, tools: [group('alpha'), fn(alias)] })).toThrow('collides')
  })

  it('does not reserve the alias prefix for unrelated, explicitly declared global functions', () => {
    const mapper = new ResponsesToolNamespaces({ input, tools: [fn('kun_ns_user_owned')] })
    expect(mapper.wireIdentity('kun_ns_user_owned')).toEqual({ name: 'kun_ns_user_owned' })
  })

  it.each([
    { tools: [group('alpha'), group('alpha')], error: 'Duplicate Responses namespace declaration' },
    { tools: [group('alpha', [fn(), fn()])], error: 'Duplicate Responses function identity' },
    { tools: [group('alpha', [])], error: 'namespace tools must be a nonempty array' },
    { tools: [{ type: 'namespace', name: 'alpha', tools: [fn()] }], error: 'namespace description must be a string' },
    { tools: [group('alpha', [group('nested')])], error: "Namespace member type 'namespace' is not supported" },
    { tools: [group('alpha', [{ type: 'custom', name: 'apply_patch', format: { type: 'grammar', syntax: 'lark', definition: 'start: WORD' } }])], error: "Namespace member type 'custom' is not supported" },
    { tools: [group('alpha', [{ ...fn(), defer_loading: true }])], error: 'Deferred function discovery is not supported' },
    { tools: [group('alpha', [{ ...fn(), async: true }])], error: 'Asynchronous function tools are not supported' },
    { tools: [group('alpha', [{ ...fn(), allowed_callers: ['programmatic'] }])], error: 'Only direct function callers are supported' },
    { tools: [group('alpha', [{ ...fn(), output_schema: schema }])], error: 'Function output_schema is not supported' },
    { tools: [{ ...group('alpha'), unexpected_control: true }], error: 'Unsupported Responses namespace controls' },
    { tools: [fn(), fn()], error: 'Duplicate Responses function identity' }
  ])('rejects unsupported or ambiguous namespace semantics: $error', ({ tools, error }) => {
    expect(() => new ResponsesToolNamespaces({ input, tools })).toThrow(error)
  })

  it('limits the expanded function count rather than just namespace count', () => {
    const tools = [group('alpha', Array.from({ length: 129 }, (_, index) => fn(`read_${index}`)))]
    expect(() => new ResponsesToolNamespaces({ input, tools })).toThrow('128')
  })

  it('still rejects strict=true instead of weakening strict namespace schemas', () => {
    expect(() => makeModelRequest(responsesToChatInput({ model: 'local', input, tools: [group('alpha', [{ ...fn(), strict: true }])] }), signal())).toThrow('Strict')
  })
})

describe('Responses namespace history and tool selection', () => {
  it('maps history consistently while checking namespaced result identity', () => {
    const mapper = new ResponsesToolNamespaces({ model: 'local', tools: [group('alpha'), group('beta')], input: [
      ...input,
      { type: 'function_call', call_id: 'a', namespace: 'alpha', name: 'read', arguments: '{"path":"a"}' },
      { type: 'function_call', call_id: 'b', namespace: 'beta', name: 'read', arguments: '{"path":"b"}' },
      { type: 'function_call_output', call_id: 'b', namespace: 'beta', name: 'read', output: 'beta result' },
      { type: 'function_call_output', call_id: 'a', namespace: 'alpha', name: 'read', output: 'alpha result' }
    ] })
    const sent = makeModelRequest(responsesToChatInput(mapper.input, mapper), signal())
    const [alpha, beta] = sent.tools.map((tool) => tool.name)
    expect(sent.history.slice(1)).toEqual([
      expect.objectContaining({ kind: 'tool_call', callId: 'a', toolName: alpha, arguments: { path: 'a' } }),
      expect.objectContaining({ kind: 'tool_call', callId: 'b', toolName: beta, arguments: { path: 'b' } }),
      expect.objectContaining({ kind: 'tool_result', callId: 'b', toolName: beta, output: 'beta result' }),
      expect.objectContaining({ kind: 'tool_result', callId: 'a', toolName: alpha, output: 'alpha result' })
    ])
  })

  it.each([{ name: 'wrong' }, { namespace: 'wrong' }])('rejects mismatched tool result identity: %j', (wrong) => {
    expect(() => new ResponsesToolNamespaces({ input: [
      { type: 'function_call', call_id: 'a', namespace: 'alpha', name: 'read', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a', namespace: 'alpha', name: 'read', output: 'result', ...wrong }
    ] })).toThrow('does not match')
  })

  it.each([
    { type: 'function', namespace: 'alpha', name: 'read' },
    { type: 'function', name: 'alpha.read' }
  ])('enforces the exact namespaced function selector: %j', (tool_choice) => {
    const mapper = new ResponsesToolNamespaces({ model: 'local', input, tools: [group('alpha'), group('beta')], tool_choice })
    const sent = makeModelRequest(responsesToChatInput(mapper.input, mapper), signal())
    expect(sent.tools).toHaveLength(1)
    expect(mapper.wireIdentity(sent.requiredToolName!)).toEqual({ namespace: 'alpha', name: 'read' })
  })

  it('rejects undeclared or ambiguous selectors without choosing by leaf name', () => {
    const tools = [fn('alpha.read'), group('alpha'), group('beta')]
    for (const tool_choice of [
      { type: 'function', name: 'read' }, { type: 'function', name: 'alpha.read' },
      { type: 'function', namespace: 'absent', name: 'read' }
    ]) expect(() => new ResponsesToolNamespaces({ input, tools, tool_choice })).toThrow()
  })

  it('retains explicit past namespace identities even when the current toolset changed', () => {
    const first = new ResponsesToolNamespaces({ input, tools: [group('alpha')] })
    const alias = (first.input.tools as Wire[])[0].name
    const next = new ResponsesToolNamespaces({ model: 'local', tools: [fn('new_tool')], input: [
      { type: 'function_call', namespace: 'alpha', name: 'read', call_id: 'a', arguments: '{}' },
      { type: 'function_call_output', call_id: 'a', output: 'past result' }
    ] })
    const sent = makeModelRequest(responsesToChatInput(next.input, next), signal())
    expect(sent.tools[0].name).toBe('new_tool')
    expect(sent.history[0]).toMatchObject({ toolName: alias })
    expect(sent.history[1]).toMatchObject({ toolName: alias, output: 'past result' })
    expect(() => next.wireIdentity(alias)).toThrow('undeclared')
  })
})

describe('Responses namespace wire round trips', () => {
  it.each([false, true])('round-trips parallel namespaced calls and a second turn with stream=%s', async (stream) => {
    const tools = [group('alpha'), group('beta')]
    const model = new NamespaceModel((sent, count) => count > 1 ? [
      { kind: 'assistant_text_delta', text: 'done' }, { kind: 'completed', stopReason: 'stop' }
    ] : [
      { kind: 'tool_call_delta', callId: 'a', toolName: sent.tools[0].name, argumentsDelta: '{"path":' },
      { kind: 'tool_call_delta', callId: 'b', toolName: sent.tools[1].name, argumentsDelta: '{"path":"b"}' },
      { kind: 'tool_call_delta', callId: 'a', argumentsDelta: '"a"}' },
      { kind: 'tool_call_complete', callId: 'a', toolName: sent.tools[0].name, arguments: { path: 'a' } },
      { kind: 'tool_call_complete', callId: 'b', toolName: sent.tools[1].name, arguments: { path: 'b' } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])
    const rt = runtime(model)
    const response = await gatewayResponses(rt, request({ input, tools, stream }))
    expect(response.status).toBe(200)
    const outputEvents = stream ? events(await (response as Response).text()) : []
    const first = stream ? outputEvents.at(-1)!.response : wire(response)
    expect(first.output).toEqual([
      expect.objectContaining({ type: 'function_call', call_id: 'a', namespace: 'alpha', name: 'read', arguments: '{"path":"a"}' }),
      expect.objectContaining({ type: 'function_call', call_id: 'b', namespace: 'beta', name: 'read', arguments: '{"path":"b"}' })
    ])
    if (stream) {
      const added = outputEvents.filter((event) => event.type === 'response.output_item.added')
      expect(added.map((event) => [event.output_index, event.item.namespace, event.item.name])).toEqual([[0, 'alpha', 'read'], [1, 'beta', 'read']])
      const done = outputEvents.filter((event) => event.type === 'response.function_call_arguments.done')
      expect(done.map((event) => [event.namespace, event.name])).toEqual([['alpha', 'read'], ['beta', 'read']])
      expect(JSON.stringify(outputEvents)).not.toContain('kun_ns_')
    }
    const followup = await gatewayResponses(rt, request({ tools: [...tools].reverse(), input: [
      ...input, ...first.output,
      { type: 'function_call_output', call_id: 'a', name: 'read', namespace: 'alpha', output: 'alpha result' },
      { type: 'function_call_output', call_id: 'b', name: 'read', namespace: 'beta', output: 'beta result' },
      { role: 'user', content: 'summarize' }
    ] }))
    expect(followup.status).toBe(200)
    expect(wire(followup).output[0].content[0].text).toBe('done')
    expect(model.requests[1].history.filter((item) => item.kind === 'tool_call').map((item) => item.toolName))
      .toEqual(model.requests[0].tools.map((tool) => tool.name))
    expect(model.requests[1].history.filter((item) => item.kind === 'tool_result').map((item) => item.toolName))
      .toEqual(model.requests[0].tools.map((tool) => tool.name))
  })

  it('rejects unqualified upstream selection instead of guessing a namespace', async () => {
    const model = new NamespaceModel(() => [
      { kind: 'tool_call_complete', callId: 'a', toolName: 'read', arguments: {} },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])
    const response = await gatewayResponses(runtime(model), request({ input, tools: [group('alpha'), group('beta')] }))
    expect(response.status).toBe(502)
    expect(wire(response).error.message).toContain('ambiguous')
  })
})
