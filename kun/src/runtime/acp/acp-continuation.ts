import type { HarnessContinuationFailure, HarnessContinuationPayload } from '../../contracts/harness-continuation.js'
import type { RuntimeEventDraft, RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { recordHandoffInjected, type TurnHandoff } from '../../handoff/turn-handoff.js'
import type { DelegatedSessionPreparation } from '../delegated-session-binding.js'
import type { AcpConnection } from './acp-connection.js'
import type { AcpSessionHandle } from './acp-session-manager.js'
import { AcpError } from './acp-schema.js'
import { acpDiagnosticText } from './acp-diagnostic-text.js'

type ContinuationKind = 'harness_continuation_failed' | 'harness_session_recreated' | 'harness_session_recreation_failed'
export type AcpContinuationEvent = Extract<RuntimeEventDraft, { kind: ContinuationKind }>
export type AcpContinuationContext = {
  threadId: string
  turnId: string
  harnessId: string
  recordContinuationEvent?: (event: AcpContinuationEvent) => Promise<unknown>
}

export function acpContinuationFailure(
  conn: AcpConnection,
  stage: HarnessContinuationFailure['stage'],
  error?: unknown,
  fallbackCode = 'native_state_unavailable'
): HarnessContinuationFailure {
  const message = acpDiagnosticText(error instanceof Error ? error.message : typeof error === 'string' ? error : '')
  const code = error instanceof AcpError ? error.code : fallbackCode
  const child = conn.process.child
  const exited = child.exitCode != null || child.signalCode != null || code === 'harness_crashed'
  const stderrTail = exited ? acpDiagnosticText(conn.process.sanitizedStderrTail(), 4_096) : ''
  return {
    stage,
    code,
    message: message || 'No error details available from the agent',
    detailsAvailable: Boolean(message),
    ...(error instanceof AcpError && error.rpcCode !== undefined ? { rpcCode: error.rpcCode } : {}),
    connectionClosed: conn.closed,
    ...(exited ? { process: { exitCode: child.exitCode ?? null, signal: child.signalCode ?? null,
      ...(stderrTail ? { stderrTail } : {}) } } : {})
  }
}

export function acpContinuationDiagnostic(
  preparation: Pick<DelegatedSessionPreparation, 'generation' | 'nativeSessionId' | 'rebaseReason'>,
  harnessId: string,
  failure: HarnessContinuationFailure
): HarnessContinuationPayload {
  const previous = preparation
  return {
    harnessId,
    providerKind: 'acp',
    reason: preparation.rebaseReason === 'history_changed' || preparation.rebaseReason === 'capabilities_changed'
      ? preparation.rebaseReason : 'native_state_unavailable',
    previousSession: acpSessionIdentity(previous.generation, previous.nativeSessionId),
    failure
  }
}

function acpSessionIdentity(generation: number, nativeSessionId?: string) {
  const id = nativeSessionId ? acpDiagnosticText(nativeSessionId) : ''
  return { generation, ...(id ? { nativeSessionId: id } : {}) }
}

/** Always leave a production log, including when durable recording itself is unavailable. */
export async function recordAcpContinuation(
  ctx: AcpContinuationContext,
  kind: ContinuationKind,
  diagnostic: HarnessContinuationPayload,
  extra: Partial<Pick<HarnessContinuationPayload, 'replacementSession' | 'recreationError' | 'recovery'>> = {}
): Promise<void> {
  const event: AcpContinuationEvent = {
    ...diagnostic, ...extra, kind, threadId: ctx.threadId, turnId: ctx.turnId,
    timestamp: new Date().toISOString()
  }
  console.warn('[acp-continuation]', JSON.stringify(event))
  try {
    await ctx.recordContinuationEvent?.(event)
  } catch {
    // Logging failure must not turn a recoverable native-session failure into lost work.
    console.warn('[acp-continuation] diagnostic_persistence_failed', ctx.threadId, ctx.turnId, kind)
  }
}

/** Attach the same cause to the durable recovery record and its existing UI notice. */
export async function recordAcpHandoff(
  events: Pick<RuntimeEventRecorder, 'record'>,
  ids: { threadId: string; turnId: string; harnessId: string },
  handoff: TurnHandoff | undefined,
  session: AcpSessionHandle
): Promise<void> {
  if (session.continuation) {
    await recordAcpContinuation({ ...ids, recordContinuationEvent: (event) => events.record(event) },
      'harness_session_recreated', session.continuation, {
        replacementSession: acpSessionIdentity(session.preparation.generation, session.sessionId),
        recovery: {
          mode: handoff?.event.mode ?? 'none',
          recentTurns: handoff?.event.stats.recentTurns ?? 0,
          bytes: handoff?.event.stats.bytes ?? 0,
          ...(handoff?.event.sinceTurnId ? { sinceTurnId: handoff.event.sinceTurnId } : {}),
          ...(handoff ? { briefDigest: handoff.event.briefDigest } : {})
        }
      })
  }
  await recordHandoffInjected((event) => events.record({ ...event,
    ...(session.continuation ? { continuationFailure: session.continuation.failure } : {}) }), ids, handoff)
}
