import { createHash } from 'node:crypto'
import { z } from 'zod'
import { withManagerDataMutex, type ManagerDataMutexIdentity } from './data-mutex.js'
import { CollaborationDocumentKindSchema } from '../contracts/collaboration-store.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'
import { currentManagerDataCommitId, currentManagerDataMutexContext } from './data-mutex-context.js'
import { ManagerResourceFenceSchema, ResourceFenceStaleError } from './resource-lease-state.js'
import type { ServiceManagerState } from './service-manager-state.js'

// Lock order is native thread mutation -> follow-up arbitration. Cancellation
// records intent here and touches the native thread only after releasing it.
export const FOLLOW_UP_ARBITRATION_RESOURCE = 'commitment-followup'
export const FOLLOW_UP_ARBITRATION_LEASE = `data:${createHash('sha256')
  .update(FOLLOW_UP_ARBITRATION_RESOURCE).digest('hex').slice(0, 32)}`
export const FollowUpArbitrationFenceSchema = z.object({
  fence: ManagerResourceFenceSchema, commitId: z.string().min(1).max(256)
}).strict()
export type FollowUpArbitrationFence = z.infer<typeof FollowUpArbitrationFenceSchema>

export function currentFollowUpArbitrationFence(): FollowUpArbitrationFence | undefined {
  const context = currentManagerDataMutexContext(), commitId = currentManagerDataCommitId()
  return context?.resource === FOLLOW_UP_ARBITRATION_RESOURCE && context.fence && commitId
    ? { fence: context.fence, commitId } : undefined
}

/** Includes native durable admission and local controller registration, never model/provider work. */
export function withFollowUpArbitration<T>(operation: () => Promise<T>, identity?: ManagerDataMutexIdentity): Promise<T> {
  return withManagerDataMutex(FOLLOW_UP_ARBITRATION_RESOURCE, (context) => context.withCommit(async () => {
    context.signal.throwIfAborted()
    await context.assertCurrent()
    const result = await operation()
    context.signal.throwIfAborted()
    return result
  }), identity)
}

/** Only execution/control changes use the additional reservation; ordinary chat does not. */
export function mayChangeFollowUpAdmission(input: RoomStoreCommit): boolean {
  return Boolean(input.puts?.some((put) => CollaborationDocumentKindSchema.safeParse(put.kind).success ||
    ['agent_commitment', 'workbench_link', 'task'].includes(put.kind)))
}

export async function requiresFollowUpArbitration(store: RoomStore, input: RoomStoreCommit): Promise<boolean> {
  for (const put of input.puts ?? []) {
    if (CollaborationDocumentKindSchema.safeParse(put.kind).success) return true
    if (put.kind === 'agent_commitment' && await store.get('commitment_control', put.id)) return true
  }
  return false
}

export function assertFollowUpArbitrationFence(
  state: ServiceManagerState, evidence: FollowUpArbitrationFence | undefined
): void {
  if (!evidence || evidence.fence.resource !== FOLLOW_UP_ARBITRATION_LEASE ||
    state.registration(evidence.fence.ownerFlavor)?.instanceId !== evidence.fence.ownerInstanceId) {
    throw new ResourceFenceStaleError()
  }
  state.assertResourceCommit(evidence.fence, evidence.commitId)
}

/**
 * The physical Manager writer also serializes commits. A stalled filesystem
 * write must finish before a newer owner can commit stop, even if the RPC's
 * lease expired while I/O was in flight. The persisted permit/receipt, not
 * this queue, remains the authority after Manager restart.
 */
export class ManagerFollowUpWriteArbitration {
  private tail: Promise<void> = Promise.resolve()
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation)
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }
}
