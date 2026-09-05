import { createHash } from 'node:crypto'
import type { ThreadRecord, ThreadStatus } from '../contracts/threads.js'
import { StartTurnRequest as StartTurnRequestSchema } from '../contracts/turns.js'
import type {
  CompactRequest,
  CompactResponse,
  RewindThreadResponse,
  StartTurnRequest,
  StartTurnResponse,
  SteeringEntry,
  Turn,
  GraphPlanningLifecycle,
  TurnStatus
} from '../contracts/turns.js'
import type { TurnItem, UserMessageSource } from '../contracts/items.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { MigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import {
  ThreadExecutionBusyError,
  type ThreadExecutionLeasePort
} from '../ports/thread-execution-lease.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { InflightTracker } from '../loop/inflight-tracker.js'
import type { SteeringQueue } from '../loop/steering-queue.js'
import { ContextCompactor, extractSkillPins } from '../loop/context-compactor.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory
} from '../loop/compaction-history.js'
import {
  resolveCoherentProviderAccount,
  resolveCompactionModel,
  summarizeCompactionWithModel
} from '../loop/compaction-summary.js'
import type { ContextCompactionConfig } from '../loop/model-context-profile.js'
import { reserveExtensionModelRequest } from '../loop/turn-budget-gate.js'
import { makeGoalContextItem, makeUserItem, makeErrorItem } from '../domain/item.js'
import { appendTurnItem, createTurnRecord, finishTurn, replaceTurnItem, startTurn as startTurnRecord } from '../domain/turn.js'
import { finalizeTurnItems } from '../domain/turn-item-finalization.js'
import { resolveThreadAgentSurface, touchThread } from '../domain/thread.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { UsageService } from './usage-service.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { rewriteItemHistoryWithRetry } from './history-commit-coordinator.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import type { ThreadLifecycleFence } from './thread-lifecycle-fence.js'
import { ThreadItemProjectionService } from './thread-item-projection.js'
import { ComposerContextAttachmentSchema } from '../contracts/composer-context.js'
import {
  goalContextInstruction,
  goalContextKey
} from '../loop/continuation-instructions.js'
import { type TurnService, type TurnServiceDeps, TurnConflictError, TurnInProgressError, ThreadClosingError, TurnCapacityError, type TerminalTurnStatus, type TurnSettlement, type GraphLeadSuspensionResult, type GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction, isPendingQueuedAdmission } from './turn-service-core.js'
import { resolveDesignTurnAdmission } from './turn-service-design-admission.js'
import {
  InternalTurnRuntimeContext,
  makeInternalTurnRuntimeContextSource
} from '../domain/internal-turn-runtime-context.js'

