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
import { touchThread } from '../domain/thread.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { UsageService } from './usage-service.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { rewriteItemHistoryWithRetry } from './history-commit-coordinator.js'
import { withThreadStoreMutation } from './thread-mutation-coordinator.js'
import type { ThreadLifecycleFence } from './thread-lifecycle-fence.js'
import { ThreadItemProjectionService } from './thread-item-projection.js'
import { ComposerContextAttachmentSchema } from '../contracts/composer-context.js'
import { validateAndBindImageSteeringAttachments } from '../loop/turn-steering-attachments.js'
import {
  goalContextInstruction,
  goalContextKey
} from '../loop/continuation-instructions.js'
import { type TurnService, type TurnServiceDeps, TurnConflictError, TurnCapacityError, type TerminalTurnStatus, type TurnSettlement, type GraphLeadSuspensionResult, type GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction } from './turn-service-core.js'

export const turnServiceSteeringOperations = {
async steerTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    text: string
    displayText?: string
    messageSource?: UserMessageSource
    attachmentIds?: string[]
  }): Promise<void> {
    const finishAdmission = this['beginExecutionAdmission']()
    try {
    const requestedAttachmentIds = (input.attachmentIds ?? []).map((id) => id.trim())
    let acceptedAttachmentIds: string[] = []
    let holdsGraphResumeFence = false
    try {
      for (;;) {
        const action = await this['withThreadMutation'](input.threadId, async () => {
          const current = await this['deps'].threadStore.get(input.threadId)
          const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
          if (!turn) throw new Error(`turn not found: ${input.turnId}`)
          if (turn.status !== 'running') {
            throw new TurnConflictError(`turn is not active: ${input.turnId}`)
          }
          if (!this['inflightTurns'].has(input.turnId)) {
            if (turn.orchestration !== 'graph') {
              throw new TurnConflictError(`turn is not active: ${input.turnId}`)
            }
            if (!holdsGraphResumeFence) {
              this['beginGraphSteeringResume'](input.turnId)
              holdsGraphResumeFence = true
            }
            return 'resume_graph' as const
          }
          let attachmentIds: string[] = []
          try {
            attachmentIds = await validateAndBindImageSteeringAttachments({
              attachmentIds: input.attachmentIds ?? [],
              turn,
              steeringEntries: [
                { attachmentIds: this['deps'].steering.drainedAttachmentIds(input.turnId) },
                ...this['deps'].steering.peek(input.turnId),
                { attachmentIds: requestedAttachmentIds }
              ],
              attachmentStore: this['deps'].attachmentStore?.(),
              threadId: input.threadId,
              workspace: current?.workspace
            })
          } catch (error) {
            throw new TurnConflictError(
              error instanceof Error ? error.message : 'invalid steering attachments'
            )
          }
          acceptedAttachmentIds = attachmentIds
          const accepted = this['deps'].steering.enqueue(input.turnId, {
            text: input.text,
            ...(input.displayText ? { displayText: input.displayText } : {}),
            ...(input.messageSource ? { messageSource: input.messageSource } : {}),
            ...(attachmentIds.length ? { attachmentIds } : {})
          })
          if (!accepted) {
            if (this['deps'].steering.isSealed(input.turnId)) {
              throw new TurnConflictError(`turn is no longer accepting steering: ${input.turnId}`)
            }
            throw new TurnConflictError(
              `steering queue capacity reached for active turn: ${input.turnId}`
            )
          }
          return 'accepted' as const
        })
        if (action === 'accepted') break
        await this['resumeGraphTurnForSteering']({
          threadId: input.threadId,
          turnId: input.turnId
        })
      }
    } finally {
      if (holdsGraphResumeFence) {
        this['endGraphSteeringResume'](input.turnId)
      }
    }
    await this['deps'].events.record({
      kind: 'turn_steered',
      threadId: input.threadId,
      turnId: input.turnId,
      text: input.text,
      ...(input.displayText ? { displayText: input.displayText } : {}),
      ...(input.messageSource ? { messageSource: input.messageSource } : {}),
      ...(acceptedAttachmentIds.length ? { attachmentIds: acceptedAttachmentIds } : {})
    })
    } finally {
      finishAdmission()
    }
  },

