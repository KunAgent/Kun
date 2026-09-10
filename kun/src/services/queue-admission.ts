import type { StartTurnRequest, StartTurnResponse } from '../contracts/turns.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { TurnConflictError, ThreadClosingError, fingerprintStartTurnRequest, type TurnService } from './turn-service-core.js'
import { queuedResponse } from './turn-service-queue-operations.js'

export class QueueAdmissionUncertainError extends Error {
  readonly code = 'queue_admission_uncertain'
  constructor(readonly clientRequestId: string | undefined, readonly stage: string, cause: unknown) {
    super('Queue admission could not be confirmed. Retry with the same clientRequestId.', { cause })
    this.name = 'QueueAdmissionUncertainError'
  }
}

/** Used online and on restart; an incomplete admission is never an executed failure. */
export async function reconcilePendingQueueAdmission(
  service: TurnService, threadId: string, turnId: string
): Promise<void> {
  await withManagerDataMutex(`thread:${threadId}`, async () => {
    const thread = await service['deps'].threadStore.get(threadId)
    const turn = thread?.turns.find((row) => row.id === turnId)
    if (!turn || turn.status !== 'queued' || !turn.admissionPending) return
    const items = await service['deps'].sessionStore.loadItems(threadId)
    if (items.some((item) => item.turnId === turnId && item.kind === 'user_message')) {
      await service['markTurnAdmissionCompleted'](threadId, turnId, {})
    } else if (!await service['rollbackPendingAdmission'](threadId, turnId)) {
      throw new QueueAdmissionUncertainError(turn.clientRequestId, 'rollback', undefined)
    }
  })
}

export async function reconcilePendingQueueAdmissions(service: TurnService, threadId: string): Promise<void> {
  await withManagerDataMutex(`thread:${threadId}`, async () => {
    const thread = await service['deps'].threadStore.get(threadId)
    for (const turn of thread?.turns ?? []) {
      if (turn.status === 'queued' && turn.admissionPending) {
        await reconcilePendingQueueAdmission(service, threadId, turn.id)
      }
    }
  })
}

/** One serialized admission, including idempotent recovery, commit and rollback. */
export async function enqueueTurnDurably(service: TurnService, input: {
  threadId: string; request: StartTurnRequest
}): Promise<StartTurnResponse> {
  return withManagerDataMutex(`thread:${input.threadId}`, async () => {
    let attemptedTurnId: string | undefined
    let stage = 'prepare'
    try {
      const existing = (await service['deps'].threadStore.get(input.threadId))?.turns
        .find((turn) => input.request.clientRequestId && turn.clientRequestId === input.request.clientRequestId)
      const fingerprint = fingerprintStartTurnRequest(input.request)
      if (existing?.clientRequestFingerprint && existing.clientRequestFingerprint !== fingerprint) {
        throw new TurnConflictError('clientRequestId is already associated with a different request')
      }
      if (existing?.status === 'queued' && existing.admissionPending) {
        stage = 'recover'
        await reconcilePendingQueueAdmission(service, input.threadId, existing.id)
      }
      const started = await service['withThreadMutation'](input.threadId, async () => {
        if (service['deps'].lifecycleFence?.isClosing(input.threadId)) throw new ThreadClosingError(input.threadId)
        const thread = await service['deps'].threadStore.get(input.threadId)
        if (!thread) throw new Error(`thread not found: ${input.threadId}`)
        if (thread.status === 'archived') throw new TurnConflictError(`thread is archived: ${input.threadId}`)
        const replay = service['idempotentStartFromThread'](thread, input.request, fingerprint)
        if (replay) {
          const turn = thread.turns.find((row) => row.id === replay.turnId)!
          return { response: turn.status === 'queued' ? queuedResponse(thread, turn) : replay }
        }
        attemptedTurnId = service['deps'].ids.next('turn')
        stage = 'persist'
        return { pending: await service['persistQueuedTurnRecord'](thread, input, attemptedTurnId) }
      })
      if (started.response) return started.response
      stage = 'commit'
      return await service['completeQueuedTurnAdmission']({
        ...input, attemptedTurnId: started.pending!.turnId, userItem: started.pending!.userItem
      })
    } catch (error) {
      if (attemptedTurnId) {
        // A response may have been lost after the marker committed. Observe
        // that exact admission before rolling back or attempting it again.
        const observed = await service['deps'].threadStore.get(input.threadId).catch(() => null)
        const turn = observed?.turns.find((row) => row.id === attemptedTurnId)
        if (observed && turn?.admissionCompletedAt && !turn.admissionPending) {
          return turn.status === 'queued' ? queuedResponse(observed, turn)
            : service['idempotentStartFromTurn'](turn, input.request, fingerprintStartTurnRequest(input.request))!
        }
        await service['rollbackPendingAdmission'](input.threadId, attemptedTurnId).catch(() => false)
      }
      if (error instanceof TurnConflictError || error instanceof ThreadClosingError) throw error
      console.warn(`[kun] queue admission failed thread=${input.threadId} stage=${stage}:`, error)
      throw new QueueAdmissionUncertainError(input.request.clientRequestId, stage, error)
    }
  })
}
