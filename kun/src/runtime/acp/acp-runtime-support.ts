/**
 * AcpRuntime support: delegated trace records (same shape as the other
 * delegated runtimes) and the ACP failure → finishTurn mapping (03 §9).
 */
import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../../contracts/model-request-trace.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
import type { DelegatedRuntimeCapabilities } from '../delegated-turn-runtime.js'
import {
  unsupported,
  type HarnessCapabilities
} from '../../contracts/harness-capabilities.js'
import { ACP_DEFAULT_CAPABILITIES } from '../../harness/builtin-harnesses.js'
import { AcpError, type McpServer } from './acp-schema.js'

export type AcpTrace = {
  sink: LlmDebugSink
  round: LlmDebugRound
  record: ModelRequestTraceRecord
}

export async function startAcpTrace(
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
  }
): Promise<AcpTrace | undefined> {
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
      providerKind: 'acp',
      phase: input.phase,
      ...(input.preparationReason ? { reason: input.preparationReason } : {}),
      contextManagement: 'sdk-managed',
      nativeHistory: input.phase === 'resumed' ? 'known' : 'none',
      capabilities: acpLegacyCapabilities()
    }
    const record = sink.beginCliInvocation(round, {
      endpointFormat: 'acp',
      target: `acp://${input.harnessId}/session`,
      bodyText: JSON.stringify({ model: input.model, prompt: input.prompt }),
      delegated
    })
    return { sink, round, record }
  } catch {
    if (round) void sink.finish(round).catch(() => undefined)
    return undefined
  }
}

export async function finishAcpTrace(
  trace: AcpTrace | undefined,
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

export function acpLegacyCapabilities(): DelegatedRuntimeCapabilities {
  return {
    nativeResume: true,
    structuredStreaming: true,
    kunTools: true,
    externalApproval: true,
    liveSteering: false,
    nativeContextTelemetry: false,
    fork: false
  }
}

/**
 * ACP failure → finishTurn code/message (03 §9): startup spawn/init failures
 * read as `harness_not_ready`; mid-turn process death is `harness_crashed`;
 * malformed required frames are `harness_protocol_error`; the agent's own
 * JSON-RPC errors are `agent_error`. User-facing text is bounded and never
 * carries environment or credential material.
 */
export function mapAcpFailure(
  error: unknown,
  startup: boolean
): { code: string; message: string } {
  if (error instanceof AcpError) {
    switch (error.code) {
      case 'request_timeout':
        return startup
          ? {
              code: 'harness_not_ready',
              message: 'ACP agent did not complete startup in time'
            }
          : { code: 'request_timeout', message: sanitize(error.message) }
      case 'harness_protocol_error':
        return { code: 'harness_protocol_error', message: sanitize(error.message) }
      case 'harness_crashed':
      case 'connection_closed':
        return { code: 'harness_crashed', message: sanitize(error.message) }
      case 'policy_denied':
        return { code: 'policy_denied', message: sanitize(error.message) }
      case 'request_aborted':
        return { code: 'request_aborted', message: sanitize(error.message) }
      case 'agent_error':
      default:
        return { code: 'agent_error', message: sanitize(error.message) }
    }
  }
  const errno = error as NodeJS.ErrnoException
  if (
    errno?.code === 'ENOENT' ||
    errno?.code === 'EACCES' ||
    errno?.code === 'EPERM'
  ) {
    return {
      code: 'harness_not_ready',
      message: `ACP agent executable is not available (${errno.code})`
    }
  }
  return {
    code: startup ? 'harness_not_ready' : 'agent_error',
    message: sanitize(error instanceof Error ? error.message : String(error))
  }
}

function sanitize(message: string): string {
  return message.slice(0, 2_000)
}

/**
 * Pre-connect capability view (P3-09): the static ACP declaration, narrowed
 * to not claim `kunTools` when this runtime cannot hand out MCP descriptors.
 */
export function acpStaticCapabilities(kunToolsDeliverable: boolean): HarnessCapabilities {
  if (kunToolsDeliverable) return ACP_DEFAULT_CAPABILITIES
  return {
    ...ACP_DEFAULT_CAPABILITIES,
    statuses: {
      ...ACP_DEFAULT_CAPABILITIES.statuses,
      kunTools: unsupported('not-implemented', {
        message: 'Kun Tools MCP requires a serve-hosted runtime to deliver descriptors'
      })
    }
  }
}

/** Which kun-tools transport a session request actually carried. */
export function kunToolsDescriptorOf(
  servers: readonly McpServer[]
): 'http' | 'stdio' | 'none' {
  const first = servers[0] as { type?: string } | undefined
  if (!first) return 'none'
  return first.type === 'http' ? 'http' : 'stdio'
}
