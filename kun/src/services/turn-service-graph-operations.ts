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
import {
  goalContextInstruction,
  goalContextKey
} from '../loop/continuation-instructions.js'
import { type TurnService, type TurnServiceDeps, TurnConflictError, TurnCapacityError, type TerminalTurnStatus, type TurnSettlement, type GraphLeadSuspensionResult, type GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction } from './turn-service-core.js'

export const turnServiceGraphOperations = {
/**
   * Park a Graph source Lead between material events. The durable turn stays
   * running, but its process-local execution lease and capacity slot are
   * released. The per-thread mutation lock makes the empty-steering check
   * race-safe with steerTurn.
   */
async suspendGraphLeadTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    /** Host shutdown must park even when in-memory steering is pending. */
    force?: boolean
    /** Host shutdown must not acknowledge Graph events the Lead has not handled. */
    preserveDeliveryCursor?: boolean
    /** Permit parking while durable Graph review/supervision work remains pending. */
    allowPendingSupervision?: boolean
    /** Host shutdown retains ownership until AgentLoop finishes suspended accounting. */
    releaseLease?: boolean
  }): Promise<GraphLeadSuspensionResult> {
    const turn = await this.getTurn(input.threadId, input.turnId)
    if (!turn || turn.status !== 'running' || turn.orchestration !== 'graph') return 'not_graph'
    const attached = await this['deps'].resolveGraphLeadRun?.(input)
    if (!attached) return this.suspendGraphPlanningTurn(input)
    if (attached.terminal) return 'graph_terminal'
    const planningLifecycle = await this['deps'].resolveGraphPlanningDraft?.({
      threadId: input.threadId,
      sourceTurnId: input.turnId
    })

    return this['withThreadMutation'](input.threadId, async () => {
      const current = await this['deps'].threadStore.get(input.threadId)
      const latest = current?.turns.find((candidate) => candidate.id === input.turnId)
      if (!current || !latest || latest.status !== 'running' || latest.orchestration !== 'graph') {
        return 'not_graph'
      }
      if (
        input.force !== true &&
        (
          this['hasGraphSteeringResume'](input.turnId) ||
          this['deps'].steering.peek(input.turnId).length > 0
        )
      ) return 'pending_steering'
      if (attached.supervisionPending && input.allowPendingSupervision !== true) {
        return 'supervision_pending'
      }

      const now = this['deps'].nowIso()
      const graphLeadLifecycle = {
        version: 1 as const,
        runId: attached.runId,
        state: 'supervising' as const,
        // Delivery is acknowledged when a bounded Lead episode starts from a
        // specific GraphRun snapshot. Never jump to the latest sequence while
        // parking: events written during the episode must remain redeliverable.
        lastDeliveredSeq: latest.graphLeadLifecycle?.lastDeliveredSeq ?? 0,
        suspendedAt: now,
        ...(latest.graphLeadLifecycle?.resumedAt
          ? { resumedAt: latest.graphLeadLifecycle.resumedAt }
          : {})
      }
      await this['deps'].threadStore.upsert({
        ...current,
        turns: current.turns.map((candidate) =>
          candidate.id === input.turnId
            ? {
                ...candidate,
                graphLeadLifecycle,
                ...(planningLifecycle
                  ? { graphPlanningLifecycle: planningLifecycle }
                  : {})
              }
            : candidate),
        updatedAt: now
      })
      this['releaseRuntimeTurnExecution'](input.threadId, input.turnId, {
        releaseLease: input.releaseLease
      })
      return attached.supervisionPending
        ? 'suspended_pending_supervision'
        : 'suspended'
    })
  },

async suspendGraphPlanningTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    /** Host shutdown must park even when in-memory steering is pending. */
    force?: boolean
    /** Host shutdown retains ownership until AgentLoop finishes suspended accounting. */
    releaseLease?: boolean
  }): Promise<GraphLeadSuspensionResult> {
    let lifecycle = await this['deps'].transitionGraphPlanningDraft?.({
      threadId: input.threadId,
      sourceTurnId: input.turnId,
      action: 'suspend'
    })
    if (!lifecycle && this['deps'].createGraphPlanningDraft) {
      const thread = await this['deps'].threadStore.get(input.threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === input.turnId)
      if (thread && turn?.orchestration === 'graph') {
        await this['deps'].createGraphPlanningDraft({
          threadId: input.threadId,
          sourceTurnId: input.turnId,
          goal: turn.prompt,
          workspace: thread.workspace
        })
        lifecycle = await this['deps'].transitionGraphPlanningDraft?.({
          threadId: input.threadId,
          sourceTurnId: input.turnId,
          action: 'suspend'
        })
      }
    }
    if (!lifecycle) return 'not_graph'
    if (
      lifecycle.state === 'committed' ||
      lifecycle.state === 'cancelled' ||
      lifecycle.state === 'host_error'
    ) return 'graph_terminal'
    return this['withThreadMutation'](input.threadId, async () => {
      const current = await this['deps'].threadStore.get(input.threadId)
      const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
      if (!current || !turn || turn.status !== 'running') return 'not_graph'
      if (
        input.force !== true &&
        (
          this['hasGraphSteeringResume'](input.turnId) ||
          this['deps'].steering.peek(input.turnId).length > 0
        )
      ) return 'pending_steering'
      await this['deps'].threadStore.upsert({
        ...current,
        turns: current.turns.map((candidate) =>
          candidate.id === input.turnId
            ? {
                ...candidate,
                graphPlanningLifecycle: lifecycle,
                requiredToolGate: undefined
              }
            : candidate),
        updatedAt: this['deps'].nowIso()
      })
      this['releaseRuntimeTurnExecution'](input.threadId, input.turnId, {
        releaseLease: input.releaseLease
      })
      return 'suspended'
    })
  },

