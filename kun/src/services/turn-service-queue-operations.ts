import type { ThreadRecord } from '../contracts/threads.js'
import type { TurnItem } from '../contracts/items.js'
import type {
  StartTurnRequest,
  StartTurnResponse,
  Turn
} from '../contracts/turns.js'
import { makeUserItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord, finishTurn, startTurn as startTurnRecord } from '../domain/turn.js'
import { resolveThreadAgentSurface, touchThread } from '../domain/thread.js'
import { ComposerContextAttachmentSchema } from '../contracts/composer-context.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  type TurnService,
  TurnConflictError,
  TurnCapacityError,
  ThreadClosingError,
  TaskSurfaceLockedError,
  DesignProfileLockedError,
  threadStatusAfterTurnTransition,
  firstNonBlank,
  fingerprintStartTurnRequest
} from './turn-service-core.js'
import { resolveDesignTurnAdmission } from './turn-service-design-admission.js'

export const QUEUE_CANCELLED_TURN_CODE = 'queue_cancelled'
export const QUEUE_ADMISSION_FAILED_CODE = 'queue_admission_failed'
export const WRITE_CONTEXT_STALE_CODE = 'write_context_stale'
/** Backstop against unbounded per-thread queue growth. */
export const MAX_QUEUED_TURNS_PER_THREAD = 50

function queuedTurns(thread: ThreadRecord): Turn[] {
  return thread.turns.filter((turn) => turn.status === 'queued')
}

function assertQueueCapacity(thread: ThreadRecord, threadId: string): void {
  if (queuedTurns(thread).length >= MAX_QUEUED_TURNS_PER_THREAD) {
    throw new TurnConflictError(
      `queued turn limit reached (${MAX_QUEUED_TURNS_PER_THREAD}) for thread ${threadId}`
    )
  }
}

function userItemId(turnId: string): string {
  return `item_${turnId}_user`
}

function queuedResponse(thread: ThreadRecord, turn: Turn): StartTurnResponse {
  const position = queuedTurns(thread).findIndex((candidate) => candidate.id === turn.id) + 1
  return {
    threadId: thread.id,
    turnId: turn.id,
    userMessageItemId: userItemId(turn.id),
    status: 'queued',
    queuedPosition: Math.max(1, position),
    threadAgentSurface: resolveThreadAgentSurface(thread),
    ...(turn.agentSurface ? { agentSurface: turn.agentSurface } : {}),
    ...(turn.designProfile ? { designProfile: turn.designProfile } : {}),
    ...(turn.designDocumentTarget ? { designDocumentTarget: turn.designDocumentTarget } : {})
  }
}

/**
 * Per-thread durable turn queue. Queued turns are ordinary turn records with
 * status `queued`; they hold no execution lease and no global admission slot
 * until `startNextQueuedTurn` promotes the oldest one to running.
 */
