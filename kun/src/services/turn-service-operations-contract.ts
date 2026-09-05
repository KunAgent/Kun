import { createHash } from 'node:crypto'
import type { ThreadRecord, ThreadStatus } from '../contracts/threads.js'
import { StartTurnRequest as StartTurnRequestSchema } from '../contracts/turns.js'
import type {
  CompactRequest,
  CompactResponse,
  PrunePreviewRequest,
  PrunePreviewResponse,
  PruneThreadRequest,
  PruneThreadResponse,
  RestoreSnapshotResponse,
  RewindThreadResponse,
  StartTurnRequest,
  StartTurnResponse,
  SteeringEntry,
  ThreadSnapshotsResponse,
  Turn,
  GraphPlanningLifecycle,
  TurnStatus
} from '../contracts/turns.js'
import type { TurnItem, UserMessageSource } from '../contracts/items.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { ModelRequestFailureContext } from '../contracts/model-request-failure.js'
import type { RestartRecoverySource } from '../loop/restart-recovery-source.js'
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
import type { InternalTurnRuntimeContext } from '../domain/internal-turn-runtime-context.js'
import { ComposerContextAttachmentSchema } from '../contracts/composer-context.js'
import {
  goalContextInstruction,
  goalContextKey
} from '../loop/continuation-instructions.js'
import type { TurnServiceDeps, TurnConflictError, TurnCapacityError, TerminalTurnStatus, TurnSettlement, GraphLeadSuspensionResult, GraphLeadResumeResult, HOST_SHUTDOWN_TURN_SUSPENSION_CODE, hostShutdownTurnSuspensionReason, isHostShutdownTurnSuspension, DEFAULT_MAX_CONCURRENT_TURNS, fingerprintStartTurnRequest, canonicalizeFingerprintValue, isActiveTurn, terminalStatus, threadStatusFromTurns, threadStatusAfterTurnTransition, normalizeMaxConcurrentTurns, firstNonBlank, modelForManualCompaction } from './turn-service-core.js'

