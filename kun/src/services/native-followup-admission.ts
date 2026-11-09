import type { StartTurnRequest, StartTurnResponse, Turn } from '../contracts/turns.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { NativeFollowUpAdmissionSchema, type NativeFollowUpAdmission } from '../contracts/native-followup-requests.js'
import type { FollowUpReceipt } from '../contracts/collaboration-effects.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import { assertNativeFollowUpRequest, nativeFollowUpRequest, withNativeFollowUpRequest, NativeFollowUpRequestConflictError } from '../domain/native-followup-requests.js'
import { TurnConflictError } from './turn-conflict-error.js'
import type { TurnService } from './turn-service-core.js'

export function replayNativeFollowUpRequest(
  thread: ThreadRecord, request: StartTurnRequest, fingerprint: string | undefined, allowNativeRetry = false
): StartTurnResponse | null {
  const row = request.clientRequestId ? nativeFollowUpRequest(thread, request.clientRequestId) : undefined
  if (!row) return null
  try { assertNativeFollowUpRequest(row, fingerprint) }
  catch (error) { throw new TurnConflictError(error instanceof Error ? error.message : 'native request identity conflict') }
  if (row.phase !== 'admitted') {
    if (allowNativeRetry && row.phase === 'known_not_admitted') return null
    throw new TurnConflictError(row.phase === 'preparing'
      ? 'native follow-up admission outcome is still unknown; query the same request'
      : 'native follow-up retry requires its host admission permit')
  }
  const turn = thread.turns.find((item) => item.id === row.turnId)
  return {
    threadId: thread.id, turnId: row.turnId, userMessageItemId: row.userMessageItemId,
    ...(turn?.status === 'queued' ? { status: 'queued' as const } : {}),
    threadAgentSurface: resolveThreadAgentSurface(thread)
  }
}

export function prepareNativeFollowUpRequest(input: {
  current: ThreadRecord; next: ThreadRecord; request: StartTurnRequest;
  admission: NativeFollowUpAdmission; turnId: string; userMessageItemId: string; requestFingerprint: string | undefined
}): ThreadRecord {
  const admission = NativeFollowUpAdmissionSchema.parse(input.admission)
  const fingerprint = input.requestFingerprint
  if (admission.requestId !== input.request.clientRequestId || !fingerprint) {
    throw new TurnConflictError('native follow-up request must use its immutable requestId')
  }
  const prior = nativeFollowUpRequest(input.current, admission.requestId)
  if (prior) {
    assertNativeFollowUpRequest(prior, fingerprint, admission)
    if (prior.phase !== 'known_not_admitted' || prior.turnId !== input.turnId) {
      throw new TurnConflictError('native follow-up request cannot be admitted again')
    }
  }
  return withNativeFollowUpRequest(input.next, {
    threadId: input.current.id, admission, requestFingerprint: fingerprint,
    turnId: input.turnId, userMessageItemId: input.userMessageItemId,
    preparationRevision: (prior?.preparationRevision ?? 0) + 1,
    phase: 'preparing', createdAt: prior?.createdAt ?? input.next.updatedAt, updatedAt: input.next.updatedAt
  })
}

/** Called both at queue commit and immediately before queued execution. */
export async function withNativeFollowUpAdmission<T>(
  service: TurnService, thread: ThreadRecord, admission: NativeFollowUpAdmission, stage: 'enqueue' | 'promote',
  operation: () => Promise<T>
): Promise<T> {
  if (!service['deps'].withFollowUpAdmission || !service['deps'].threadStore.upsertIfRevision) {
    throw new TurnConflictError('native follow-up admission capability is unavailable')
  }
  return service['deps'].withFollowUpAdmission({ thread, admission, stage }, operation)
}

export async function commitQueuedTurnPromotion(
  service: TurnService, thread: ThreadRecord, candidate: Turn, next: ThreadRecord
): Promise<{ applied: boolean }> {
  const commit = async () => {
    const result = await service['commitThreadRecordCAS'](next, thread.revision ?? 0)
    if (result.applied) {
      // Stop must not observe a running record before its abort controller
      // exists. Both become visible inside the same host admission guard.
      service['inflightTurns'].set(candidate.id, new AbortController())
      service['deps'].inflight.begin({ id: candidate.id, kind: 'model', threadId: thread.id, turnId: candidate.id })
    }
    return result
  }
  const row = candidate.clientRequestId ? nativeFollowUpRequest(thread, candidate.clientRequestId) : undefined
  if (!row) return commit()
  if (row.phase !== 'admitted' || row.terminalStatus || row.executionStartedAt || row.turnId !== candidate.id ||
    row.requestFingerprint !== candidate.clientRequestFingerprint) {
    throw new TurnConflictError('native follow-up queued request is not executable')
  }
  return withNativeFollowUpAdmission(service, thread, row.admission, 'promote', commit)
}

export const nativeFollowUpOperations = {
  async lookupNativeFollowUpRequest(this: TurnService, input: {
    threadId: string; admission: NativeFollowUpAdmission
  }): Promise<FollowUpReceipt> {
    const admission = NativeFollowUpAdmissionSchema.parse(input.admission)
    const base = {
      receiver: 'native' as const, state: 'unknown' as const, requestId: admission.requestId, fingerprint: admission.fingerprint,
      observedAt: this['deps'].nowIso()
    }
    try {
      const thread = this['deps'].threadStore.getMetadata
        ? await this['deps'].threadStore.getMetadata(input.threadId)
        : await this['deps'].threadStore.get(input.threadId)
      // Absence (including removed/imported history) is not a negative receipt.
      if (!thread) return { ...base, reason: 'native_thread_unavailable' }
      const row = nativeFollowUpRequest(thread, admission.requestId)
      if (!row) return { ...base, reason: 'native_request_not_proven' }
      assertNativeFollowUpRequest(row, row.requestFingerprint, admission)
      const target = { targetRefId: row.turnId, threadId: input.threadId, turnId: row.turnId }
      const turn = thread.turns.find((item) => item.id === row.turnId)
      const owner = await this['deps'].executionLeases?.owner(input.threadId)
      const executing = this.isTurnExecutionActive(row.turnId) || owner?.turnId === row.turnId
      if (row.phase === 'preparing') return {
        ...base, ...target, state: executing ? 'in_flight' : 'preparing', reason: 'native_admission_not_committed'
      }
      if (row.phase === 'known_not_admitted') return {
        ...base, ...target, state: executing ? 'unknown' : 'known_not_admitted',
        reason: executing ? 'native_execution_still_owned' : 'native_admission_rolled_back'
      }
      const terminalStatus = row.terminalStatus ?? (turn?.status === 'completed' ? 'completed'
        : turn?.status === 'failed' ? 'failed' : turn?.status === 'aborted' ? 'cancelled' : undefined)
      if (terminalStatus && !executing) return { ...base, ...target, state: 'terminal', terminalStatus }
      if (row.executionStartedAt && !terminalStatus && !executing) return {
        ...base, ...target, state: 'unknown', reason: 'native_execution_outcome_not_proven'
      }
      return {
        ...base, ...target, state: executing ? 'in_flight' : 'accepted',
        ...(terminalStatus ? { reason: 'native_terminal_boundary_unwinding' } : {})
      }
    } catch (error) {
      if (error instanceof NativeFollowUpRequestConflictError) throw error
      return { ...base, reason: 'native_query_unavailable' }
    }
  }
}
