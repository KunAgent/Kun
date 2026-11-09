import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../../contracts/collaboration-effects.js'
import type { FollowUpReceipt } from '../../contracts/collaboration-effects.js'
import type { NativeFollowUpAdmission } from '../../contracts/native-followup-requests.js'
import type { RoomRuntimeDeps } from '../../rooms/room-runtime-types.js'

/** Bounded work per pass: a scheduler tick never becomes an unbounded scan. */
const MAX_RECONCILE_PER_PASS = 10
const MAX_DISPATCH_PER_PASS = 5
const RECONCILE_DELAY_MS = 15_000
const RETRY_DELAY_MS = 5_000

export type FollowUpPassOutcome = { active: boolean; nextWakeAt?: number }

const later = (now: number, delay: number): number => now + delay

/**
 * Reconciling unknown outcomes precedes new dispatch, so a pass never retries
 * work whose admission is still unknown. Every step is a separate Manager
 * decision; this loop only schedules and never grants authority itself.
 */
export async function runManualFollowUpPass(
  deps: RoomRuntimeDeps, nowIso: () => string
): Promise<FollowUpPassOutcome> {
  const features = deps.followUpFeatures?.()
  const manual = deps.manualFollowUp
  // Manual continuation is user-driven only; disabled and automatic are inert here.
  if (!features?.enabled || !manual) return { active: false }
  let active = false
  let nextWakeAt: number | undefined
  const wake = (at: number): void => { nextWakeAt = Math.min(nextWakeAt ?? Infinity, at) }

  const unknown = await deps.store.collaborationQuery({
    kind: 'due_effects', status: 'outcome_unknown', before: nowIso(), limit: MAX_RECONCILE_PER_PASS
  })
  for (const row of unknown) {
    active = true
    try {
      const effect = CommitmentEffectSchema.parse(row.value)
      const receipt: FollowUpReceipt = await manual.reconcile(effect.envelope.attemptId)
      if (receipt.state !== 'terminal') {
        wake(later(Date.now(), RECONCILE_DELAY_MS))
      }
    } catch {
      // Authority revoked, target busy or storage refused: retry on a slow cadence.
      wake(later(Date.now(), RETRY_DELAY_MS))
    }
  }

  const due = await deps.store.collaborationQuery({
    kind: 'due_effects', status: 'pending', before: nowIso(), limit: MAX_DISPATCH_PER_PASS
  })
  for (const row of due) {
    active = true
    try {
      const effect = CommitmentEffectSchema.parse(row.value)
      const executionRow = await deps.store.get('commitment_execution', effect.envelope.attemptId)
      if (!executionRow) continue
      const execution = CommitmentExecutionSchema.parse(executionRow.value)
      if (!execution.nativeRequest) continue
      const claim = await manual.claim(execution.id)
      const permit = await manual.issue(execution.id, claim.token)
      if (!permit.native) continue
      const decision = await manual.beginDispatch(execution.id, claim.token)
      if (decision.shouldDispatch) {
        const admission: NativeFollowUpAdmission = {
          requestId: execution.requestId, effectId: execution.effectId, attemptId: execution.attemptId,
          admissionKey: effect.admissionKey, fingerprint: execution.fingerprint
        }
        await deps.turns.enqueueTurn(
          { threadId: execution.nativeRequest.threadId, request: execution.nativeRequest.request },
          { nativeFollowUp: admission }
        )
      }
      // A send decision is never repeated; the outcome is reconciled instead.
      wake(later(Date.now(), RECONCILE_DELAY_MS))
    } catch {
      // Stops, busy targets and revoked permits stay pending for reconciliation.
      wake(later(Date.now(), RETRY_DELAY_MS))
    }
  }
  return { active, ...(nextWakeAt === undefined ? {} : { nextWakeAt }) }
}
