import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { Router } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { geminiGenerate, geminiModels } from './gemini-gateway.js'
import { geminiToChatInput, normalizeGeminiSchema } from './gemini-gateway-input.js'

const KEY = 'fixture-key'
type Wire = Record<string, any>

class ScriptedModel implements ModelClient {
  provider = 'fixture'
  model = 'fixture'
  last?: ModelRequest
  constructor(private readonly chunks: ModelStreamChunk[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> { this.last = request; yield* this.chunks }
}

function runtime(model: ModelClient): ServerRuntime {
  return {
    modelClient: model,
    modelConnections: { snapshot: async () => ({ revision: 1, providers: [{ id: 'alpha', name: 'Alpha', kind: 'http', authType: 'api-key',
      configured: true, credentialStatus: 'ready', endpointFormat: 'chat_completions', models: ['a1'] }] }) },
    modelGateway: {
      enabled: () => true, exposeProviderModels: () => true,
      credentials: { verify: (value: string | null) => value === KEY },
      pools: () => []
    }
  } as unknown as ServerRuntime
}

function call(path: string, body: Wire, headers: Record<string, string> = { 'x-goog-api-key': KEY }): Request {
  return new Request(`http://127.0.0.1:18899/v1beta/models/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body) })
}

const hello = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }

describe('Gemini ingress translation', () => {
  it('maps contents, system instruction, function calls and thinking config', () => {
    const input = geminiToChatInput('alpha/a1', {
      systemInstruction: { parts: [{ text: 'be brief' }] },
      contents: [
        { role: 'user', parts: [{ text: 'read' }] },
        { role: 'model', parts: [{ text: 'plan', thought: true }, { functionCall: { name: 'read', args: { path: 'x' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'read', response: { content: 'ok' } } }] }
      ],
      tools: [{ functionDeclarations: [{ name: 'read', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } }] }],
      generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 0 } }
    }, false)
    expect(input).toMatchObject({ max_tokens: 100, reasoning_effort: 'off' })
    const messages = input.messages as Wire[]
    expect(messages[0]).toEqual({ role: 'system', content: 'be brief' })
    expect(messages[2]).toMatchObject({ role: 'assistant', reasoning_content: 'plan', tool_calls: [{ function: { name: 'read' } }] })
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: messages[2]!.tool_calls[0].id, name: 'read' })
    expect((input.tools as Wire[])[0].function.parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } } })
  })
  it('rejects semantics the gateway cannot honor', () => {
    expect(() => geminiToChatInput('m', { ...hello, cachedContent: 'cachedContents/x' }, false)).toThrow('cachedContent')
    expect(() => geminiToChatInput('m', { ...hello, tools: [{ googleSearch: {} }] }, false)).toThrow('googleSearch')
    expect(() => geminiToChatInput('m', { ...hello, generationConfig: { stopSequences: ['x'] } }, false)).toThrow('stopSequences')
    expect(() => geminiToChatInput('m', { contents: [{ role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] }] }, false))
      .toThrow('preceding functionCall')
  })
  it('lower-cases Gemini schema types recursively', () => {
    expect(normalizeGeminiSchema({ type: 'ARRAY', items: { type: 'NUMBER' } })).toEqual({ type: 'array', items: { type: 'number' } })
  })
})

describe('Gemini gateway endpoints', () => {
  it('routes provider/model ids that contain a slash', () => {
    const router = new Router()
    router.add('POST', '/v1beta/models/*call', () => ({ status: 200, headers: {}, body: '' }))
    expect(router.match('POST', '/v1beta/models/alpha/a1:generateContent')?.params.call).toBe('alpha/a1:generateContent')
    expect(router.match('POST', '/v1beta/models')).toBeUndefined()
    expect(router.match('POST', '/v1beta/models/a%2Fb:generateContent')).toBeUndefined()
  })
  it('answers generateContent with text, function calls and usage metadata', async () => {
    const model = new ScriptedModel([
      { kind: 'assistant_text_delta', text: 'hel' }, { kind: 'assistant_text_delta', text: 'lo' },
      { kind: 'tool_call_complete', callId: 'c1', toolName: 'read', arguments: { path: 'x' } },
      { kind: 'usage', usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, cacheHitRate: null, turns: 1 } },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])
    const response = await geminiGenerate(runtime(model), call('alpha/a1:generateContent', hello), 'alpha/a1:generateContent')
    const body = JSON.parse((response as { body: string }).body)
    expect(body.candidates[0]).toMatchObject({ finishReason: 'STOP', content: { role: 'model', parts: [
      { text: 'hello' }, { functionCall: { id: 'c1', name: 'read', args: { path: 'x' } } }] } })
    expect(body.usageMetadata).toMatchObject({ promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 })
    expect(model.last?.model).toBe('a1')
  })
  it('streams SSE frames and hides thoughts unless includeThoughts is set', async () => {
    const chunks: ModelStreamChunk[] = [
      { kind: 'assistant_reasoning_delta', text: 'think' }, { kind: 'assistant_text_delta', text: 'answer' }, { kind: 'completed', stopReason: 'stop' }
    ]
    const hidden = await geminiGenerate(runtime(new ScriptedModel(chunks)), call('alpha/a1:streamGenerateContent?alt=sse', hello), 'alpha/a1:streamGenerateContent') as Response
    const frames = (await hidden.text()).split('\r\n\r\n').filter(Boolean).map((frame) => JSON.parse(frame.slice(6)))
    expect(frames.flatMap((frame) => frame.candidates[0].content.parts)).toEqual([{ text: 'answer' }])
    expect(frames.at(-1).candidates[0].finishReason).toBe('STOP')
    const shown = await geminiGenerate(runtime(new ScriptedModel(chunks)), call('alpha/a1:streamGenerateContent',
      { ...hello, generationConfig: { thinkingConfig: { includeThoughts: true } } }), 'alpha/a1:streamGenerateContent') as Response
    expect(await shown.text()).toContain('"thought":true')
  })
  it('authenticates with x-goog-api-key or ?key= and rejects others', async () => {
    const model = new ScriptedModel([{ kind: 'completed', stopReason: 'stop' }])
    const viaQuery = await geminiGenerate(runtime(model), call(`alpha/a1:generateContent?key=${KEY}`, hello, {}), 'alpha/a1:generateContent')
    expect((viaQuery as { status: number }).status).toBe(200)
    const denied = await geminiGenerate(runtime(model), call('alpha/a1:generateContent', hello, { 'x-goog-api-key': 'wrong' }), 'alpha/a1:generateContent')
    expect(JSON.parse((denied as { body: string }).body)).toMatchObject({ error: { code: 401, status: 'UNAUTHENTICATED' } })
  })
  it('carries inline images as message attachments and pairs parallel function calls by order', async () => {
    const model = new ScriptedModel([{ kind: 'completed', stopReason: 'stop' }])
    const body = { systemInstruction: { parts: [] }, contents: [
      { role: 'user', parts: [{ text: 'what is this' }, { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] },
      { role: 'model', parts: [{ functionCall: { name: 'read', args: { p: 1 } } }, { functionCall: { name: 'read', args: { p: 2 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read', response: { r: 1 } } }, { functionResponse: { name: 'read', response: { r: 2 } } }] }] }
    const response = await geminiGenerate(runtime(model), call('alpha/a1:generateContent', body), 'alpha/a1:generateContent')
    expect((response as { status: number }).status).toBe(200)
    // An empty system instruction adds no system prompt.
    expect(model.last?.systemPrompt ?? '').toBe('')
    expect(model.last?.attachments).toEqual([expect.objectContaining({ mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' })])
    const history = model.last?.history ?? []
    const calls = history.filter((item) => item.kind === 'tool_call') as { callId: string; arguments: unknown }[]
    const results = history.filter((item) => item.kind === 'tool_result') as { callId: string; output: unknown }[]
    expect(calls.map((item) => item.arguments)).toEqual([{ p: 1 }, { p: 2 }])
    expect(results.map((item) => [item.callId, item.output])).toEqual([[calls[0]!.callId, '{"r":1}'], [calls[1]!.callId, '{"r":2}']])
  })
  it('refuses inline data outside user content and non-image data', () => {
    const image = { inlineData: { mimeType: 'image/png', data: 'AAAA' } }
    expect(() => geminiToChatInput('m', { contents: [{ role: 'model', parts: [image] }] }, false)).toThrow('only in user content')
    expect(() => geminiToChatInput('m', { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: 'AAAA' } }] }] }, false))
      .toThrow('base64 image')
    expect(() => geminiToChatInput('m', { contents: [{ role: 'user', parts: [{ functionResponse: { name: 'read', response: {} } }] }] }, false))
      .toThrow('preceding functionCall')
  })
  it('counts tokens and lists models in Gemini shape', async () => {
    const rt = runtime(new ScriptedModel([]))
    const counted = await geminiGenerate(rt, call('alpha/a1:countTokens', hello), 'alpha/a1:countTokens')
    expect(JSON.parse((counted as { body: string }).body).totalTokens).toBeGreaterThan(0)
    const listed = await geminiModels(rt, new Request('http://x/v1beta/models', { headers: { 'x-goog-api-key': KEY } }))
    expect(JSON.parse(listed.body).models[0]).toMatchObject({ name: 'models/alpha/a1', supportedGenerationMethods: expect.arrayContaining(['generateContent']) })
    const missing = await geminiGenerate(rt, call('nope:generateContent', hello), 'nope:generateContent')
    expect((missing as { status: number }).status).toBe(404)
  })
})
