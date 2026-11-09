import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CommitmentEffectSchema, CommitmentExecutionSchema, FollowUpReceiptSchema,
  type FollowUpReceipt } from '../contracts/collaboration-effects.js'
import { CollaborationEventSchema, CommitmentEventBindingSchema } from '../contracts/collaboration-events.js'
import { manualContinueBindingId, manualContinueEventId } from '../agents/followup/manual-contract.js'
import { followUpCheck } from '../agents/followup/state.js'
import { nativeFollowUpRequest } from '../domain/native-followup-requests.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RoomStoreCommit } from '../rooms/room-store.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'
import type { FollowUpArbitrationFence, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { assertManualFollowUpFence } from './manual-followup-fence.js'
import { assertNativeUserItem } from './followup-thread-writes.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

const RECONCILE_MS = 15_000
const fail = (message: string): never => { throw new NativeFollowUpPermitError(message) }

/** Reads the Manager-owned native receiver; caller-supplied outcomes are never authority. */
export function reconcileManualFollowUp(input: {
  state: ServiceManagerState; store: SqliteRoomStore; threads: ThreadStore; sessions?: SessionStore;
  writes: ManagerFollowUpWriteArbitration; fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence;
  attemptId: string; enabled: () => boolean; now?: () => string
}): Promise<FollowUpReceipt> {
  return input.writes.run(async () => {
    const now = input.now ?? (() => new Date().toISOString())
    const assertCurrent = () => assertManualFollowUpFence(input)
    assertCurrent()
    const executionRow = await input.store.get('commitment_execution', input.attemptId)
    if (!executionRow) return fail('manual execution is unavailable for reconciliation')
    const execution = CommitmentExecutionSchema.parse(executionRow.value), envelope = execution.envelope
    if (!execution.nativeRequest || !execution.permit?.native?.manualEventId || execution.id !== input.attemptId) {
      return fail('manual native permit is unavailable for reconciliation')
    }
    const eventId = manualContinueEventId(execution.commitmentId, execution.requestId)
    if (execution.permit.native.manualEventId !== eventId || envelope.eventIds.length !== 1 || envelope.eventIds[0] !== eventId) {
      return fail('manual reconciliation event does not match the permit')
    }
    const [effectRow, eventRow, bindingRow] = await Promise.all([
      input.store.get('commitment_effect', execution.effectId), input.store.get('collaboration_event', eventId),
      input.store.get('commitment_event_binding', manualContinueBindingId(execution.commitmentId, eventId))
    ])
    if (!effectRow || !eventRow || !bindingRow) return fail('manual reconciliation records are unavailable')
    const effect = CommitmentEffectSchema.parse(effectRow.value), event = CollaborationEventSchema.parse(eventRow.value)
    const binding = CommitmentEventBindingSchema.parse(bindingRow.value)
    if (effect.kind !== 'continue' || effect.id !== execution.effectId || effect.requestId !== execution.requestId ||
      effect.fingerprint !== execution.fingerprint || !isDeepStrictEqual(effect.envelope, envelope) ||
      !effect.claim || !['dispatching', 'outcome_unknown', 'succeeded'].includes(effect.status) ||
      event.kind !== 'user_continue' || event.provenance.kind !== 'user_message' ||
      event.userAction?.actionId !== execution.requestId || binding.eventId !== eventId ||
      binding.effectId !== effect.id || binding.commitmentId !== execution.commitmentId ||
      binding.sourceRoomId !== execution.sourceRoomId || binding.participantAgentId !== execution.participantAgentId) {
      return fail('manual reconciliation identity is inconsistent')
    }
    assertCurrent()
    if (execution.phase === 'terminal' && execution.receipt?.state === 'terminal') return execution.receipt

    const base = { receiver: 'native' as const, requestId: execution.requestId,
      fingerprint: execution.fingerprint, observedAt: now() }
    const unknown = (reason: string): FollowUpReceipt => ({ ...base, state: 'unknown', reason })
    const threadId = execution.nativeRequest.threadId
    let observed: FollowUpReceipt = unknown('native_receiver_unavailable')
    let terminalNeedsIdle = false
    try {
      const thread = input.threads.getMetadata ? await input.threads.getMetadata(threadId) : await input.threads.get(threadId)
      if (!thread) observed = unknown('native_thread_unavailable')
      else {
        const row = nativeFollowUpRequest(thread, execution.requestId)
        const admission = { requestId: execution.requestId, effectId: execution.effectId, attemptId: execution.attemptId,
          admissionKey: effect.admissionKey, fingerprint: execution.fingerprint }
        if (!row) observed = unknown('native_request_not_proven')
        else if (!isDeepStrictEqual(row.admission, admission) || row.threadId !== threadId ||
          row.requestFingerprint !== execution.permit.native.requestFingerprint) observed = unknown('native_request_identity_mismatch')
        else if (row.phase !== 'admitted') observed = unknown(row.phase === 'preparing'
          ? 'native_admission_preparing' : 'native_negative_receipt_unverified')
        else {
          const turn = thread.turns.find(candidate => candidate.id === row.turnId)
          const oldReceipt = effect.receipt
          const acceptedBefore = oldReceipt && ['accepted', 'terminal'].includes(oldReceipt.state) &&
            oldReceipt.receiver === 'native' && oldReceipt.targetRefId === row.turnId &&
            oldReceipt.threadId === threadId && oldReceipt.turnId === row.turnId
          if (!turn && !acceptedBefore) observed = unknown('native_turn_unavailable')
          else {
            if (!acceptedBefore) {
              if (!input.sessions || !turn) throw new Error('durable session unavailable')
              await assertNativeUserItem(input.sessions, row, execution.nativeRequest.request, thread, turn)
            }
            const target = { targetRefId: row.turnId, threadId, turnId: row.turnId }
            const lease = input.state.lease(threadId)
            const busy = Boolean(lease || input.state.requiresTurnMutationFence(threadId))
            if (row.terminalStatus && !busy) {
              terminalNeedsIdle = true
              observed = { ...base, ...target, state: 'terminal', terminalStatus: row.terminalStatus }
            } else if (row.executionStartedAt && !row.terminalStatus && (!lease || lease.turnId !== row.turnId)) {
              observed = unknown('native_execution_outcome_not_proven')
            } else {
              observed = { ...base, ...target, state: 'accepted',
                ...(row.terminalStatus ? { reason: 'native_terminal_boundary_unwinding' } : {}) }
            }
          }
        }
      }
    } catch { observed = unknown('native_receiver_proof_unavailable') }
    assertCurrent()
    const prior = effect.receipt
    const preserveAccepted = observed.state === 'unknown' && prior && ['accepted', 'terminal'].includes(prior.state)
    const receipt = FollowUpReceiptSchema.parse(preserveAccepted ? prior : observed)
    const nextWake = observed.state === 'terminal' ? null : new Date(Date.parse(now()) + RECONCILE_MS).toISOString()
    const nextEffect = CommitmentEffectSchema.parse({ ...effect, updatedAt: now(), receipt,
      status: observed.state === 'unknown' && !preserveAccepted ? 'outcome_unknown' : 'succeeded',
      retryAt: null, nextReconcileAt: nextWake,
      ...(observed.state === 'unknown' ? { error: { code: 'OUTCOME_UNKNOWN', message: observed.reason ?? 'native outcome is unknown' } }
        : { error: undefined }) })
    const nextExecution = CommitmentExecutionSchema.parse({ ...execution, updatedAt: now(), receipt,
      phase: observed.state === 'terminal' ? 'terminal' : observed.state === 'unknown' ? 'reconciling' : 'accepted',
      nextReconcileAt: nextWake })
    const puts: NonNullable<RoomStoreCommit['puts']> = [
      { kind: 'commitment_effect' as const, id: effect.id, roomId: execution.sourceRoomId, value: nextEffect },
      { kind: 'commitment_execution' as const, id: execution.id, roomId: execution.sourceRoomId, value: nextExecution }
    ]
    if (observed.state !== 'unknown' && binding.consumption === 'reserved') {
      puts.push({ kind: 'commitment_event_binding' as const, id: binding.id, roomId: execution.sourceRoomId,
        value: CommitmentEventBindingSchema.parse({ ...binding, consumption: 'consumed', updatedAt: now() }) })
    }
    await input.store.commit({ requestId: `manual-reconcile-${randomUUID()}`,
      checks: [effectRow, executionRow, eventRow, bindingRow].map(followUpCheck), puts,
      events: [{ roomId: execution.sourceRoomId, kind: 'agent.commitment.updated', payload: {
        id: execution.commitmentId, participantAgentId: execution.participantAgentId, action: 'follow_up_reconciled', state: observed.state } }],
      result: observed }, () => {
      assertCurrent()
      if (terminalNeedsIdle) {
        input.state.lease(threadId)
        if (input.state.requiresTurnMutationFence(threadId)) return fail('native terminal boundary is still owned')
      }
    })
    return observed
  })
}
