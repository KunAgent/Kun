import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import { NativeFollowUpAdmissionSchema } from '../contracts/native-followup-requests.js'
import { FollowUpArbitrationFenceSchema } from './followup-arbitration-contracts.js'

export const NativeFollowUpWriteScopeSchema = z.object({
  admission: NativeFollowUpAdmissionSchema, stage: z.enum(['enqueue', 'promote']),
  claimToken: z.number().int().nonnegative(), arbitration: FollowUpArbitrationFenceSchema
}).strict()
export type NativeFollowUpWriteScope = z.infer<typeof NativeFollowUpWriteScopeSchema>
const writes = new AsyncLocalStorage<NativeFollowUpWriteScope>()

/** Host dispatch scope is ephemeral; it never changes the stable request identity. */
export function withNativeFollowUpWriteScope<T>(scope: NativeFollowUpWriteScope, operation: () => Promise<T>): Promise<T> {
  return writes.run(NativeFollowUpWriteScopeSchema.parse(scope), operation)
}
export const currentNativeFollowUpWriteScope = (): NativeFollowUpWriteScope | undefined => writes.getStore()

export class NativeFollowUpPermitError extends Error {
  readonly code = 'native_followup_permit_required'
  constructor(message = 'native follow-up admission is not authorized') { super(message) }
}
