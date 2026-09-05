import type { ModelRequestTraceRecord } from '../contracts/model-request-trace.js'
import type { ModelStreamChunk } from '../ports/model-client.js'
import type { CaptureState } from './llm-debug-recorder-contracts.js'

export function isFirstContentChunk(chunk: ModelStreamChunk): boolean {
  return chunk.kind === 'assistant_text_delta' ||
    chunk.kind === 'assistant_reasoning_delta' ||
    chunk.kind === 'tool_call_delta' ||
    chunk.kind === 'tool_call_complete' ||
    chunk.kind === 'image_generation_complete'
}

export function retainedTextLength(state: CaptureState): number {
  return state.text.blocks.reduce((total, value) => total + value.length, 0) +
    state.text.parts.reduce((total, value) => total + value.length, 0)
}

export function retainedReasoningLength(state: CaptureState): number {
  return state.reasoning.blocks.reduce((total, value) => total + value.length, 0) +
    state.reasoning.parts.reduce((total, value) => total + value.length, 0)
}

/** Durable trajectory rows deliberately omit wire bodies and response text. */
export function persistentMetadataRecord(record: ModelRequestTraceRecord): ModelRequestTraceRecord {
  return {
    ...record,
    ...(record.request
      ? {
          request: {
            method: record.request.method,
            url: record.request.url,
            urlRedacted: record.request.urlRedacted,
            headers: emptyHeaders(),
            body: emptyBody()
          }
        }
      : { request: undefined }),
    ...(record.response
      ? {
          response: {
            status: record.response.status,
            statusText: record.response.statusText,
            headers: emptyHeaders(),
            ...(record.response.captureError ? { captureError: record.response.captureError } : {})
          }
        }
      : { response: undefined }),
    ...(record.decoded
      ? {
          decoded: {
            text: '',
            reasoning: '',
            toolCalls: record.decoded.toolCalls.map((call) => ({
              callId: call.callId,
              toolName: call.toolName,
              arguments: {}
            })),
            ...(record.decoded.usage ? { usage: { ...record.decoded.usage } } : {}),
            ...(record.decoded.stopReason ? { stopReason: record.decoded.stopReason } : {}),
            ...(record.decoded.error ? { error: record.decoded.error } : {}),
            ...(record.decoded.truncated ? { truncated: { ...record.decoded.truncated } } : {})
          }
        }
      : { decoded: undefined })
  }
}

export function interruptedRecord(record: ModelRequestTraceRecord): ModelRequestTraceRecord {
  const finishedAt = new Date().toISOString()
  return {
    ...record,
    status: 'interrupted',
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(record.startedAt)),
    error: record.error ?? 'request was interrupted before the runtime recorded a terminal state'
  }
}

export function emptyHeaders(): { values: Record<string, string>; redactedNames: string[] } {
  return { values: {}, redactedNames: [] }
}

export function emptyBody(): { text: string; capturedBytes: number; originalBytes: number; truncated: boolean } {
  return { text: '', capturedBytes: 0, originalBytes: 0, truncated: false }
}
