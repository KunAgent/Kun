import { describe, expect, it } from 'vitest'
import { CompatModelClient } from '../../adapters/model/compat-model-client.js'
import { serialToolStream } from '../../adapters/model/serial-tool-stream.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import { makeModelRequest } from './model-gateway-core.js'
import { anthropicToChatInput } from './anthropic-gateway-input.js'

describe('serial tools across gateway protocols', () => {
  it.each(['chat_completions', 'responses', 'messages'] as const)('preserves serial selection when calling %s', async (endpointFormat) => {
    let sent: Record<string, unknown> | undefined
    const client = new CompatModelClient({ baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'model', endpointFormat,
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init?.body))
        return Response.json(endpointFormat === 'messages'
          ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
          : endpointFormat === 'responses' ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }] }
            : { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })
      } })
    const input = makeModelRequest({ model: 'model', messages: [{ role: 'user', content: 'hello' }],
      parallel_tool_calls: false, tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }] }, new AbortController().signal)
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(input)) chunks.push(chunk)
    expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(false)
    if (endpointFormat === 'messages') expect(sent?.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    else expect(sent?.parallel_tool_calls).toBe(false)
  })
  it('normalizes Anthropic serial selection and rejects a second upstream call instead of silently exposing it', async () => {
    const input = anthropicToChatInput({ model: 'model', max_tokens: 10, messages: [{ role: 'user', content: 'hello' }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true }, tools: [{ name: 'lookup', input_schema: { type: 'object' } }] })
    expect(makeModelRequest(input, new AbortController().signal).parallelToolCalls).toBe(false)
    async function* upstream(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'tool_call_complete', callId: 'first', toolName: 'lookup', arguments: {} }
      yield { kind: 'tool_call_complete', callId: 'second', toolName: 'lookup', arguments: {} }
    }
    const seen = []
    for await (const chunk of serialToolStream(upstream())) seen.push(chunk)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ kind: 'error', code: 'serial_tool_constraint' })
  })
})
