import type { z } from 'zod'
import type { ServiceManagerState } from './service-manager-state.js'
import {
  ManagerDataRequestEnvelopeSchema,
  isSessionMutation,
  isThreadMutation,
  mutationThreadId,
  mutationTurnId,
  type ManagerSessionStoreOperation,
  type ManagerThreadStoreOperation
} from './shared-data-store-contracts.js'
import { fenceMatchesMutationValue } from './turn-mutation-context.js'
import { StaleTurnFenceError } from './service-manager-state.js'

type ManagerDataRequestEnvelope = z.infer<typeof ManagerDataRequestEnvelopeSchema>

export async function guardManagerDataTurnFence(
  state: ServiceManagerState,
  store: 'thread' | 'session',
  operation: string,
  envelope: ManagerDataRequestEnvelope,
  readThread: (threadId: string) => Promise<unknown>
): Promise<(() => void) | undefined> {
  const mutationTarget = mutationThreadId(envelope.value)
  const mutation = store === 'thread'
    ? isThreadMutation(operation as ManagerThreadStoreOperation)
    : operation === 'allocateEventSeq' ||
      isSessionMutation(operation as ManagerSessionStoreOperation)
  if (mutation && mutationTarget &&
    state.requiresTurnMutationFence(mutationTarget) && !envelope.turnFence) {
    throw new StaleTurnFenceError()
  }
  if (envelope.turnFence && !fenceMatchesMutationValue(envelope.turnFence, envelope.value)) {
    if (!(await isQueuedTurnAdmission(readThread, envelope))) {
      throw new StaleTurnFenceError()
    }
  }
  const assertCurrent = envelope.turnFence
    ? () => state.assertTurnMutationFence(envelope.turnFence!)
    : undefined
  assertCurrent?.()
  return assertCurrent
}

/**
 * Queue admission writes a queued turn's items and events under the current
 * thread owner's fence: the queued turn has no lease of its own yet, and the
 * owner's fence is still validated against the live lease below. Any other
 * cross-turn write (for example a settled turn's usage record) stays stale.
 */
async function isQueuedTurnAdmission(
  readThread: (threadId: string) => Promise<unknown>,
  envelope: ManagerDataRequestEnvelope
): Promise<boolean> {
  const turnId = mutationTurnId(envelope.value)
  const threadId = mutationThreadId(envelope.value)
  if (!turnId || !threadId || !envelope.turnFence) return false
  if (envelope.turnFence.threadId !== threadId) return false
  const thread = await readThread(threadId).catch(() => null)
  const row = (thread as { turns?: Array<{ id?: unknown; status?: unknown }> } | null)
    ?.turns?.find((candidate) => candidate.id === turnId)
  return row?.status === 'queued'
}