export interface TurnServiceOperations {
  withTurnMutationFence<T>(threadId: string, turnId: string, operation: () => T): T;
  updateRuntimeConfig(
    patch: Partial<Pick<TurnServiceDeps, 'model' | 'defaultModel' | 'contextCompaction' | 'maxConcurrentTurns'>>
  ): void;
  startTurn(input: {
    threadId: string
    request: StartTurnRequest
  }, options?: {
    /** Internal extension-broker accounting baseline; not part of StartTurnRequest. */
    extensionBudgetTokenBaseline?: number
    /** Private host-authored context; never accepted from HTTP or projected to clients. */
    runtimeContext?: InternalTurnRuntimeContext
    /** Atomically bind an automatic restart continuation to its proven failed source. */
    expectedLatestFailedTurnId?: string
    /** Runs only for a newly admitted turn, never for an idempotent replay. */
    onAdmitted?: (response: StartTurnResponse) => void | Promise<void>
  } ): Promise<StartTurnResponse>;
  /** Persist a start request as a durable queued turn for later execution. */
  enqueueTurn(input: {
    threadId: string
    request: StartTurnRequest
  }): Promise<StartTurnResponse>;
  /**
   * Promote the oldest queued turn to running after re-running full
   * admission. Returns null when execution cannot start yet (busy thread,
   * full capacity, closing, or no queued turns). Transiently unadmittable
   * queued turns are marked failed and skipped within the same call.
   */
  startNextQueuedTurn(threadId: string): Promise<{ turnId: string } | null>;
  /** Abort a queued turn before it starts; running turns must use interrupt. */
  cancelQueuedTurn(input: {
    threadId: string
    turnId: string
  }): Promise<{ threadId: string; turnId: string; status: 'aborted' }>;
  /** Reorder a queued turn relative to another queued sibling. */
  moveQueuedTurn(input: {
    threadId: string
    turnId: string
    beforeTurnId?: string
    afterTurnId?: string
  }): Promise<{ threadId: string; turnId: string; queuedPosition: number }>;
  rewindThread(input: {
    threadId: string
    turnId: string
  }): Promise<RewindThreadResponse>;
  steerTurn(input: {
    threadId: string
    turnId: string
    text: string
    displayText?: string
    messageSource?: UserMessageSource
    attachmentIds?: string[]
  }): Promise<void>;
  steeringQueue(input: { threadId: string; turnId: string }): Promise<SteeringEntry[]>;
  replaceSteering(input: {
    threadId: string
    turnId: string
    entries: readonly SteeringEntry[]
  }): Promise<SteeringEntry[]>;
  interruptTurn(input: { threadId: string; turnId: string; discard?: boolean }): Promise<{ status: TurnStatus }>;
  interruptActiveTurns(): Promise<number>;
  closeAdmissionForShutdown(): Promise<void>;
  suspendActiveTurnsForShutdown(): Promise<number>;
  reconcileManagerSettledInterruptions(input?: {
    settledAfter?: string
  }): Promise<RestartRecoverySource[]>;
  suspendTurnForHostShutdown(input: {
    threadId: string
    turnId: string
  }): Promise<void>;
  compact(input: {
    threadId: string
    turnId?: string
    request: CompactRequest
    signal?: AbortSignal
    /** Marks this compaction as automatic (memory-pressure sweep), not user-requested. */
    auto?: boolean
  }): Promise<CompactResponse>;
  pruneThread(input: {
    threadId: string
    request: PruneThreadRequest & { expectedThreadRevision?: number }
  }): Promise<PruneThreadResponse>;
  previewThreadPrune(input: {
    threadId: string
    request: PrunePreviewRequest
  }): Promise<PrunePreviewResponse>;
  listThreadSnapshots(input: {
    threadId: string
  }): Promise<ThreadSnapshotsResponse>;
  restoreThreadSnapshot(input: {
    threadId: string
    snapshotId: string
  }): Promise<RestoreSnapshotResponse>;
  finishTurn(input: {
    threadId: string
    turnId: string
    status: TerminalTurnStatus
    error?: string
    code?: string
    details?: unknown
    modelRequestFailure?: ModelRequestFailureContext
    severity?: RuntimeErrorSeverity
  }): Promise<TurnSettlement>;
  suspendGraphLeadTurn(input: {
    threadId: string
    turnId: string
    /** Host shutdown must park even when in-memory steering is pending. */
    force?: boolean
    /** Host shutdown must not acknowledge Graph events the Lead has not handled. */
    preserveDeliveryCursor?: boolean
    /** Permit parking while durable Graph review/supervision work remains pending. */
    allowPendingSupervision?: boolean
    /** Keep Manager ownership until host-shutdown suspended accounting completes. */
    releaseLease?: boolean
  }): Promise<GraphLeadSuspensionResult>;
  suspendGraphPlanningTurn(input: {
    threadId: string
    turnId: string
    /** Host shutdown must park even when in-memory steering is pending. */
    force?: boolean
    /** Keep Manager ownership until host-shutdown suspended accounting completes. */
    releaseLease?: boolean
  }): Promise<GraphLeadSuspensionResult>;
  resumeGraphPlanningTurn(input: {
    threadId: string
    turnId: string
  }): Promise<GraphLeadResumeResult>;
  graphRunOwnsLeadLimits(input: {
    threadId: string
    turnId: string
  }): Promise<boolean>;
  resumeGraphLeadTurn(input: {
    threadId: string
    turnId: string
    runId: string
    lastDeliveredSeq: number
    terminal: boolean
  }): Promise<GraphLeadResumeResult>;
  isTurnExecutionActive(turnId: string): boolean;
  getAbortController(turnId: string): AbortSignal | undefined;
  abortTurnExecution(turnId: string, reason?: unknown): boolean;
  abortThreadExecution(threadId: string): number;
  reconcileOrphanedTurns(): Promise<RestartRecoverySource[]>;
  getTurn(threadId: string, turnId: string): Promise<Turn | null>;
  ensureGoalContext(threadId: string, turnId: string, signal?: AbortSignal): Promise<void>;
  updateTurnMetadata(
    threadId: string,
    turnId: string,
    patch: Omit<Pick<
      Partial<Turn>,
      | 'activeSkillIds'
      | 'injectedMemoryIds'
      | 'injectedMemorySummaries'
      | 'skillInjectionBytes'
      | 'injectedInstructionSources'
      | 'instructionInjectionBytes'
      | 'toolCatalogFingerprint'
      | 'toolCatalogToolCount'
      | 'toolCatalogDrift'
      | 'requiredToolGate'
      | 'extensionModelRequests'
      | 'extensionToolInvocations'
      | 'workspaceCheckpointId'
      | 'actingModelRoute'
      | 'graphPlanningLifecycle'
    >, 'requiredToolGate'>
      & { requiredToolGate?: Turn['requiredToolGate'] | null }
  ): Promise<void>;
  applyItem(threadId: string, item: TurnItem): Promise<void>;
  applyAssistantDelta(
    threadId: string,
    item: TurnItem,
    deltaText: string,
    deltaOffset: number
  ): Promise<void>;
  publishTransientItem(threadId: string, item: TurnItem): Promise<void>;
  compactItemHistory(threadId: string): Promise<void>;
  updateItem(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<TurnItem | null>;
}
