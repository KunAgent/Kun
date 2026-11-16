import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../../contracts/model-request-trace.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'

export type AntigravityTrace = {
  sink: LlmDebugSink
  round: LlmDebugRound
  record: ModelRequestTraceRecord
}

/** Open the per-attempt model-request debug trace for an Antigravity CLI turn. */
export async function startAntigravityTrace(
  sink: LlmDebugSink | undefined,
  input: {
    threadId: string
    turnId: string
    provider: string
    model: string
    prompt: string
    redactedRequestValues: readonly string[]
    effort: 'low' | 'medium' | 'high'
    planMode: boolean
    approvalPolicy: string
    sandboxMode: string
    delegated: ModelRequestTraceDelegated
  }
): Promise<AntigravityTrace | undefined> {
  if (!sink) return undefined
  let round: LlmDebugRound | undefined
  try {
    round = await startLlmDebugRoundIfEnabled(sink, {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.provider,
      model: input.model,
      redactedRequestValues: input.redactedRequestValues
    })
    if (!round) return undefined
    const record = sink.beginCliInvocation(round, {
      endpointFormat: 'antigravity-cli',
      target: 'antigravity-cli://local/print',
      bodyText: JSON.stringify({
        model: input.model,
        input: input.prompt,
        effort: input.effort,
        mode: input.planMode ? 'plan' : 'agent',
        approvalPolicy: input.approvalPolicy,
        sandboxMode: input.sandboxMode
      }),
      delegated: input.delegated
    })
    return { sink, round, record }
  } catch {
    if (round) void sink.finish(round).catch(() => undefined)
    warnAntigravityTraceFailure()
    return undefined
  }
}

/** Finalize an open Antigravity trace with the completed reply or error. */
export async function finishAntigravityTrace(
  trace: AntigravityTrace | undefined,
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
        message: result.error instanceof Error ? result.error.message : String(result.error)
      })
      trace.sink.captureTransportError(trace.record, result.error)
    }
    await trace.sink.finish(trace.round)
  } catch {
    warnAntigravityTraceFailure()
  }
}

let antigravityTraceFailureWarned = false

function warnAntigravityTraceFailure(): void {
  if (antigravityTraceFailureWarned) return
  antigravityTraceFailureWarned = true
  console.warn(
    '[kun:antigravity] model request observability capture failed; the CLI turn continues unchanged'
  )
}
