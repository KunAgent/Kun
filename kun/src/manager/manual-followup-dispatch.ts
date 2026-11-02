import { randomUUID } from 'node:crypto'
import { CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { CommitmentControlSchema } from '../contracts/collaboration-followup.js'
import { followUpPut } from '../agents/followup/state.js'
import { consumeAttempt } from '../agents/followup/budget.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'
import type { FollowUpArbitrationFence, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { assertManualFollowUpFence } from './manual-followup-fence.js'
import { verifyManualNativeAdmission } from './native-followup-manual-authority.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

/** Once-only right to make the receiver call. Lost replies must reconcile, not repeat the call. */
export function beginManualFollowUpDispatch(input: {
  state: ServiceManagerState; store: SqliteRoomStore; threads: ThreadStore; writes: ManagerFollowUpWriteArbitration;
  fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence; attemptId: string; claimToken: number;
  enabled: () => boolean; now?: () => string
}) {
  return input.writes.run(async () => {
    const now = input.now ?? (() => new Date().toISOString())
    const assertCurrent = () => assertManualFollowUpFence(input)
    assertCurrent()
    const current = await input.store.get('commitment_execution', input.attemptId)
    if (!current) throw new NativeFollowUpPermitError('native dispatch execution is unavailable')
    const existing = CommitmentExecutionSchema.parse(current.value)
    if (existing.dispatch) return { shouldDispatch: false, dispatchId: existing.dispatch.id }
    const verified = await verifyManualNativeAdmission({ store: input.store, threads: input.threads, state: input.state,
      attemptId: input.attemptId, claimToken: input.claimToken, ownerId: input.fence.ownerInstanceId,
      now: now(), allowPausedIssued: true })
    if (!verified.replay || !verified.execution.permit?.native?.manualEventId) {
      throw new NativeFollowUpPermitError('native dispatch requires an issued manual permit')
    }
    const target = await input.threads.getMetadata?.(verified.threadId) ?? await input.threads.get(verified.threadId)
    if (!target || target.turns.some(turn => turn.status === 'queued' || turn.status === 'running')) {
      throw new NativeFollowUpPermitError('native dispatch target is busy')
    }
    const assertIdle = () => {
      input.state.lease(verified.threadId)
      if (input.state.requiresTurnMutationFence(verified.threadId)) {
        throw new NativeFollowUpPermitError('native dispatch target acquired an execution owner')
      }
    }
    assertIdle()
    const timestamp = now()
    if (!verified.effect.claim || verified.effect.claim.expiresAt <= timestamp || verified.policy.expiresAt <= timestamp) {
      throw new NativeFollowUpPermitError('native dispatch claim or policy has expired')
    }
    const dispatch = { id: randomUUID(), startedAt: timestamp, claimToken: input.claimToken }
    const next = CommitmentExecutionSchema.parse({ ...verified.execution, dispatch,
      nextReconcileAt: new Date(Date.parse(timestamp) + 15_000).toISOString(), updatedAt: timestamp })
    // The attempt is spent in the same commit that records the dispatch, so retrying
    // this attempt id cannot spend a second one.
    const controlRow = await input.store.get('commitment_control', next.commitmentId)
    if (!controlRow) throw new NativeFollowUpPermitError('native dispatch has no tracking control')
    const nextControl = CommitmentControlSchema.parse(consumeAttempt(
      CommitmentControlSchema.parse(controlRow.value), timestamp))
    const result = { shouldDispatch: true, dispatchId: dispatch.id }
    await input.store.commit({ requestId: `manual-dispatch-${randomUUID()}`,
      checks: verified.checks,
      puts: [{ kind: 'commitment_execution', id: next.id, roomId: next.sourceRoomId, value: next },
        followUpPut(controlRow, nextControl)], result }, () => {
      assertCurrent()
      assertIdle()
      if (!verified.effect.claim || verified.effect.claim.expiresAt <= now() || verified.policy.expiresAt <= now()) {
        throw new NativeFollowUpPermitError('native dispatch authority expired before commit')
      }
    })
    return result
  })
}
