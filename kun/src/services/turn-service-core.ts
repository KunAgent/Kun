import { createHash } from 'node:crypto'
import type { ThreadAgentSurface, ThreadRecord, ThreadStatus } from '../contracts/threads.js'
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
import { installServiceOperations } from './service-operation-install.js'
import { turnServiceAdmissionOperations } from './turn-service-admission-operations.js'
import { turnServiceSteeringOperations } from './turn-service-steering-operations.js'
import { turnServiceCompactionOperations } from './turn-service-compaction-operations.js'
import { turnServiceGraphOperations } from './turn-service-graph-operations.js'
import { turnServiceRuntimeStateOperations } from './turn-service-runtime-state-operations.js'
import { turnServiceItemPersistenceOperations } from './turn-service-item-persistence-operations.js'
import type { TurnServiceOperations } from './turn-service-operations-contract.js'

export type TurnServiceDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  model?: ModelClient
  usage?: UsageService
  prefix?: ImmutablePrefix
  attachmentStore?: () => AttachmentStore | undefined
  defaultModel?: string
  contextCompaction?: ContextCompactionConfig
  /** Maximum number of active turns this in-process runtime may admit. */
  maxConcurrentTurns?: number
  /** Reject turn admission while this thread is being destructively removed. */
  lifecycleFence?: ThreadLifecycleFence
  migrationMaintenance?: MigrationMaintenanceLock
  /** Cross-runtime ownership fence supplied by the stable Service Manager. */
  executionLeases?: ThreadExecutionLeasePort
  /** Dispose machine-local continuation state after a successful manual compaction. */
  onCompacted?: (threadId: string) => Promise<void>
  /** Resolve durable Graph ownership without coupling TurnService to the Graph store. */
  resolveGraphLeadRun?: (input: {
    threadId: string
    turnId: string
  }) => Promise<{
    runId: string
    lastEventSeq: number
    terminal: boolean
    supervisionPending?: boolean
  } | null>
  createGraphPlanningDraft?: (input: {
    threadId: string
    sourceTurnId: string
    goal: string
    workspace?: string
  }) => Promise<GraphPlanningLifecycle>
  /** Resolve the latest durable draft so stale turn metadata can self-heal after restart. */
  resolveGraphPlanningDraft?: (input: {
    threadId: string
    sourceTurnId: string
  }) => Promise<GraphPlanningLifecycle | null>
  transitionGraphPlanningDraft?: (input: {
    threadId: string
    sourceTurnId: string
    action: 'suspend' | 'resume' | 'cancel'
  }) => Promise<GraphPlanningLifecycle | null>
  /**
   * Durably cancel any GraphRun owned by this source turn before the source
   * turn itself is persisted as aborted. This ordering is the explicit Stop
   * fence: a process exit between the two writes can never leave an aborted
   * source turn attached to a still-completing run.
   */
  cancelGraphSourceRuns?: (input: {
    threadId: string
    sourceTurnId: string
  }) => Promise<void>
  ids: IdGenerator
  nowIso: () => string
}

export class TurnConflictError extends Error {}

export class TaskSurfaceLockedError extends TurnConflictError {
  constructor(
    readonly lockedSurface: ThreadAgentSurface,
    readonly requestedSurface: ThreadAgentSurface
  ) {
    super(`task surface is locked to ${lockedSurface}; received ${requestedSurface}`)
    this.name = 'TaskSurfaceLockedError'
  }
}

export class DesignProfileLockedError extends TurnConflictError {
  constructor(
    readonly lockedAtTurnId: string,
    readonly details: {
      lockedDocumentId?: string
      lockedBoardArtifactId?: string
      mismatch?: 'profile' | 'document-target'
    } = {}
  ) {
    super('Design task profile is locked and does not match the submitted profile')
    this.name = 'DesignProfileLockedError'
  }
}

/**
 * The serve runtime has accepted as many active turns as it is configured to
 * execute. Unlike a per-thread conflict, callers may retry this on another
 * thread after any active turn settles.
 */
