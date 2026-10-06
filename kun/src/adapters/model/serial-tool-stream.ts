import type { ModelStreamChunk } from '../../ports/model-client.js'

/** Do not expose a second call when an upstream ignores the caller's serial-tool constraint. */
export async function* serialToolStream(source: AsyncIterable<ModelStreamChunk>): AsyncIterable<ModelStreamChunk> {
  let callId: string | undefined
  for await (const chunk of source) {
    if (chunk.kind === 'tool_call_delta' || chunk.kind === 'tool_call_complete') {
      if (callId !== undefined && callId !== chunk.callId) {
        yield { kind: 'error', code: 'serial_tool_constraint', message: 'The upstream returned multiple tool calls for a serial-tool request.',
          failure: { category: 'capability', httpStatus: 502, failoverAllowed: false } }
        return
      }
      callId = chunk.callId
    }
    yield chunk
  }
}
