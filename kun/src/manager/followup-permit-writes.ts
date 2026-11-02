import { isDeepStrictEqual } from 'node:util'
import { CommitmentEffectSchema, CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import { CollaborationEventSchema } from '../contracts/collaboration-events.js'
import type { FollowUpEnvelope } from '../contracts/collaboration-followup.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

/** Generic RoomStore RPC cannot mint native permits or explicit user-action authority. */
export async function assertNoNativePermitMint(store: RoomStore, input: RoomStoreCommit): Promise<void> {
  const manualEvent = async (id: string, requestId?: string): Promise<boolean> => {
    const row = await store.get('collaboration_event', id)
    if (!row) return false
    const event = CollaborationEventSchema.parse(row.value)
    return Boolean(event.userAction && (!requestId || event.userAction.actionId === requestId))
  }
  const manualEnvelope = async (envelope: FollowUpEnvelope): Promise<boolean> =>
    envelope.eventIds.length === 1 && await manualEvent(envelope.eventIds[0], envelope.requestId)

  for (const put of input.puts ?? []) {
    if (put.kind === 'collaboration_event') {
      if (CollaborationEventSchema.parse(put.value).userAction) {
        throw new NativeFollowUpPermitError('explicit user-action evidence may only be issued by Manager')
      }
      continue
    }
    if (put.kind === 'commitment_effect') {
      const next = CommitmentEffectSchema.parse(put.value)
      if (await manualEnvelope(next.envelope)) {
        const old = await store.get('commitment_effect', put.id)
        const prior = old && CommitmentEffectSchema.parse(old.value)
        if (!prior || prior.status !== next.status || !isDeepStrictEqual(prior.claim, next.claim) ||
          !isDeepStrictEqual(prior.receipt, next.receipt)) {
          throw new NativeFollowUpPermitError('manual claims and receipts may only be written by Manager')
        }
      }
      continue
    }
    if (put.kind !== 'commitment_execution') continue
    const next = CommitmentExecutionSchema.parse(put.value)
    const old = await store.get('commitment_execution', put.id)
    const prior = old && CommitmentExecutionSchema.parse(old.value)
    if (await manualEnvelope(next.envelope) && (!prior || prior.phase !== next.phase ||
      !isDeepStrictEqual(prior.dispatch, next.dispatch) || !isDeepStrictEqual(prior.receipt, next.receipt))) {
      throw new NativeFollowUpPermitError('manual dispatch intent and execution receipts may only be written by Manager')
    }
    if (next.permit?.native && (!prior?.permit?.native || !isDeepStrictEqual(prior.permit.native, next.permit.native))) {
      throw new NativeFollowUpPermitError('native permits may only be issued by Manager admission')
    }
  }
}