export const turnServiceAdmissionOperations = {
updateRuntimeConfig(this: TurnService,
    patch: Partial<Pick<TurnServiceDeps, 'model' | 'defaultModel' | 'contextCompaction' | 'maxConcurrentTurns'>>
  ): void {
    this['deps'] = {
      ...this['deps'],
      ...patch
    }
    if ('maxConcurrentTurns' in patch) {
      this['maxConcurrentTurns'] = normalizeMaxConcurrentTurns(patch.maxConcurrentTurns)
    }
  },

async startTurn(this: TurnService, input: {
    threadId: string
    request: StartTurnRequest
  }, options: {
    /** Internal extension-broker accounting baseline; not part of StartTurnRequest. */
    extensionBudgetTokenBaseline?: number
    /** Private host-authored context; never accepted from HTTP or projected to clients. */
    runtimeContext?: import('../domain/internal-turn-runtime-context.js').InternalTurnRuntimeContext
    /** Atomically bind an automatic restart continuation to its proven failed source. */
    expectedLatestFailedTurnId?: string
    /** Runs only for a newly admitted turn, never for an idempotent replay. */
    onAdmitted?: (response: StartTurnResponse) => void | Promise<void>
  } = {}): Promise<StartTurnResponse> {
    const runtimeContext = options.runtimeContext
      ? InternalTurnRuntimeContext.parse(options.runtimeContext)
      : undefined
    const requestFingerprint = fingerprintStartTurnRequest(input.request)
    const replay = options.expectedLatestFailedTurnId
      ? null
      : await this['findIdempotentStart'](input, requestFingerprint)
    if (replay) return replay
    if (
      !options.expectedLatestFailedTurnId &&
      input.request.enqueueIfBusy === true &&
      await this['deps'].executionLeases?.owner(input.threadId)
    ) {
      return this.enqueueTurn(input)
    }
    const finishAdmission = this['beginExecutionAdmission']()
    try {
    if (this['deps'].migrationMaintenance?.isLocked()) {
      throw new TurnConflictError('runtime migration maintenance is in progress')
    }
    const currentOwner = await this['deps'].executionLeases?.owner(input.threadId)
    if (currentOwner) throw new ThreadExecutionBusyError(currentOwner)
    let attemptedTurnId: string | undefined
    let admissionAccepted = false
    try {
      const started = await withManagerDataMutex(`thread:${input.threadId}`, () =>
        this['withThreadMutation'](input.threadId, async () => {
        if (this['deps'].lifecycleFence?.isClosing(input.threadId)) {
          throw new ThreadClosingError(input.threadId)
        }
        const thread = await this['deps'].threadStore.get(input.threadId)
        if (!thread) throw new Error(`thread not found: ${input.threadId}`)
        if (thread.turns.some((turn) => turn.status === 'running')) {
          if (
            !options.expectedLatestFailedTurnId &&
            input.request.enqueueIfBusy === true
          ) {
            // Busy decision and durable queue commit share this critical
            // section: a turn settling right after the check must not make
            // the follow-up fail — it queues and the dispatcher promotes it
            // (a direct start when the thread is already idle by then).
            try {
              const queuedStart = await this['persistQueuedTurnRecord'](thread, input)
              return { kind: 'queued' as const, start: queuedStart }
            } catch (error) {
              // Phase 1 failed (limit, append failure, ...): surface the
              // half-written record so the rollback below (outside the
              // mutation lock) mirrors enqueueTurn's rollback.
              const halfWritten = await this['deps'].threadStore.get(input.threadId)
              const pendingTurn = halfWritten?.turns.find((turn) => turn.admissionPending === true)
              return {
                kind: 'enqueueFailed' as const,
                error,
                pendingTurnId: pendingTurn?.id
              }
            }
          }
        }
        if (options.expectedLatestFailedTurnId) {
          const latest = thread.turns.at(-1)
          if (
            latest?.id !== options.expectedLatestFailedTurnId ||
            latest.status !== 'failed'
          ) {
            throw new TurnConflictError(
              `restart recovery source is no longer latest: ${options.expectedLatestFailedTurnId}`
            )
          }
        }
        const replay = this['idempotentStartFromThread'](thread, input.request, requestFingerprint)
        if (replay) return { kind: 'replay' as const, response: replay }
        // Archival is an overlay on the execution-derived thread state. It
        // deliberately permits an already-running turn to settle, but it
        // must not admit a new one while the thread remains archived.
        if (thread.status === 'archived') {
          throw new TurnConflictError(`thread is archived: ${input.threadId}`)
        }
        if (thread.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')) {
          throw new TurnConflictError(`thread already has an active turn: ${input.threadId}`)
        }
        // Allocate only an in-memory id before admission. A rejected request
        // still has no turn record, item, or event to persist.
        const turnId = this['deps'].ids.next('turn')
        const designAdmission = resolveDesignTurnAdmission({
          thread,
          request: input.request,
          turnId
        })
        if (!this['tryAdmitTurn'](turnId, input.threadId)) {
          throw new TurnCapacityError(this['maxConcurrentTurns'])
        }
        attemptedTurnId = turnId
        try {
          if (this['deps'].executionLeases) {
            const lease = await this['deps'].executionLeases.acquire(input.threadId, turnId)
            this['leasedTurns'].set(turnId, lease)
          }
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
          const approvalPolicy = input.request.approvalPolicy ?? thread.approvalPolicy
          const sandboxMode = input.request.sandboxMode ?? thread.sandboxMode
          const approvalReviewer = input.request.approvalReviewer ?? thread.approvalReviewer
          const graphPlanningLifecycle =
            input.request.orchestration === 'graph' && this['deps'].createGraphPlanningDraft
              ? await this['deps'].createGraphPlanningDraft({
                  threadId: input.threadId,
                  sourceTurnId: turnId,
                  goal: input.request.prompt,
                  workspace: thread.workspace
                })
              : undefined
          // Snapshot the effective selection at admission. Some clients omit
          // fields that merely inherit the thread. Without this copy a model
          // picker change could mutate `thread.model` between tool steps and
          // silently move an already-running turn onto a different protocol.
          const turnModel = firstNonBlank(
            input.request.model,
            thread.model,
            this['deps'].defaultModel,
            this['deps'].model?.model
          )
          const requestedProviderId = firstNonBlank(input.request.providerId)
          const threadProviderId = firstNonBlank(thread.providerId)
          // `undefined` means "consult the current thread/default" to older
          // consumers. Persist the default alias explicitly so a selection
          // change after admission cannot move this already-running turn.
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
            clientRequestFingerprint: requestFingerprint,
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
            approvalPolicy,
            sandboxMode,
            approvalReviewer,
            attachmentIds,
            composerContexts,
            guiPlan: input.request.guiPlan,
            guiDesignCanvas: input.request.guiDesignCanvas,
            guiDesignMode: input.request.guiDesignMode,
            agentSurface: designAdmission.effectiveSurface,
            designProfile: designAdmission.effectiveProfile,
            designDocumentTarget: designAdmission.effectiveDocumentTarget,
            persona: input.request.persona,
            guiDesignArtifact: input.request.guiDesignArtifact,
            mode: input.request.mode,
            orchestration: input.request.orchestration,
            graphPlanningLifecycle,
            disableUserInput: input.request.disableUserInput,
            imContext: input.request.imContext,
            workspaceCheckpointId: input.request.workspaceCheckpointId,
            workspaceCheckpointRequestId: input.request.workspaceCheckpointRequestId,
            ...(options.extensionBudgetTokenBaseline !== undefined
              ? { extensionBudgetTokenBaseline: options.extensionBudgetTokenBaseline }
              : {})
          })
          const userItem = makeUserItem({
            id: `item_${turnId}_user`,
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
          const controller = new AbortController()
          const startedTurn = startTurnRecord(appendTurnItem(turn, userItem))
          const pendingThreadSurface = designAdmission.locksSurface
            ? undefined
            : thread.agentSurface
          const next = {
            ...touchThread(thread, this['deps'].nowIso()),
            status: 'running' as const,
            ...(pendingThreadSurface ? { agentSurface: pendingThreadSurface } : {}),
            turns: [...thread.turns, startedTurn]
          }
          await this['deps'].threadStore.upsert({ ...next, updatedAt: this['deps'].nowIso() })
          if (runtimeContext) {
            await this['deps'].sessionStore.appendItem(input.threadId, makeInternalTurnRuntimeContextSource({
              threadId: input.threadId,
              turnId,
              context: runtimeContext,
              createdAt: this['deps'].nowIso()
            }))
          }
          await this['deps'].sessionStore.appendItem(input.threadId, userItem)
          this['inflightTurns'].set(turnId, controller)
          this['deps'].inflight.begin({ id: turnId, kind: 'model', threadId: input.threadId, turnId })
          return {
            kind: 'admitted' as const,
            turnId,
            userItem,
            turn: startedTurn,
            designAdmission,
            pendingThreadSurface
          }
        } catch (error) {
          // A failed start has no loop to perform lifecycle cleanup. Release
          // its slot immediately; the outer catch best-effort marks any
          // already-persisted turn aborted so it cannot strand the thread.
          this['clearRuntimeTurnState'](input.threadId, turnId, {
            abort: true,
            releaseLease: false
          })
          throw error
        }
      })
      )
      if (started.kind === 'replay') return started.response
      if (started.kind === 'enqueueFailed') {
        // Phase 1 of the atomic queue write failed; roll the half-written
        // pending record back exactly like a failed enqueueTurn.
        if (started.pendingTurnId) {
          const rolledBack = await this['rollbackPendingAdmission'](
            input.threadId,
            started.pendingTurnId
          ).catch(() => false)
          if (!rolledBack) {
            await this.interruptTurn({
              threadId: input.threadId,
              turnId: started.pendingTurnId
            }).catch(() => undefined)
          }
          this['clearRuntimeTurnState'](input.threadId, started.pendingTurnId, {
            abort: true,
            releaseLease: false
          })
        }
        throw started.error
      }
      if (started.kind === 'queued') {
        // Phase 1 is durable inside the same critical section as the busy
        // decision. Complete the admission here (rollback on failure), then
        // wake the dispatcher so promotion — or a direct start on an idle
        // thread — can begin.
        let queuedResponseResult: StartTurnResponse
        try {
          queuedResponseResult = await this['completeQueuedTurnAdmission']({
            ...input,
            attemptedTurnId: started.start.turnId,
            userItem: started.start.userItem
          })
        } catch (error) {
          const rolledBack = await this['rollbackPendingAdmission'](
            input.threadId,
            started.start.turnId
          ).catch(() => false)
          if (!rolledBack) {
            await this.interruptTurn({
              threadId: input.threadId,
              turnId: started.start.turnId
            }).catch(() => undefined)
          }
          this['clearRuntimeTurnState'](input.threadId, started.start.turnId, {
            abort: true,
            releaseLease: false
          })
          throw error
        }
        this['notifyTurnQueued'](input.threadId)
        return queuedResponseResult
      }
      const committedThread = await this['markTurnAdmissionCompleted'](
        input.threadId,
        started.turnId,
        {
          ...(started.designAdmission.locksSurface && started.designAdmission.effectiveSurface
            ? { agentSurface: started.designAdmission.effectiveSurface }
            : started.pendingThreadSurface
              ? { agentSurface: started.pendingThreadSurface }
            : {}),
          ...(started.designAdmission.locksProfile && started.designAdmission.effectiveProfile
            ? { designProfile: started.designAdmission.effectiveProfile }
            : {}),
          ...(input.request.approvalPolicy !== undefined
            ? { approvalPolicy: input.request.approvalPolicy }
            : {}),
          ...(input.request.sandboxMode !== undefined
            ? { sandboxMode: input.request.sandboxMode }
            : {}),
          ...(input.request.approvalReviewer !== undefined
            ? { approvalReviewer: input.request.approvalReviewer }
            : {})
        }
      )
      admissionAccepted = true
      const committedTurn = committedThread.turns.find((turn) => turn.id === started.turnId)
      if (!committedTurn) throw new Error(`turn not found after admission commit: ${started.turnId}`)
      const threadAgentSurface = resolveThreadAgentSurface(committedThread)
      await this['deps'].events.record({
        kind: 'turn_started',
        threadId: input.threadId,
        turnId: started.turnId,
        ...(committedTurn.model ? { model: committedTurn.model } : {}),
        ...(committedTurn.providerId ? { providerId: committedTurn.providerId } : {}),
        ...(committedTurn.accountId ? { accountId: committedTurn.accountId } : {}),
        ...(input.request.reasoningEffort ? { reasoningEffort: input.request.reasoningEffort } : {}),
        ...(input.request.serviceTier ? { serviceTier: input.request.serviceTier } : {}),
        ...(committedTurn.clientSurface ? { clientSurface: committedTurn.clientSurface } : {}),
        ...(committedTurn.approvalPolicy ? { approvalPolicy: committedTurn.approvalPolicy } : {}),
        ...(committedTurn.sandboxMode ? { sandboxMode: committedTurn.sandboxMode } : {}),
        ...(committedTurn.approvalReviewer ? { approvalReviewer: committedTurn.approvalReviewer } : {}),
        ...(committedTurn.mode ? { mode: committedTurn.mode } : {}),
        threadAgentSurface,
        ...(committedTurn.agentSurface ? { agentSurface: committedTurn.agentSurface } : {}),
        ...(committedTurn.designProfile ? { designProfile: committedTurn.designProfile } : {}),
        ...(committedTurn.designDocumentTarget
          ? { designDocumentTarget: committedTurn.designDocumentTarget }
          : {})
      }).catch((error) => {
        console.warn(
          `[kun] turn_started event persistence failed after admission commit for ${started.turnId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
        )
      })
      await this['deps'].events.record({
        kind: 'item_created',
        threadId: input.threadId,
        turnId: started.turnId,
        itemId: started.userItem.id,
        item: started.userItem
      }).catch((error) => {
        console.warn(
          `[kun] user item event persistence failed after admission commit for ${started.turnId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
        )
      })
      const response = {
        threadId: input.threadId,
        turnId: started.turnId,
        userMessageItemId: started.userItem.id,
        threadAgentSurface,
        ...(committedTurn.agentSurface ? { agentSurface: committedTurn.agentSurface } : {}),
        ...(committedTurn.designProfile ? { designProfile: committedTurn.designProfile } : {}),
        ...(committedTurn.designDocumentTarget
          ? { designDocumentTarget: committedTurn.designDocumentTarget }
          : {})
      }
      try {
        await options.onAdmitted?.(response)
      } catch (error) {
        console.warn(
          `[kun] turn dispatch callback failed after admission commit for ${started.turnId}: ` +
          `${error instanceof Error ? error.message : String(error)}`
        )
        await this.finishTurn({
          threadId: input.threadId,
          turnId: started.turnId,
          status: 'failed',
          error: 'The accepted turn could not be dispatched for execution.',
          code: 'turn_dispatch_failed',
          severity: 'error'
        }).catch(() => undefined)
      }
      return response
    } catch (error) {
      if (attemptedTurnId && !admissionAccepted) {
        const rolledBack = await this['rollbackPendingAdmission'](
          input.threadId,
          attemptedTurnId
        ).catch(() => false)
        if (!rolledBack) {
          // Fall back to a terminal pending marker. Idempotency and first-Design
          // resolution deliberately ignore this marker so a retry can proceed.
          await this.interruptTurn({
            threadId: input.threadId,
            turnId: attemptedTurnId
          }).catch(() => undefined)
        }
        this['clearRuntimeTurnState'](input.threadId, attemptedTurnId, { abort: true })
      }
      throw error
    }
    } finally {
      finishAdmission()
    }
  },

async findIdempotentStart(this: TurnService, input: {
    threadId: string
    request: StartTurnRequest
  }, requestFingerprint: string | undefined): Promise<StartTurnResponse | null> {
    const clientRequestId = input.request.clientRequestId?.trim()
    if (!clientRequestId) return null
    const projection = this['deps'].threadStore.getMetadata
      ? await this['deps'].threadStore.getMetadata(input.threadId)
      : await this['deps'].threadStore.get(input.threadId)
    const projectedTurn = projection?.turns.find((turn) =>
      turn.clientRequestId === clientRequestId && !this['isRetryableFailedAdmission'](turn) && !isPendingQueuedAdmission(turn)
    )
    if (!projectedTurn) return null
    if (projectedTurn.prompt) {
      return this['idempotentStartFromTurn'](
        projectedTurn,
        input.request,
        requestFingerprint,
        projection ? resolveThreadAgentSurface(projection) : undefined
      )
    }
    const hydrated = await this['deps'].threadStore.get(input.threadId)
    const turn = hydrated?.turns.find((candidate) =>
      candidate.clientRequestId === clientRequestId && !this['isRetryableFailedAdmission'](candidate) && !isPendingQueuedAdmission(candidate)
    )
    return turn
      ? this['idempotentStartFromTurn'](
          turn,
          input.request,
          requestFingerprint,
          hydrated ? resolveThreadAgentSurface(hydrated) : undefined
        )
      : null
  },

idempotentStartFromThread(this: TurnService,
    thread: ThreadRecord,
    request: StartTurnRequest,
    requestFingerprint: string | undefined
  ): StartTurnResponse | null {
    const clientRequestId = request.clientRequestId?.trim()
    if (!clientRequestId) return null
    const turn = thread.turns.find((candidate) =>
      candidate.clientRequestId === clientRequestId && !this['isRetryableFailedAdmission'](candidate) && !isPendingQueuedAdmission(candidate)
    )
    return turn
      ? this['idempotentStartFromTurn'](
          turn,
          request,
          requestFingerprint,
          resolveThreadAgentSurface(thread)
        )
      : null
  },

isRetryableFailedAdmission(this: TurnService, turn: Turn): boolean {
    return !turn.admissionCompletedAt && (turn.status === 'aborted' || turn.status === 'failed')
  },

idempotentStartFromTurn(this: TurnService,
    turn: Turn,
    request: StartTurnRequest,
    requestFingerprint: string | undefined,
    threadAgentSurface?: ThreadRecord['agentSurface']
  ): StartTurnResponse | null {
    const userItem = turn.items.find((item) => item.kind === 'user_message')
    const originalPrompt = userItem?.text || turn.prompt
    // A different runtime may observe the metadata write in the narrow window
    // before the canonical user item is durable. Treat that as not yet
    // admitted so the execution lease remains authoritative for the retry.
    if (!originalPrompt) return null
    if (turn.clientRequestFingerprint) {
      if (turn.clientRequestFingerprint !== requestFingerprint) {
        throw new TurnConflictError('clientRequestId is already associated with a different request')
      }
    } else if (originalPrompt !== request.prompt) {
      throw new TurnConflictError('clientRequestId is already associated with a different prompt')
    }
    return {
      threadId: turn.threadId,
      turnId: turn.id,
      userMessageItemId: userItem?.id ?? `item_${turn.id}_user`,
      ...(threadAgentSurface ? { threadAgentSurface } : {}),
      ...(turn.agentSurface ? { agentSurface: turn.agentSurface } : {}),
      ...(turn.designProfile ? { designProfile: turn.designProfile } : {}),
      ...(turn.designDocumentTarget ? { designDocumentTarget: turn.designDocumentTarget } : {})
    }
  },

async rewindThread(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<RewindThreadResponse> {
    return this['withThreadMutation'](input.threadId, async () => {
      const thread = await this['deps'].threadStore.get(input.threadId)
      if (!thread) throw new Error(`thread not found: ${input.threadId}`)
      // `archived` is an overlay, so checking the thread marker alone lets a
      // caller rewrite history while a turn is still queued/running. The turn
      // records are the source of truth for execution state.
      if (thread.turns.some(isActiveTurn)) {
        throw new TurnInProgressError(`cannot rewind while a turn is active: ${input.threadId}`)
      }
      const targetIndex = thread.turns.findIndex((turn) => turn.id === input.turnId)
      if (targetIndex < 0) throw new Error(`turn not found: ${input.turnId}`)

      const keptTurns = thread.turns.slice(0, targetIndex)
      const keptTurnIds = new Set(keptTurns.map((turn) => turn.id))
      const history = await rewriteItemHistoryWithRetry({
        sessionStore: this['deps'].sessionStore,
        threadId: input.threadId,
        maxAttempts: 3,
        build: (snapshot) => {
          const keptItems = snapshot.items.filter((item) => keptTurnIds.has(item.turnId))
          return {
            changed: keptItems.length !== snapshot.items.length,
            items: keptItems,
            value: undefined
          }
        }
      })
      if (history.status === 'closed') {
        throw new ThreadClosingError(input.threadId)
      }
      if (history.status === 'conflict') {
        throw new TurnConflictError(`history changed while rewinding: ${input.threadId}`)
      }
      const now = this['deps'].nowIso()
      await this['deps'].threadStore.upsert({
        ...touchThread(thread, now),
        // Rewind must not implicitly unarchive a completed conversation.
        status: thread.status === 'archived' ? 'archived' : 'idle',
        turns: keptTurns,
        updatedAt: now
      })
      return {
        threadId: input.threadId,
        turnId: input.turnId,
        removedTurns: thread.turns.length - targetIndex,
        remainingTurns: keptTurns.length
      }
    })
  },
}