async resumeGraphPlanningTurn(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<GraphLeadResumeResult> {
    const finishAdmission = this['beginExecutionAdmission']()
    try {
      return await this['withThreadMutation'](input.threadId, async () => {
      const current = await this['deps'].threadStore.get(input.threadId)
      const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
      let correctionRestored = false
      const restoreCorrection = async (): Promise<void> => {
        if (correctionRestored) return
        correctionRestored = true
        let lifecycle: GraphPlanningLifecycle | null | undefined
        try {
          lifecycle = await this['deps'].transitionGraphPlanningDraft?.({
            threadId: input.threadId,
            sourceTurnId: input.turnId,
            action: 'suspend'
          })
          if (
            current &&
            turn?.status === 'running' &&
            turn.orchestration === 'graph' &&
            lifecycle?.state === 'needs_correction'
          ) {
            await this['deps'].threadStore.upsert({
              ...current,
              turns: current.turns.map((candidate) =>
                candidate.id === input.turnId
                  ? {
                      ...candidate,
                      graphPlanningLifecycle: lifecycle ?? undefined,
                      requiredToolGate: undefined
                    }
                  : candidate),
              updatedAt: this['deps'].nowIso()
            })
          }
        } finally {
          this['releaseRuntimeTurnExecution'](input.threadId, input.turnId)
        }
      }

      try {
        if (!current || !turn) throw new Error(`turn not found: ${input.turnId}`)
        if (turn.status !== 'running' || turn.orchestration !== 'graph') {
          throw new TurnConflictError(`Graph source turn is not active: ${input.turnId}`)
        }
        if (this['inflightTurns'].has(input.turnId)) return 'already_running'
        if (!this['tryAdmitTurn'](input.turnId, input.threadId)) {
          throw new TurnCapacityError(this['maxConcurrentTurns'])
        }
        if (this['deps'].executionLeases) {
          const lease = await this['deps'].executionLeases.acquire(input.threadId, input.turnId)
          this['leasedTurns'].set(input.turnId, lease)
        }
        const lifecycle = await this['deps'].transitionGraphPlanningDraft?.({
          threadId: input.threadId,
          sourceTurnId: input.turnId,
          action: 'resume'
        })
        if (!lifecycle || lifecycle.state !== 'planning') {
          throw new TurnConflictError(`Graph planning draft is not resumable: ${input.turnId}`)
        }
        const controller = new AbortController()
        this['inflightTurns'].set(input.turnId, controller)
        this['deps'].inflight.begin({
          id: input.turnId,
          kind: 'model',
          threadId: input.threadId,
          turnId: input.turnId
        })
        this['deps'].steering.reopen(input.turnId)
        await this['deps'].threadStore.upsert({
          ...current,
          turns: current.turns.map((candidate) =>
            candidate.id === input.turnId
              ? { ...candidate, graphPlanningLifecycle: lifecycle }
              : candidate),
          updatedAt: this['deps'].nowIso()
        })
        return 'resumed'
      } catch (error) {
        // Keep the compensating transition inside the same thread mutation
        // fence. A concurrent steering retry cannot acquire a fresh lease and
        // then be suspended by this older failed resume.
        await restoreCorrection()
        throw error
      }
      })
    } finally {
      finishAdmission()
    }
  },

/**
   * Return true only while this exact durable source turn owns a nonterminal
   * GraphRun. AgentLoop uses this at ordinary direct-turn limit boundaries so
   * a live Graph is governed by its own ledger without granting an unlimited
   * pre-creation or post-terminal turn.
   */
async graphRunOwnsLeadLimits(this: TurnService, input: {
    threadId: string
    turnId: string
  }): Promise<boolean> {
    const turn = await this.getTurn(input.threadId, input.turnId)
    if (!turn || turn.status !== 'running' || turn.orchestration !== 'graph') return false
    const attached = await this['deps'].resolveGraphLeadRun?.(input)
    return attached?.terminal === false
  },

/**
   * Reacquire a process-local execution lease for an already-running Graph
   * source turn. Duplicate wake-ups share the active execution instead of
   * admitting a second model loop.
   */
async resumeGraphLeadTurn(this: TurnService, input: {
    threadId: string
    turnId: string
    runId: string
    lastDeliveredSeq: number
    terminal: boolean
  }): Promise<GraphLeadResumeResult> {
    const finishAdmission = this['beginExecutionAdmission']()
    try {
      const planningLifecycle = await this['deps'].resolveGraphPlanningDraft?.({
        threadId: input.threadId,
        sourceTurnId: input.turnId
      })
      return await this['withThreadMutation'](input.threadId, async () => {
      const current = await this['deps'].threadStore.get(input.threadId)
      const turn = current?.turns.find((candidate) => candidate.id === input.turnId)
      if (!current || !turn) throw new Error(`turn not found: ${input.turnId}`)
      if (turn.status !== 'running' || turn.orchestration !== 'graph') {
        throw new TurnConflictError(`Graph source turn is not active: ${input.turnId}`)
      }
      if (
        turn.graphLeadLifecycle?.runId &&
        turn.graphLeadLifecycle.runId !== input.runId
      ) {
        throw new TurnConflictError(
          `Graph source turn ${input.turnId} already owns ${turn.graphLeadLifecycle.runId}`
        )
      }
      if (this['inflightTurns'].has(input.turnId)) {
        const now = this['deps'].nowIso()
        await this['deps'].threadStore.upsert({
          ...current,
          turns: current.turns.map((candidate) =>
            candidate.id === input.turnId
              ? {
                  ...candidate,
                  graphLeadLifecycle: {
                    version: 1 as const,
                    runId: input.runId,
                    state: input.terminal ? 'finalizing' as const : 'supervising' as const,
                    lastDeliveredSeq: Math.max(
                      candidate.graphLeadLifecycle?.lastDeliveredSeq ?? 0,
                      input.lastDeliveredSeq
                    ),
                    resumedAt: now,
                    ...(candidate.graphLeadLifecycle?.suspendedAt
                      ? { suspendedAt: candidate.graphLeadLifecycle.suspendedAt }
                      : {})
                  },
                  ...(planningLifecycle
                    ? { graphPlanningLifecycle: planningLifecycle }
                    : {})
                }
              : candidate),
          updatedAt: now
        })
        return 'already_running'
      }
      if (!this['tryAdmitTurn'](input.turnId, input.threadId)) {
        throw new TurnCapacityError(this['maxConcurrentTurns'])
      }
      try {
        if (this['deps'].executionLeases) {
          const lease = await this['deps'].executionLeases.acquire(input.threadId, input.turnId)
          this['leasedTurns'].set(input.turnId, lease)
        }
        const now = this['deps'].nowIso()
        const controller = new AbortController()
        this['inflightTurns'].set(input.turnId, controller)
        this['deps'].inflight.begin({
          id: input.turnId,
          kind: 'model',
          threadId: input.threadId,
          turnId: input.turnId
        })
        this['deps'].steering.reopen(input.turnId)
        await this['deps'].threadStore.upsert({
          ...current,
          turns: current.turns.map((candidate) =>
            candidate.id === input.turnId
              ? {
                  ...candidate,
                  graphLeadLifecycle: {
                    version: 1 as const,
                    runId: input.runId,
                    state: input.terminal ? 'finalizing' as const : 'supervising' as const,
                    lastDeliveredSeq: Math.max(
                      candidate.graphLeadLifecycle?.lastDeliveredSeq ?? 0,
                      input.lastDeliveredSeq
                    ),
                    resumedAt: now,
                    ...(candidate.graphLeadLifecycle?.suspendedAt
                      ? { suspendedAt: candidate.graphLeadLifecycle.suspendedAt }
                      : {})
                  },
                  ...(planningLifecycle
                    ? { graphPlanningLifecycle: planningLifecycle }
                    : {})
                }
              : candidate),
          updatedAt: now
        })
        return 'resumed'
      } catch (error) {
        this['releaseRuntimeTurnExecution'](input.threadId, input.turnId)
        throw error
      }
      })
    } finally {
      finishAdmission()
    }
  },
}
