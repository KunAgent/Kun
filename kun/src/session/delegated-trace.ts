/**
 * Delegated trace records shared by every session transport (P6-02,
 * generalized from `startAcpTrace`/`finishAcpTrace`). Shape stays identical —
 * `providerKind`, `endpointFormat`, and `target` are the only per-transport
 * parameters.
 */
import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../contracts/model-request-trace.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../services/llm-debug-recorder.js'
import type { DelegatedRuntimeCapabilities } from '../runtime/delegated-turn-runtime.js'
import type { DelegatedProviderKind } from '../runtime/delegated-session-binding.js'

export type DelegatedTrace = {
  sink: LlmDebugSink
  round: LlmDebugRound
  record: ModelRequestTraceRecord
}

export async function startDelegatedTrace(
  sink: LlmDebugSink | undefined,
  input: {
    threadId: string
    turnId: string
    harnessId: string
    model: string
    prompt: readonly unknown[]
    redactedRequestValues: readonly string[]
    phase: 'portable' | 'resumed' | 'rebased'
    preparationReason?: ModelRequestTraceDelegated['reason']
    providerKind: DelegatedProviderKind
    endpointFormat: string
    target: string
    capabilities: DelegatedRuntimeCapabilities
  }
): Promise<DelegatedTrace | undefined> {
  if (!sink) return undefined
  let round: LlmDebugRound | undefined
  try {
    round = await startLlmDebugRoundIfEnabled(sink, {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.harnessId,
      model: input.model,
      redactedRequestValues: input.redactedRequestValues
    })
    if (!round) return undefined
    const delegated: ModelRequestTraceDelegated = {
      providerKind: input.providerKind,
      phase: input.phase,
      ...(input.preparationReason ? { reason: input.preparationReason } : {}),
      contextManagement: 'sdk-managed',
      nativeHistory: input.phase === 'resumed' ? 'known' : 'none',
      capabilities: input.capabilities
    }
    const record = sink.beginCliInvocation(round, {
      endpointFormat: input.endpointFormat,
      target: input.target,
      bodyText: JSON.stringify({ model: input.model, prompt: input.prompt }),
      delegated
    })
    return { sink, round, record }
  } catch {
    if (round) void sink.finish(round).catch(() => undefined)
    return undefined
  }
}

export async function finishDelegatedTrace(
  trace: DelegatedTrace | undefined,
  result: { kind: 'completed'; text: string } | { kind: 'error'; error: unknown }
): Promise<void> {
  if (!trace) return
  try {
    if (result.kind === 'completed') {
      trace.sink.captureChunk(trace.round, {
        kind: 'assistant_text_delta',
        text: result.text
      })
      trace.sink.captureChunk(trace.round, { kind: 'completed', stopReason: 'stop' })
    } else {
      trace.sink.captureChunk(trace.round, {
        kind: 'error',
        message:
          result.error instanceof Error ? result.error.message : String(result.error)
      })
      trace.sink.captureTransportError(trace.record, result.error)
    }
    await trace.sink.finish(trace.round)
  } catch {
    // Trace failures never fail a turn.
  }
}
