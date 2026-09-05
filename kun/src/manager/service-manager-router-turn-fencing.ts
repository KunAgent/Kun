import type { z } from 'zod'
import type { ServiceManagerState } from './service-manager-state.js'
import {
  ManagerDataRequestEnvelopeSchema,
  isSessionMutation,
  isThreadMutation,
  mutationThreadId,
  type ManagerSessionStoreOperation,
  type ManagerThreadStoreOperation
} from './shared-data-store-contracts.js'
import { fenceMatchesMutationValue } from './turn-mutation-context.js'
import { StaleTurnFenceError } from './service-manager-state.js'

type ManagerDataRequestEnvelope = z.infer<typeof ManagerDataRequestEnvelopeSchema>

export function guardManagerDataTurnFence(
  state: ServiceManagerState,
  store: 'thread' | 'session',
  operation: string,
  envelope: ManagerDataRequestEnvelope
): (() => void) | undefined {
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
    throw new StaleTurnFenceError()
  }
  const assertCurrent = envelope.turnFence
    ? () => state.assertTurnMutationFence(envelope.turnFence!)
    : undefined
  assertCurrent?.()
  return assertCurrent
}
