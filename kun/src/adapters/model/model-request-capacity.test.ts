import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import { metadataEvidence } from '../../contracts/model-metadata-evidence.js'
import { makeUserItem } from '../../domain/item.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { CompatModelClient } from './compat-model-client.js'
import { fitModelRequestOutput, modelRequestCapacityFailure } from './model-request-capacity.js'
import { capabilitySupportsRequest } from './route-capability-contract.js'

const capability = (extra: Partial<ModelCapabilityMetadata> = {}): ModelCapabilityMetadata => ({
  id: 'fixture', inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true,
  messageParts: ['text'], contextWindowTokens: 20_000, maxInputTokens: 8_000, maxOutputTokens: 6_000, ...extra
})
const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  threadId: 't', turnId: 'u', model: 'fixture', systemPrompt: 'Follow the request.', prefix: [],
  history: [makeUserItem({ id: 'i', threadId: 't', turnId: 'u', text: 'Hello' })], tools: [],
  stream: false, abortSignal: new AbortController().signal, ...extra
})
const drain = async (stream: AsyncIterable<ModelStreamChunk>) => {
  const result: ModelStreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}

describe('model request capacity', () => {
  it('counts system, tools and FIM input independently of the total window', () => {
    const large = request({ systemPrompt: 's'.repeat(33_000) })
    expect(modelRequestCapacityFailure(large, capability())?.code).toBe('model_input_limit_exceeded')
    expect(capabilitySupportsRequest(capability(), large)).toBe(false)
    expect(modelRequestCapacityFailure(request({ tools: [{ name: 'large', description: 't'.repeat(33_000), inputSchema: {} }] }), capability())?.code)
      .toBe('model_input_limit_exceeded')
    expect(modelRequestCapacityFailure(request({ fim: { prompt: 'f'.repeat(33_000), suffix: 'suffix' } }), capability())?.code)
      .toBe('model_input_limit_exceeded')
  })
  it('refuses unsupported explicit input/tool capabilities but ignores operational guesses', () => {
    expect(modelRequestCapacityFailure(request(), capability({ inputModalities: [] }))?.code).toBe('model_input_capability_unsupported')
    const toolRequest = request({ tools: [{ name: 'read', description: 'Read a file', inputSchema: {} }] })
    expect(modelRequestCapacityFailure(toolRequest, capability({ supportsToolCalling: false }))?.code).toBe('model_tools_unsupported')
    expect(modelRequestCapacityFailure(toolRequest, capability({ supportsToolCalling: false,
      evidence: metadataEvidence({}, 'adapter') }))).toBeUndefined()
  })
  it('keeps input-only allowance separate from output, and never enlarges requested output', () => {
    expect(fitModelRequestOutput(request({ maxTokens: 12_000 }), capability())).toBe(6_000)
    expect(fitModelRequestOutput(request({ maxTokens: 2_000 }), capability())).toBe(2_000)
    expect(fitModelRequestOutput(request({ systemPrompt: 's'.repeat(24_000), maxTokens: 6_000 }), capability())).toBe(6_000)
  })
  it('does not publish an operational assumed window as a transport limit', () => {
    const unknown = capability({ evidence: metadataEvidence({}, 'adapter') })
    expect(modelRequestCapacityFailure(request({ systemPrompt: 's'.repeat(100_000) }), unknown)).toBeUndefined()
  })
  for (const endpointFormat of ['chat_completions', 'responses', 'messages'] as const) {
    it(`${endpointFormat}: checks input before dispatch and forwards the legal native effort and output cap`, async () => {
      const seen: Record<string, unknown>[] = []
      const protocol = endpointFormat === 'messages' ? 'anthropic-thinking' : endpointFormat === 'responses'
        ? 'openai-responses' : 'openai-chat-completions'
      const client = new CompatModelClient({ baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-key', model: 'fixture', endpointFormat,
        modelCapabilities: () => capability({ reasoning: { supportedEfforts: ['low', 'max'], defaultEffort: 'max',
          requestProtocol: protocol, nativeEfforts: ['low', 'xhigh'], nativeDefaultEffort: 'xhigh', effortMapping: { low: 'low', max: 'xhigh' } } }),
        fetchImpl: (async (_url: unknown, init: RequestInit) => {
          seen.push(JSON.parse(String(init.body)))
          const body = endpointFormat === 'messages' ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
            : endpointFormat === 'responses' ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }
              : { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }
          return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
        }) as typeof fetch })
      const rejected = await drain(client.stream(request({ systemPrompt: 's'.repeat(33_000) })))
      expect(rejected).toContainEqual(expect.objectContaining({ kind: 'error', code: 'model_input_limit_exceeded' }))
      expect(seen).toHaveLength(0)
      const original = request({ reasoningEffort: 'max', maxTokens: 12_000 })
      const history = structuredClone(original.history)
      await drain(client.stream(original))
      expect(original.history).toEqual(history)
      expect(seen).toHaveLength(1)
      if (endpointFormat === 'responses') {
        expect(seen[0]).toMatchObject({ reasoning: { effort: 'xhigh' }, max_output_tokens: 6_000 })
      } else if (endpointFormat === 'chat_completions') {
        expect(seen[0]).toMatchObject({ reasoning_effort: 'xhigh', max_tokens: 6_000 })
      } else {
        expect(seen[0]).toMatchObject({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' }, max_tokens: 6_000 })
      }
    })
  }
  it('preserves a useful, sanitized overflow error on gateway traffic', async () => {
    const client = new CompatModelClient({ baseUrl: 'https://fixture.example', apiKey: 'secret', model: 'fixture',
      modelCapabilities: () => capability(), fetchImpl: (() => { throw new Error('must not dispatch') }) as typeof fetch })
    const result = await drain(client.stream(request({ systemPrompt: 's'.repeat(33_000), gatewayRouting: { allowedTargets: [] } })))
    expect(result[0]).toMatchObject({ code: 'model_input_limit_exceeded', failure: { httpStatus: 400, failoverAllowed: false } })
  })
})