export const turnServiceQueueOperations = {
  /**
   * Serialize a shared-data queue mutation across Runtime processes (Manager
   * lease when available, process-local resource queue otherwise) and across
   * this process's ThreadStore writers. Lock order is mutex -> mutation and
   * matches enqueue/promote/prune so no writer can read a stale queue snapshot.
   */
  async withQueueDataMutation<T>(this: TurnService, threadId: string, operation: () => Promise<T>): Promise<T> {
    return withManagerDataMutex(`thread:${threadId}`, () =>
      this['withThreadMutation'](threadId, operation))
  },

  /**
   * Durable queue-record write. Prefers the atomic `upsertIfRevision` port and
   * falls back to plain `upsert` for stores that do not implement it. Callers
   * must re-read the record and re-check their precondition on `applied: false`.
   */
  async commitThreadRecordCAS(
    this: TurnService,
    next: ThreadRecord,
    expectedRevision: number
  ): Promise<{ applied: boolean }> {
    const conditionalWrite = this['deps'].threadStore.upsertIfRevision
    if (!conditionalWrite) {
      await this['deps'].threadStore.upsert(next)
      return { applied: true }
    }
    const result = await conditionalWrite.call(this['deps'].threadStore, next, expectedRevision)
    return { applied: result.applied }
  },

  /**
   * Shared queue-write core. MUST run inside the caller's `withThreadMutation`
   * so the busy decision and the durable queue commit are one atomic section;
   * otherwise a turn settling in between makes the follow-up fail instead of
   * queueing. Performs Phase 1 of the two-phase admission (pending record +
   * session user item); the caller completes the commit phase.
   */
  async persistQueuedTurnRecord(this: TurnService, thread: ThreadRecord, input: {
    threadId: string
    request: StartTurnRequest
  }): Promise<{ turnId: string; userItem: TurnItem }> {
    assertQueueCapacity(thread, input.threadId)
    const turnId = this['deps'].ids.next('turn')
    const designAdmission = resolveDesignTurnAdmission({
      thread,
      request: input.request,
      turnId
    })
    const composerContexts = ComposerContextAttachmentSchema.array().parse(
      input.request.composerContexts ?? []
    )
    const attachmentIds = [...new Set(
      (input.request.attachmentIds ?? []).map((id) => id.trim()).filter(Boolean)
    )]
    if (attachmentIds.length > 0) {
      const attachmentStore = this['deps'].attachmentStore?.()
      if (!attachmentStore) throw new Error('attachment store is unavailable')
      await attachmentStore.bindScopes(attachmentIds, {
        threadId: input.threadId,
        ...(thread.workspace ? { workspace: thread.workspace } : {})
      })
    }
    const turnModel = firstNonBlank(
      input.request.model,
      thread.model,
      this['deps'].defaultModel,
      this['deps'].model?.model
    )
    const requestedProviderId = firstNonBlank(input.request.providerId)
    const threadProviderId = firstNonBlank(thread.providerId)
    const turnProviderId = requestedProviderId ?? threadProviderId ?? 'default'
    const turnAccountId = firstNonBlank(input.request.accountId) ?? (
      !requestedProviderId || requestedProviderId === threadProviderId
        ? firstNonBlank(thread.accountId)
        : undefined
    )
    const turn = createTurnRecord({
      id: turnId,
      threadId: input.threadId,
      clientRequestId: input.request.clientRequestId,
      clientRequestFingerprint: fingerprintStartTurnRequest(input.request),
      admissionPending: true,
      prompt: input.request.prompt,
      messageSource: input.request.messageSource,
      subagentResume: input.request.subagentResume,
      model: turnModel,
      providerId: turnProviderId,
      accountId: turnAccountId,
      reasoningEffort: input.request.reasoningEffort,
      serviceTier: input.request.serviceTier,
      clientSurface: input.request.clientSurface,
      approvalPolicy: input.request.approvalPolicy ?? thread.approvalPolicy,
      sandboxMode: input.request.sandboxMode ?? thread.sandboxMode,
      approvalReviewer: input.request.approvalReviewer ?? thread.approvalReviewer,
      attachmentIds,
      composerContexts,
      guiPlan: input.request.guiPlan,
      guiDesignCanvas: input.request.guiDesignCanvas,
      guiDesignMode: input.request.guiDesignMode,
      agentSurface: designAdmission.effectiveSurface,
      designProfile: designAdmission.effectiveProfile,
      designDocumentTarget: designAdmission.effectiveDocumentTarget,
      writeContext: input.request.writeContext,
      persona: input.request.persona,
      guiDesignArtifact: input.request.guiDesignArtifact,
      mode: input.request.mode,
      orchestration: input.request.orchestration,
      disableUserInput: input.request.disableUserInput,
      imContext: input.request.imContext,
      workspaceCheckpointId: input.request.workspaceCheckpointId,
      workspaceCheckpointRequestId: input.request.workspaceCheckpointRequestId
    })
    const userItem = makeUserItem({
      id: userItemId(turnId),
      turnId,
      threadId: input.threadId,
      text: input.request.prompt,
      displayText: input.request.displayText,
      messageSource: input.request.messageSource,
      attachmentIds,
      composerContexts,
      fileReferences: input.request.fileReferences ?? [],
      workspaceCheckpointId: input.request.workspaceCheckpointId,
      workspace: thread.workspace,
      threadAgentSurface: designAdmission.locksSurface && designAdmission.effectiveSurface
        ? designAdmission.effectiveSurface
        : resolveThreadAgentSurface(thread),
      agentSurface: designAdmission.effectiveSurface,
      designProfile: designAdmission.effectiveProfile,
      designDocumentTarget: designAdmission.effectiveDocumentTarget,
      designImagePlacementTarget: input.request.designImagePlacementTarget
    })
    const now = this['deps'].nowIso()
    const queuedTurn = appendTurnItem(turn, userItem)
    // Phase 1: persist the queued turn as a pending admission. Its user
    // item has not crossed the durable commit boundary yet. Use a revision
    // CAS so a non-mutex writer (or a racing Runtime) cannot be silently
    // overwritten; on conflict, re-read and re-check the queue limit.
    let current = thread
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertQueueCapacity(current, input.threadId)
      const next: ThreadRecord = {
        ...touchThread(current, now),
        status: 'running',
        turns: [...current.turns, queuedTurn],
        updatedAt: now
      }
      const committed = await this['commitThreadRecordCAS'](next, current.revision ?? 0)
      if (committed.applied) {
        // Phase 2: persist the session user item, the commit boundary.
        await this['deps'].sessionStore.appendItem(input.threadId, userItem)
        return { turnId, userItem }
      }
      const latest = await this['deps'].threadStore.get(input.threadId)
      if (!latest) throw new Error(`thread not found: ${input.threadId}`)
      current = latest
    }
    throw new TurnConflictError(
      `thread changed while the queued turn was being committed for ${input.threadId}`
    )
  },

  /**
   * Complete the two-phase queued admission after `persistQueuedTurnRecord`
   * committed its durable record: mark the admission completed, record the
   * turn_queued/item_created events, and fire the dispatcher hook. Runs the
   * same rollback as a failed enqueueTurn on error.
   */
  async completeQueuedTurnAdmission(this: TurnService, input: {
    threadId: string
    request: StartTurnRequest
    attemptedTurnId: string
    userItem: TurnItem
  }): Promise<StartTurnResponse> {
    const committedThread = await this['markTurnAdmissionCompleted'](input.threadId, input.attemptedTurnId, {})
    const committed = committedThread.turns.find((candidate) => candidate.id === input.attemptedTurnId)
    if (!committed) throw new Error(`queued turn not found after commit: ${input.attemptedTurnId}`)
    await this['deps'].events.record({
      kind: 'turn_queued',
      threadId: input.threadId,
      turnId: input.attemptedTurnId,
      text: input.request.prompt,
      ...(input.request.displayText ? { displayText: input.request.displayText } : {}),
      ...(committed.model ? { model: committed.model } : {}),
      ...(committed.providerId ? { providerId: committed.providerId } : {}),
      ...(committed.accountId ? { accountId: committed.accountId } : {}),
      ...(committed.mode ? { mode: committed.mode } : {}),
      threadAgentSurface: resolveThreadAgentSurface(committedThread),
      ...(committed.agentSurface ? { agentSurface: committed.agentSurface } : {})
    }).catch(() => undefined)
    await this['deps'].events.record({
      kind: 'item_created',
      threadId: input.threadId,
      turnId: input.attemptedTurnId,
      itemId: input.userItem.id,
      item: input.userItem
    }).catch(() => undefined)
    return queuedResponse(committedThread, committed)
  },

  /**
   * Persist a start request as a queued turn. Used when the thread already
   * has an active turn and the caller passed `enqueueIfBusy`. The durable
   * record freezes the model/provider/profile snapshot at enqueue time, and
   * its user item is appended to the session so the queued message is
   * visible to every client immediately.
   */
  async enqueueTurn(this: TurnService, input: {
    threadId: string
    request: StartTurnRequest
  }): Promise<StartTurnResponse> {
    const finishAdmission = this['beginExecutionAdmission']()
    let attemptedTurnId: string | undefined
    let admissionAccepted = false
    try {
      if (this['deps'].migrationMaintenance?.isLocked()) {
        throw new TurnConflictError('runtime migration maintenance is in progress')
      }
      // Deliberately no "no active turn" rejection here: the thread may have
      // gone idle between the busy decision and this critical section. The
      // record still commits durably; the dispatcher promotion turns it into
      // a direct start when the thread is idle.
      const started = await this['withQueueDataMutation'](input.threadId, async () => {
        if (this['deps'].lifecycleFence?.isClosing(input.threadId)) {
          throw new ThreadClosingError(input.threadId)
        }
        const thread = await this['deps'].threadStore.get(input.threadId)
        if (!thread) throw new Error(`thread not found: ${input.threadId}`)
        if (thread.status === 'archived') {
          throw new TurnConflictError(`thread is archived: ${input.threadId}`)
        }
        return this['persistQueuedTurnRecord'](thread, input)
      })
      attemptedTurnId = started.turnId
      const response = await this['completeQueuedTurnAdmission']({
        ...input,
        attemptedTurnId: started.turnId,
        userItem: started.userItem
      })
      admissionAccepted = true
      this['notifyTurnQueued'](input.threadId)
      return response
    } catch (error) {
      if (attemptedTurnId && !admissionAccepted) {
        const rolledBack = await this['rollbackPendingAdmission'](
          input.threadId,
          attemptedTurnId
        ).catch(() => false)
        if (!rolledBack) {
          await this.interruptTurn({
            threadId: input.threadId,
            turnId: attemptedTurnId
          }).catch(() => undefined)
        }
        this['clearRuntimeTurnState'](input.threadId, attemptedTurnId, { abort: true, releaseLease: false })
      }
      throw error
    } finally {
      finishAdmission()
    }
  },

  /**
   * Promote the oldest queued turn to running. Returns the promoted turn id,
   * or null when no queued turn can start right now (no queue, another turn
   * still running, capacity exhausted, or execution owned elsewhere). A
   * queued turn whose durable admission snapshot can no longer be applied
   * (surface/profile lock moved on) is failed in place and the next queued
   * candidate is tried instead.
   */
  async startNextQueuedTurn(this: TurnService, threadIdOrInput: string | {
    threadId: string
  }): Promise<{ turnId: string } | null> {
    const input = typeof threadIdOrInput === 'string' ? { threadId: threadIdOrInput } : threadIdOrInput
    const finishAdmission = this['beginExecutionAdmission']()
    try {
      return await this['withQueueDataMutation'](input.threadId, async () => {
        const failCandidateInPlace = async (
          thread: ThreadRecord,
          candidate: Turn,
          message: string,
          code: string = QUEUE_ADMISSION_FAILED_CODE
        ): Promise<void> => {
          const now = this['deps'].nowIso()
          const failedTurn = finishTurn(candidate, 'failed', now)
          const turns = thread.turns.map((turn) =>
            turn.id === candidate.id
              ? {
                  ...this['finalizeOpenItems'](failedTurn, 'failed'),
                  error: message,
                  terminalCode: code
                }
              : turn
          )
          await this['deps'].threadStore.upsert({
            ...touchThread(thread, now),
            turns,
            status: threadStatusAfterTurnTransition(thread.status, turns),
            updatedAt: now
          })
          await this['deps'].events.record({
            kind: 'turn_failed',
            threadId: input.threadId,
            turnId: candidate.id,
            message,
            code,
            severity: 'warning'
          }).catch(() => undefined)
        }
        while (true) {
          if (this['deps'].lifecycleFence?.isClosing(input.threadId)) return null
          const thread = await this['deps'].threadStore.get(input.threadId)
          if (!thread || thread.status === 'archived') return null
          if (thread.turns.some((turn) => turn.status === 'running')) return null
          if (await this['deps'].executionLeases?.owner(input.threadId)) return null
          const candidate = queuedTurns(thread)[0]
          if (!candidate) return null
          if (candidate.admissionPending) {
            // The queued admission never reached its commit boundary before
            // this promotion was reached (e.g. a manual start before restart
            // reconciliation finished). The session user item is the commit
            // boundary: commit it inline, or fail the candidate in place.
            const sessionItems = await this['deps'].sessionStore
              .loadItems(input.threadId)
              .catch(() => null)
            const hasUserItem = Boolean(
              sessionItems?.some((item) => item.turnId === candidate.id && item.kind === 'user_message')
            )
            if (!hasUserItem) {
              await failCandidateInPlace(thread, candidate, 'queued admission never crossed the durable boundary')
              continue
            }
          }
          const requestSnapshot: StartTurnRequest = {
            prompt: candidate.prompt,
            orchestration: candidate.orchestration ?? 'direct',
            attachmentIds: candidate.attachmentIds ?? [],
            composerContexts: candidate.composerContexts ?? [],
            fileReferences: [],
            ...(candidate.agentSurface ? { agentSurface: candidate.agentSurface } : {}),
            ...(candidate.designProfile ? { designProfile: candidate.designProfile } : {}),
            ...(candidate.designDocumentTarget
              ? { designDocumentTarget: candidate.designDocumentTarget }
              : {}),
            ...(candidate.writeContext ? { writeContext: candidate.writeContext } : {})
          }
          let designAdmission
          try {
            designAdmission = resolveDesignTurnAdmission({
              thread,
              request: requestSnapshot,
              turnId: candidate.id
            })
          } catch (error) {
            if (
              error instanceof TaskSurfaceLockedError ||
              error instanceof DesignProfileLockedError
            ) {
              await failCandidateInPlace(thread, candidate, error.message)
              continue
            }
            throw error
          }
          if (candidate.writeContext && this['deps'].writeDocumentGuard) {
            const staleReason = await this['deps'].writeDocumentGuard(candidate.writeContext)
            if (staleReason) {
              await failCandidateInPlace(thread, candidate, staleReason, WRITE_CONTEXT_STALE_CODE)
              continue
            }
          }
          if (!this['tryAdmitTurn'](candidate.id, input.threadId)) {
            return null
          }
          try {
            if (this['deps'].executionLeases) {
              const lease = await this['deps'].executionLeases.acquire(input.threadId, candidate.id)
              this['leasedTurns'].set(candidate.id, lease)
            }
            const now = this['deps'].nowIso()
            const startedTurn = candidate.admissionPending
              ? (() => {
                  const { admissionPending: _pending, ...committed } = startTurnRecord(candidate, now)
                  return { ...committed, admissionCompletedAt: now }
                })()
              : startTurnRecord(candidate, now)
            const next: ThreadRecord = {
              ...touchThread(thread, now),
              ...(designAdmission.locksSurface && designAdmission.effectiveSurface
                ? { agentSurface: designAdmission.effectiveSurface }
                : {}),
              ...(designAdmission.locksProfile && designAdmission.effectiveProfile
                ? { designProfile: designAdmission.effectiveProfile }
                : {}),
              status: 'running',
              turns: thread.turns.map((turn) => turn.id === candidate.id ? startedTurn : turn),
              updatedAt: now
            }
            const committed = await this['commitThreadRecordCAS'](next, thread.revision ?? 0)
            if (!committed.applied) {
              // Another writer changed the record after we read it (e.g. a
              // cross-Runtime cancel/move). Roll back the admission/lease we
              // just took and re-read from the top before deciding again.
              this['clearRuntimeTurnState'](input.threadId, candidate.id, {
                abort: true,
                releaseLease: true
              })
              continue
            }
            this['inflightTurns'].set(candidate.id, new AbortController())
            this['deps'].inflight.begin({
              id: candidate.id,
              kind: 'model',
              threadId: input.threadId,
              turnId: candidate.id
            })
            await this['deps'].events.record({
              kind: 'turn_started',
              threadId: input.threadId,
              turnId: candidate.id,
              ...(startedTurn.model ? { model: startedTurn.model } : {}),
              ...(startedTurn.providerId ? { providerId: startedTurn.providerId } : {}),
              ...(startedTurn.accountId ? { accountId: startedTurn.accountId } : {}),
              ...(startedTurn.mode ? { mode: startedTurn.mode } : {}),
              threadAgentSurface: resolveThreadAgentSurface(next),
              ...(startedTurn.agentSurface ? { agentSurface: startedTurn.agentSurface } : {}),
              ...(startedTurn.designProfile ? { designProfile: startedTurn.designProfile } : {}),
              ...(startedTurn.designDocumentTarget
                ? { designDocumentTarget: startedTurn.designDocumentTarget }
                : {})
            }).catch(() => undefined)
            return { turnId: candidate.id }
          } catch (error) {
            this['clearRuntimeTurnState'](input.threadId, candidate.id, {
              abort: true,
              releaseLease: true
            })
            throw error
          }
        }
      })
    } finally {
      finishAdmission()
    }
  },

  /**
   * Cancel a queued turn. Returns true when the queued turn was aborted.
   * A turn that already left the queue (running or terminal) returns false
   * so the caller can fall back to interrupt semantics.
   */
  async cancelQueuedTurn(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<{ threadId: string; turnId: string; status: 'aborted' }> {
    return this['withQueueDataMutation'](input.threadId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const thread = await this['deps'].threadStore.get(input.threadId)
        if (!thread) throw new Error(`thread not found: ${input.threadId}`)
        const turn = thread.turns.find((candidate) => candidate.id === input.turnId)
        if (!turn) throw new Error(`turn not found: ${input.turnId}`)
        if (turn.status !== 'queued') {
          throw new TurnConflictError(`turn is not queued: ${input.turnId}`)
        }
        const now = this['deps'].nowIso()
        const abortedTurn = this['finalizeOpenItems'](finishTurn(turn, 'aborted', now), 'aborted')
        const turns = thread.turns.map((candidate) =>
          candidate.id === input.turnId
            ? { ...abortedTurn, terminalCode: QUEUE_CANCELLED_TURN_CODE }
            : candidate
        )
        const next: ThreadRecord = {
          ...touchThread(thread, now),
          turns,
          status: threadStatusAfterTurnTransition(thread.status, turns),
          updatedAt: now
        }
        const committed = await this['commitThreadRecordCAS'](next, thread.revision ?? 0)
        if (committed.applied) {
          await this['deps'].events.record({
            kind: 'turn_aborted',
            threadId: input.threadId,
            turnId: input.turnId,
            code: QUEUE_CANCELLED_TURN_CODE
          }).catch(() => undefined)
          return { threadId: input.threadId, turnId: input.turnId, status: 'aborted' }
        }
      }
      throw new TurnConflictError(
        `thread changed while the queued turn was being cancelled for ${input.threadId}`
      )
    })
  },

  /**
   * Reorder a queued turn relative to a queued sibling. Only queued turns
   * may move; terminal/running records keep their history order. Requires
   * exactly one of `beforeTurnId`/`afterTurnId`, and that target must not be
   * the moving turn itself (self-reference would otherwise reorder the turn
   * into an unintended position).
   */
  async moveQueuedTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    beforeTurnId?: string
    afterTurnId?: string
  }): Promise<{ threadId: string; turnId: string; queuedPosition: number }> {
    if (Boolean(input.beforeTurnId) === Boolean(input.afterTurnId)) {
      throw new Error('exactly one of beforeTurnId or afterTurnId is required')
    }
    const targetId = input.beforeTurnId ?? input.afterTurnId!
    if (targetId === input.turnId) {
      throw new TurnConflictError(`queue position target cannot be the moving turn: ${input.turnId}`)
    }
    return this['withQueueDataMutation'](input.threadId, async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const thread = await this['deps'].threadStore.get(input.threadId)
        if (!thread) throw new Error(`thread not found: ${input.threadId}`)
        const moving = thread.turns.find((candidate) => candidate.id === input.turnId)
        if (!moving) throw new Error(`turn not found: ${input.turnId}`)
        if (moving.status !== 'queued') {
          throw new TurnConflictError(`turn is not queued: ${input.turnId}`)
        }
        const target = thread.turns.find((candidate) => candidate.id === targetId)
        if (!target) throw new Error(`turn not found: ${targetId}`)
        if (target.status !== 'queued') {
          throw new TurnConflictError(`queue position target is not queued: ${targetId}`)
        }
        const remaining = thread.turns.filter((candidate) => candidate.id !== moving.id)
        const targetIndex = remaining.findIndex((candidate) => candidate.id === target.id)
        if (targetIndex < 0) {
          throw new Error(`queue position target missing after filter: ${targetId}`)
        }
        const insertionIndex = input.beforeTurnId ? targetIndex : targetIndex + 1
        const turns = [
          ...remaining.slice(0, insertionIndex),
          moving,
          ...remaining.slice(insertionIndex)
        ]
        const queuedPosition =
          turns.filter((turn) => turn.status === 'queued')
            .findIndex((turn) => turn.id === moving.id) + 1
        if (turns.every((turn, index) => turn === thread.turns[index])) {
          return { threadId: input.threadId, turnId: moving.id, queuedPosition }
        }
        const now = this['deps'].nowIso()
        const next: ThreadRecord = {
          ...touchThread(thread, now),
          turns,
          updatedAt: now
        }
        const committed = await this['commitThreadRecordCAS'](next, thread.revision ?? 0)
        if (committed.applied) {
          return { threadId: input.threadId, turnId: moving.id, queuedPosition }
        }
      }
      throw new TurnConflictError(
        `thread changed while the queue reorder was being committed for ${input.threadId}`
      )
    })
  }
}