export class TurnCapacityError extends Error {
  constructor(readonly maxConcurrentTurns: number) {
    super(`runtime turn capacity reached (${maxConcurrentTurns} active turns); retry after a turn finishes`)
    this.name = 'TurnCapacityError'
  }
}

export type TerminalTurnStatus = Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>

/**
 * Authoritative result of attempting to persist a terminal state. Callers
 * must use this rather than assuming their requested status won a race with
 * interrupt, delete, or another execution owner.
 */
export type TurnSettlement =
  | { kind: 'applied'; status: TerminalTurnStatus; error?: string }
  | { kind: 'already_terminal'; status: TerminalTurnStatus; error?: string }
  | { kind: 'missing' }

export type GraphLeadSuspensionResult =
  | 'not_graph'
  | 'graph_terminal'
  | 'pending_steering'
  | 'supervision_pending'
  | 'suspended'
  | 'suspended_pending_supervision'

export type GraphLeadResumeResult = 'resumed' | 'already_running'

export const HOST_SHUTDOWN_TURN_SUSPENSION_CODE = 'host_shutdown_turn_suspension'

export function hostShutdownTurnSuspensionReason(): { code: string } {
  return { code: HOST_SHUTDOWN_TURN_SUSPENSION_CODE }
}

/** True only for the process-local abort used to park work during host shutdown. */
export function isHostShutdownTurnSuspension(signal: AbortSignal): boolean {
  const reason = signal.reason
  return Boolean(
    reason &&
    typeof reason === 'object' &&
    'code' in reason &&
    reason.code === HOST_SHUTDOWN_TURN_SUSPENSION_CODE
  )
}

/**
 * Keep a finite backstop for one serve process while allowing a desktop user
 * to work across effectively all of their active conversations by default.
 */
export const DEFAULT_MAX_CONCURRENT_TURNS = 256

/**
 * Turn service: owns the turn lifecycle (start, finish, abort, steer,
 * compact). The service is the only place that emits turn lifecycle
 * events; the agent loop calls into it instead of mutating state
 * directly.
 */
export class TurnService {
  declare private findIdempotentStart: (input: {
    threadId: string
    request: StartTurnRequest
  }, requestFingerprint: string | undefined) => Promise<StartTurnResponse | null>
  declare private idempotentStartFromThread: (thread: ThreadRecord, request: StartTurnRequest, requestFingerprint: string | undefined) => StartTurnResponse | null
  declare private isRetryableFailedAdmission: (turn: Turn) => boolean
  declare private idempotentStartFromTurn: (
    turn: Turn,
    request: StartTurnRequest,
    requestFingerprint: string | undefined,
    threadAgentSurface?: ThreadAgentSurface
  ) => StartTurnResponse | null
  declare private resumeGraphTurnForSteering: (input: {
    threadId: string
    turnId: string
  }) => Promise<void>
  declare private beginGraphSteeringResume: (turnId: string) => void
  declare private endGraphSteeringResume: (turnId: string) => void
  declare private hasGraphSteeringResume: (turnId: string) => boolean
  declare private appendItem: (threadId: string, item: TurnItem) => Promise<void>
  declare private upsertThread: (threadId: string, mutator: (current: ThreadRecord) => ThreadRecord) => Promise<void>
  declare private withThreadMutation: <T>(threadId: string, operation: () => Promise<T>) => Promise<T>
  declare private markTurnAdmissionCompleted: (
    threadId: string,
    turnId: string,
    locks: Partial<Pick<
      ThreadRecord,
      'agentSurface' | 'designProfile' | 'approvalPolicy' | 'sandboxMode' | 'approvalReviewer'
    >>
  ) => Promise<ThreadRecord>
  declare private rollbackPendingAdmission: (threadId: string, turnId: string) => Promise<boolean>
  declare private tryAdmitTurn: (turnId: string, threadId: string) => boolean
  declare private clearRuntimeTurnState: (threadId: string, turnId: string, options?: { abort?: boolean } ) => void
  declare private releaseRuntimeTurnExecution: (threadId: string, turnId: string, options?: { abort?: boolean } ) => void
  declare private finalizeOpenItems: (turn: Turn, status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>) => Turn
  declare private discardTurnItems: (threadId: string, turnId: string) => Promise<void>
  declare private finalizePersistedOpenItems: (threadId: string, turnId: string, status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>) => Promise<void>
  declare private keepUserItems: (items: TurnItem[]) => TurnItem[]

