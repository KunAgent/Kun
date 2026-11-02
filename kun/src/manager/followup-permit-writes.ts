import { isDeepStrictEqual } from 'node:util'
import { CommitmentExecutionSchema } from '../contracts/collaboration-effects.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'
import { NativeFollowUpPermitError } from './native-followup-write-scope.js'

/** Generic RoomStore RPC cannot mint the native authority the receiver trusts. */
export async function assertNoNativePermitMint(store: RoomStore, input: RoomStoreCommit): Promise<void> {
  for (const put of input.puts ?? []) {
    if (put.kind !== 'commitment_execution') continue
    const next = CommitmentExecutionSchema.parse(put.value)
    if (!next.permit?.native) continue
    const old = await store.get('commitment_execution', put.id)
    const prior = old && CommitmentExecutionSchema.parse(old.value)
    if (!prior?.permit?.native || !isDeepStrictEqual(prior.permit.native, next.permit.native)) {
      throw new NativeFollowUpPermitError('native permits may only be issued by Manager admission')
    }
  }
}