async resumeGraphTurnForSteering(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<void> {
    const attached = await this['deps'].resolveGraphLeadRun?.(input)
    if (attached) {
      await this.resumeGraphLeadTurn({
        ...input,
        runId: attached.runId,
        lastDeliveredSeq: attached.lastEventSeq,
        terminal: attached.terminal
      })
      return
    }
    const durablePlanning = await this['deps'].resolveGraphPlanningDraft?.({
      threadId: input.threadId,
      sourceTurnId: input.turnId
    })
    const lifecycle = durablePlanning ??
      (await this.getTurn(input.threadId, input.turnId))?.graphPlanningLifecycle
    if (
      lifecycle?.state === 'planning' ||
      lifecycle?.state === 'repairing' ||
      lifecycle?.state === 'needs_correction'
    ) {
      await this.resumeGraphPlanningTurn(input)
      return
    }
    throw new TurnConflictError(`Graph source turn is not resumable: ${input.turnId}`)
  },

beginGraphSteeringResume(this: TurnService, turnId: string): void {
    this['graphSteeringResumeFences'].set(
      turnId,
      (this['graphSteeringResumeFences'].get(turnId) ?? 0) + 1
    )
  },

endGraphSteeringResume(this: TurnService, turnId: string): void {
    const remaining = (this['graphSteeringResumeFences'].get(turnId) ?? 0) - 1
    if (remaining > 0) this['graphSteeringResumeFences'].set(turnId, remaining)
    else this['graphSteeringResumeFences'].delete(turnId)
  },

hasGraphSteeringResume(this: TurnService, turnId: string): boolean {
    return (this['graphSteeringResumeFences'].get(turnId) ?? 0) > 0
  },

async steeringQueue(this: TurnService, input: { threadId: string; turnId: string }): Promise<SteeringEntry[]> {
    const current = await this['deps'].threadStore.get(input.threadId)
    const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
    if (!turn) throw new Error(`turn not found: ${input.turnId}`)
    return this['deps'].steering.peek(input.turnId)
  },

async replaceSteering(this: TurnService, input: {
    threadId: string
    turnId: string
    entries: readonly SteeringEntry[]
  }): Promise<SteeringEntry[]> {
    let entries: SteeringEntry[] = []
    await this['withThreadMutation'](input.threadId, async () => {
      const current = await this['deps'].threadStore.get(input.threadId)
      const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
      if (!turn) throw new Error(`turn not found: ${input.turnId}`)
      if (turn.status !== 'running' || !this['inflightTurns'].has(input.turnId)) {
        throw new TurnConflictError(`turn is not active: ${input.turnId}`)
      }
      const replacementAttachmentIds = [...new Set(
        input.entries.flatMap((entry) => entry.attachmentIds ?? [])
      )]
      try {
        await validateAndBindImageSteeringAttachments({
          attachmentIds: replacementAttachmentIds,
          turn,
          steeringEntries: [
            { attachmentIds: this['deps'].steering.drainedAttachmentIds(input.turnId) },
            ...input.entries
          ],
          attachmentStore: this['deps'].attachmentStore?.(),
          threadId: input.threadId,
          workspace: current?.workspace
        })
      } catch (error) {
        throw new TurnConflictError(
          error instanceof Error ? error.message : 'invalid steering attachments'
        )
      }
      if (!this['deps'].steering.replace(input.turnId, input.entries)) {
        throw new TurnConflictError(`turn is no longer accepting steering or the replacement exceeds its capacity: ${input.turnId}`)
      }
      entries = this['deps'].steering.peek(input.turnId)
    })
    await this['deps'].events.record({
      kind: 'turn_steering_updated',
      threadId: input.threadId,
      turnId: input.turnId,
      entries
    })
    return entries
  },

async interruptTurn(this: TurnService, input: { threadId: string; turnId: string; discard?: boolean }): Promise<{ status: TurnStatus }> {
    let transition: boolean
    try {
      transition = await this['withThreadMutation'](input.threadId, async () => {
        const current = await this['deps'].threadStore.get(input.threadId)
        if (!current) throw new Error(`thread not found: ${input.threadId}`)
        const turn = current.turns.find((candidate) => candidate.id === input.turnId)
        if (!turn) throw new Error(`turn not found: ${input.turnId}`)
        if (!isActiveTurn(turn)) {
          throw new TurnConflictError(`turn is not active: ${input.turnId}`)
        }
        if (turn.orchestration === 'graph') {
          // Keep this inside the thread mutation fence. A racing AgentLoop
          // settlement cannot overtake explicit Stop while Graph cancellation
          // is being made durable.
          // Cancel the pre-run draft first. If graph_define_plan is between
          // creating its paused run and committing the draft, its CAS will then
          // lose and clean up that run. Listing/cancelling runs second closes the
          // opposite ordering where commit won first.
          await this['deps'].transitionGraphPlanningDraft?.({
            threadId: input.threadId,
            sourceTurnId: input.turnId,
            action: 'cancel'
          })
          await this['deps'].cancelGraphSourceRuns?.({
            threadId: input.threadId,
            sourceTurnId: input.turnId
          })
        }
        const turns = current.turns.map((candidate) =>
          candidate.id === input.turnId
            ? this['finalizeOpenItems'](
                finishTurn(input.discard ? { ...candidate, items: this['keepUserItems'](candidate.items) } : candidate, 'aborted'),
                'aborted'
              )
            : candidate
        )
        await this['deps'].threadStore.upsert({
          ...touchThread(current, this['deps'].nowIso()),
          turns,
          status: threadStatusAfterTurnTransition(current.status, turns),
          updatedAt: this['deps'].nowIso()
        })
        return true
      })
    } catch (error) {
      // If persistence is unavailable, the caller still asked to interrupt
      // execution. Abort and free its admission slot; restart reconciliation
      // can settle the durable running record later.
      this['clearRuntimeTurnState'](input.threadId, input.turnId, { abort: true })
      throw error
    }
    if (!transition) return { status: 'aborted' }

    // Wake the local loop before publishing the terminal event. Event
    // persistence may be queued behind the in-flight operation being aborted.
    this.abortTurnExecution(input.turnId)
    try {
      await this['deps'].events.record({
        kind: 'turn_aborted',
        threadId: input.threadId,
        turnId: input.turnId
      })
      if (input.discard) {
        await this['discardTurnItems'](input.threadId, input.turnId)
      } else {
        await this['finalizePersistedOpenItems'](input.threadId, input.turnId, 'aborted')
      }
      return { status: 'aborted' }
    } finally {
      this['clearRuntimeTurnState'](input.threadId, input.turnId, { abort: true })
    }
  },

/** Abort every in-process turn before runtime shutdown closes its stores. */
async interruptActiveTurns(this: TurnService): Promise<number> {
    const active = this['deps'].inflight.list()
      .filter((record) => record.kind === 'model' && Boolean(record.turnId))
      .map((record) => ({ threadId: record.threadId, turnId: record.turnId! }))
    const settled = await Promise.allSettled(
      active.map(({ threadId, turnId }) => this.interruptTurn({ threadId, turnId }))
    )
    return settled.filter((result) => result.status === 'fulfilled').length
  },

  /**
   * Stop process-local work for shutdown without turning a durable turn into a
   * user cancellation. Direct turns remain running so restart reconciliation
   * can create a checkpoint and resume them; Graph turns retain their durable
   * planning/supervision lifecycle.
   */
async suspendActiveTurnsForShutdown(this: TurnService): Promise<number> {
    const active = this['deps'].inflight.list()
      .filter((record) => record.kind === 'model' && Boolean(record.turnId))
      .map((record) => ({ threadId: record.threadId, turnId: record.turnId! }))
    const settled = await Promise.allSettled(
      active.map((input) => this.suspendTurnForHostShutdown(input))
    )
    const errors = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )
    if (errors.length > 0) {
      throw new AggregateError(errors, 'one or more active turns could not be suspended')
    }
    return settled.length
  },

