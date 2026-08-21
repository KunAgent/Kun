import type { ModelStreamChunk } from '../../ports/model-client.js'

/**
 * Holds side-effecting output until an SSE attempt reaches its terminal frame.
 * Tool argument fragments are represented by one compact synthetic delta per
 * completed call, avoiding a second retained copy of every streamed fragment.
 */
export class StreamOutputReplayBuffer {
  private readonly callsWithDeltas = new Set<string>()
  private chunks: ModelStreamChunk[] = []

  defer(chunk: ModelStreamChunk): boolean {
    if (chunk.kind === 'tool_call_delta') {
      this.callsWithDeltas.add(chunk.callId)
      return true
    }
    if (chunk.kind === 'tool_call_complete') {
      if (this.callsWithDeltas.has(chunk.callId)) {
        this.chunks.push({
          kind: 'tool_call_delta',
          callId: chunk.callId,
          toolName: chunk.toolName,
          argumentsDelta: JSON.stringify(chunk.arguments) ?? '{}'
        })
      }
      this.chunks.push(chunk)
      return true
    }
    if (chunk.kind === 'image_generation_complete') {
      this.chunks.push(chunk)
      return true
    }
    return false
  }

  drain(): ModelStreamChunk[] {
    const chunks = this.chunks
    this.chunks = []
    return chunks
  }
}
