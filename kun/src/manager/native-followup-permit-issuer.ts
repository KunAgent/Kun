import { createHash, randomUUID } from 'node:crypto'
import { CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { FollowUpArbitrationFence, ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { assertManualFollowUpFence } from './manual-followup-fence.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'
import { verifyManualNativeAdmission } from './native-followup-manual-authority.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'

/** Manager-only, manual-user-message issuer. No source or automatic authorization is inferred. */
export function issueManualNativeFollowUpPermit(input: {
  state: ServiceManagerState; store: SqliteRoomStore; threads: ThreadStore; writes: ManagerFollowUpWriteArbitration;
  fence: ManagerResourceFence; arbitration: FollowUpArbitrationFence; attemptId: string; claimToken: number;
  enabled: () => boolean; now?: () => string
}) {
  return input.writes.run(async () => {
    const now = input.now ?? (() => new Date().toISOString())
    const assertAuthority = () => assertManualFollowUpFence(input)
    assertAuthority()
    const verified = await verifyManualNativeAdmission({ store: input.store, threads: input.threads, state: input.state,
      attemptId: input.attemptId, claimToken: input.claimToken, ownerId: input.fence.ownerInstanceId, now: now() })
    const assertCurrent = () => {
      assertAuthority()
      const currentTime = now()
      if (!verified.effect.claim || verified.effect.claim.expiresAt <= currentTime || verified.policy.expiresAt <= currentTime) {
        throw new NativeFollowUpPermitError('manual native claim or policy expired before admission')
      }
      if (!verified.replay) {
        input.state.lease(verified.threadId)
        if (input.state.requiresTurnMutationFence(verified.threadId)) {
          throw new NativeFollowUpPermitError('manual native target acquired an execution owner')
        }
      }
    }
    assertCurrent()
    if (verified.replay) return verified.execution.permit!
    const issuedAt = now()
    const permit = {
      admissionKey: verified.effect.admissionKey, controlRevision: verified.controlRow.revision,
      claimToken: input.claimToken, issuedAt,
      native: { threadId: verified.threadId, requestFingerprint: verified.requestFingerprint,
        targetFingerprint: verified.owner.nativeTarget!.fingerprint, issuanceId: randomUUID(),
        manualEventId: verified.execution.envelope.eventIds[0] }
    }
    const execution = CommitmentExecutionSchema.parse({ ...verified.execution, phase: 'admitted', permit, updatedAt: issuedAt })
    const requestId = 'native-permit-' + createHash('sha256').update(input.attemptId).digest('hex')
    await input.store.commit({ requestId, checks: verified.checks,
      puts: [{ kind: 'commitment_execution', id: execution.id, roomId: execution.sourceRoomId, value: execution }],
      result: permit }, assertCurrent)
    return permit
  })
}