async suspendTurnForHostShutdown(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<void> {
    const turn = await this.getTurn(input.threadId, input.turnId)
    if (turn?.status !== 'running') return
    const controller = this['inflightTurns'].get(input.turnId)
    controller?.abort(hostShutdownTurnSuspensionReason())
    try {
      if (turn.orchestration !== 'graph') return
      const attached = await this['deps'].resolveGraphLeadRun?.(input)
      if (attached) {
        await this.suspendGraphLeadTurn({
          ...input,
          force: true,
          preserveDeliveryCursor: true,
          allowPendingSupervision: true,
          releaseLease: false
        })
      } else {
        // A planning draft is not invalid merely because its host exits.
        // Preserve the exact draft state and only record that execution
        // was parked; user-driven suspension may still request correction.
        const lifecycle =
          await this['deps'].resolveGraphPlanningDraft?.({
            threadId: input.threadId,
            sourceTurnId: input.turnId
          }) ??
          turn.graphPlanningLifecycle
        if (lifecycle) {
          await this.updateTurnMetadata(input.threadId, input.turnId, {
            graphPlanningLifecycle: {
              ...lifecycle,
              suspendedAt: this['deps'].nowIso()
            }
          })
        }
      }
    } finally {
      // Keep the Manager fence valid until AgentLoop's suspended-finally path
      // persists its reliable goal elapsed slice. Runtime shutdown drains the
      // retained lease after every active run has had a chance to unwind.
      this['releaseRuntimeTurnExecution'](input.threadId, input.turnId, {
        releaseLease: false
      })
    }
  },
}