  private deps: TurnServiceDeps
  private readonly threadItems: ThreadItemProjectionService
  private readonly inflightTurns = new Map<string, AbortController>()
  /** Turn ids that own one global admission slot. */
  private readonly admittedTurnThreads = new Map<string, string>()
  private readonly leasedTurns = new Set<string>()
  /** Steering requests that are restoring a parked Graph lease before enqueueing. */
  private readonly graphSteeringResumeFences = new Map<string, number>()
  private maxConcurrentTurns: number

  constructor(deps: TurnServiceDeps) {
    this.deps = deps
    this.threadItems = new ThreadItemProjectionService({
      threadStore: deps.threadStore,
      sessionStore: deps.sessionStore,
      nowIso: deps.nowIso
    })
    this.maxConcurrentTurns = normalizeMaxConcurrentTurns(deps.maxConcurrentTurns)
  }

}

export interface TurnService extends TurnServiceOperations {}

installServiceOperations(
  TurnService.prototype,
  turnServiceAdmissionOperations,
  turnServiceSteeringOperations,
  turnServiceCompactionOperations,
  turnServiceGraphOperations,
  turnServiceRuntimeStateOperations,
  turnServiceItemPersistenceOperations
)


export function fingerprintStartTurnRequest(request: StartTurnRequest): string | undefined {
  if (!request.clientRequestId?.trim()) return undefined
  const normalized = StartTurnRequestSchema.parse(request)
  const canonical = canonicalizeFingerprintValue(normalized)
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function canonicalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue)
  if (!value || typeof value !== 'object') return value
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry !== undefined) canonical[key] = canonicalizeFingerprintValue(entry)
  }
  return canonical
}

export function isActiveTurn(turn: Turn): turn is Turn & { status: 'queued' | 'running' } {
  return turn.status === 'queued' || turn.status === 'running'
}

export function terminalStatus(status: TurnStatus): TerminalTurnStatus {
  switch (status) {
    case 'completed':
    case 'failed':
    case 'aborted':
      return status
    default:
      throw new Error(`expected terminal turn status, got ${status}`)
  }
}

export function threadStatusFromTurns(turns: Turn[]): ThreadStatus {
  return turns.some(isActiveTurn) ? 'running' : 'idle'
}

/**
 * `archived` is a visibility/lifecycle overlay rather than a turn-derived
 * execution state. A turn may finish or be interrupted after archival, but
 * that settlement must not implicitly unarchive the thread.
 */
export function threadStatusAfterTurnTransition(currentStatus: ThreadStatus, turns: Turn[]): ThreadStatus {
  return currentStatus === 'archived' ? 'archived' : threadStatusFromTurns(turns)
}

export function normalizeMaxConcurrentTurns(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_CONCURRENT_TURNS
  return Math.max(1, Math.floor(value))
}

export function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) return normalized
  }
  return undefined
}

export function modelForManualCompaction(input: {
  turnModel?: string
  threadModel?: string
  defaultModel?: string
  clientModel?: string
}): string {
  for (const candidate of [input.turnModel, input.threadModel, input.defaultModel, input.clientModel]) {
    const normalized = candidate?.trim()
    if (!normalized || normalized.toLowerCase() === 'auto') continue
    return normalized
  }
  return input.turnModel?.trim() || input.threadModel?.trim() || input.defaultModel?.trim() || input.clientModel?.trim() || ''
}
