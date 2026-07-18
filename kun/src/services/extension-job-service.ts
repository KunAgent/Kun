import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { JobErrorSchema, JobProgressSchema, JobResultSchema } from '@kun/extension-api'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { JsonValue } from '../extensions/types.js'
import { ExtensionJobStore } from './extension-job-store.js'
import { ExtensionJobSubscription } from './extension-job-subscription.js'
import {
  EXTENSION_JOB_SCHEMA_VERSION,
  isExtensionJobTerminal,
  type ExtensionJobCaller,
  type ExtensionJobCheckpoint,
  type ExtensionJobErrorData,
  type ExtensionJobFilter,
  type ExtensionJobOwner,
  type ExtensionJobPage,
  type ExtensionJobProgress,
  type ExtensionJobResult,
  type ExtensionJobSnapshot,
  type StoredExtensionJob
} from './extension-job-types.js'

export const DEFAULT_EXTENSION_JOB_PROGRESS_INTERVAL_MS = 250
export const DEFAULT_EXTENSION_JOB_CANCELLATION_DEADLINE_MS = 10_000
export const DEFAULT_EXTENSION_JOB_RESULT_BYTES = 256 * 1024
export const DEFAULT_EXTENSION_JOB_ERROR_BYTES = 32 * 1024
export const DEFAULT_EXTENSION_JOB_CHECKPOINT_BYTES = 256 * 1024
export const DEFAULT_EXTENSION_JOB_SUBSCRIBER_EVENTS = 128
export const DEFAULT_EXTENSION_JOB_SUBSCRIBER_BYTES = 512 * 1024

export type ExtensionJobQuotaOptions = {
  maxActiveGlobal?: number
  maxActivePerExtension?: number
  maxActivePerWorkspace?: number
  maxActivePerKind?: number
  maxQueuedPerExtension?: number
  maxStartsPerMinutePerExtension?: number
}

export type ExtensionJobServiceOptions = {
  store: ExtensionJobStore
  now?: () => Date
  createId?: () => string
  quotas?: ExtensionJobQuotaOptions
  progressIntervalMs?: number
  cancellationDeadlineMs?: number
  maxResultBytes?: number
  maxErrorBytes?: number
  maxCheckpointBytes?: number
  maxSubscriberEvents?: number
  maxSubscriberBytes?: number
  authorizeCreate?(input: ExtensionJobCreateInput): void | Promise<void>
  reauthorize?(snapshot: ExtensionJobSnapshot, workspaceRoot: string): boolean | Promise<boolean>
  onDiagnostic?(diagnostic: ExtensionJobDiagnostic): void
}

export type ExtensionJobCreateInput = {
  owner: ExtensionJobOwner
  /** Core-only root used for execution and recovery authorization. */
  workspaceRoot: string
  kind: string
  kindSchemaVersion: number
  initiatingOperation: string
  permissionsSnapshot: readonly string[]
  idempotencyKey?: string
  checkpoint?: ExtensionJobCheckpoint
}

export type ExtensionJobCreateResult = {
  snapshot: ExtensionJobSnapshot
  created: boolean
}

export type ExtensionJobCancelResult = {
  accepted: boolean
  snapshot: ExtensionJobSnapshot
}

export type ExtensionJobExecutionContext = {
  jobId: string
  attempt: number
  workspaceRoot: string
  signal: AbortSignal
  checkpoint?: ExtensionJobCheckpoint
  reportProgress(progress: Omit<ExtensionJobProgress, 'updatedAt'>): Promise<void>
  saveCheckpoint(checkpoint: ExtensionJobCheckpoint): Promise<void>
}

export type ExtensionJobRecoveryDecision = 'resume' | 'restart' | 'interrupt'

export type ExtensionJobRecoveryContext = {
  workspaceRoot: string
}

/** Core-only executor. This is intentionally not exposed through ExtensionContext. */
export type ExtensionJobCoreExecutor = {
  kind: string
  connectionBound?: boolean
  execute(
    snapshot: ExtensionJobSnapshot,
    context: ExtensionJobExecutionContext
  ): Promise<ExtensionJobResult | undefined>
  cancel?(
    snapshot: ExtensionJobSnapshot,
    context: {
      reason: string
      signal: AbortSignal
      workspaceRoot: string
      /** Present only when cancellation is reconciling an orphaned attempt. */
      checkpoint?: ExtensionJobCheckpoint
    }
  ): Promise<void>
  recover?(
    snapshot: ExtensionJobSnapshot,
    checkpoint: ExtensionJobCheckpoint | undefined,
    context: ExtensionJobRecoveryContext
  ): ExtensionJobRecoveryDecision | Promise<ExtensionJobRecoveryDecision>
  /** Reconcile core-private state belonging to an already durable terminal job. */
  recoverTerminal?(
    snapshot: ExtensionJobSnapshot,
    checkpoint: ExtensionJobCheckpoint | undefined,
    context: ExtensionJobRecoveryContext
  ): Promise<void>
  /** Finalize core-private output state after this attempt wins the terminal fence. */
  commitResult?(
    snapshot: ExtensionJobSnapshot,
    result: ExtensionJobResult,
    context: ExtensionJobRecoveryContext
  ): Promise<void>
  /** Roll back durable result metadata when this attempt loses the terminal fence. */
  discardResult?(
    snapshot: ExtensionJobSnapshot,
    result: ExtensionJobResult,
    context: ExtensionJobRecoveryContext
  ): Promise<void>
}

export type ExtensionJobDiagnostic = {
  jobId: string
  ownerExtensionId: string
  kind: string
  state: ExtensionJobSnapshot['state']
  executionAttempt: number
  action: string
  code?: string
}

export type ExtensionJobRecoverySummary = {
  queued: number
  deferred: number
  resumed: number
  cancelled: number
  interrupted: number
}

export type ExtensionJobLifecycleSummary = {
  matched: number
  cancelled: number
  interrupted: number
  alreadyTerminal: number
}

type ActiveExecution = {
  attempt: number
  workspaceRoot: string
  controller: AbortController
  executor: ExtensionJobCoreExecutor
  promise: Promise<void>
  resultDiscardFailed: boolean
}

type PendingProgress = {
  attempt: number
  value: ExtensionJobProgress
  timer?: NodeJS.Timeout
}

export class ExtensionJobServiceError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'not_found'
      | 'unauthorized'
      | 'quota_exceeded'
      | 'executor_unavailable'
      | 'invalid_transition'
      | 'payload_too_large'
      | 'lifecycle_fenced',
    message: string,
    readonly retryable: boolean,
    readonly details: Record<string, JsonValue> = {}
  ) {
    super(message)
    this.name = 'ExtensionJobServiceError'
  }
}

/**
 * Core-owned durable state machine for extension background jobs.
 *
 * Extension code can observe and cancel owned jobs through a broker, but only
 * trusted runtime composition code can register an executor or dispatch work.
 */
export class ExtensionJobService {
  private readonly store: ExtensionJobStore
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly progressIntervalMs: number
  private readonly cancellationDeadlineMs: number
  private readonly maxResultBytes: number
  private readonly maxErrorBytes: number
  private readonly maxCheckpointBytes: number
  private readonly maxSubscriberEvents: number
  private readonly maxSubscriberBytes: number
  private readonly quotas: Required<ExtensionJobQuotaOptions>
  private readonly executors = new Map<string, ExtensionJobCoreExecutor>()
  private readonly active = new Map<string, ActiveExecution>()
  private readonly cancellations = new Map<string, Promise<ExtensionJobSnapshot>>()
  private readonly pendingProgress = new Map<string, PendingProgress>()
  private readonly lastProgressAt = new Map<string, number>()
  private readonly extensionFences = new Map<string, string>()
  private readonly workspaceFences = new Map<string, string>()
  private readonly startWindows = new Map<string, number[]>()
  private readonly subscriptions = new Map<string, ExtensionJobSubscription>()
  private readonly unsubscribeStore: () => void
  private admissionOperation: Promise<unknown> = Promise.resolve()
  private recovery?: Promise<ExtensionJobRecoverySummary>
  private shuttingDown = false

  constructor(private readonly options: ExtensionJobServiceOptions) {
    this.store = options.store
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? (() => `job_${randomUUID()}`)
    this.progressIntervalMs = nonNegativeInteger(
      options.progressIntervalMs,
      DEFAULT_EXTENSION_JOB_PROGRESS_INTERVAL_MS,
      'progressIntervalMs'
    )
    this.cancellationDeadlineMs = positiveInteger(
      options.cancellationDeadlineMs,
      DEFAULT_EXTENSION_JOB_CANCELLATION_DEADLINE_MS,
      'cancellationDeadlineMs'
    )
    this.maxResultBytes = positiveInteger(options.maxResultBytes, DEFAULT_EXTENSION_JOB_RESULT_BYTES, 'maxResultBytes')
    this.maxErrorBytes = positiveInteger(options.maxErrorBytes, DEFAULT_EXTENSION_JOB_ERROR_BYTES, 'maxErrorBytes')
    this.maxCheckpointBytes = positiveInteger(
      options.maxCheckpointBytes,
      DEFAULT_EXTENSION_JOB_CHECKPOINT_BYTES,
      'maxCheckpointBytes'
    )
    this.maxSubscriberEvents = positiveInteger(
      options.maxSubscriberEvents,
      DEFAULT_EXTENSION_JOB_SUBSCRIBER_EVENTS,
      'maxSubscriberEvents'
    )
    this.maxSubscriberBytes = positiveInteger(
      options.maxSubscriberBytes,
      DEFAULT_EXTENSION_JOB_SUBSCRIBER_BYTES,
      'maxSubscriberBytes'
    )
    this.quotas = {
      maxActiveGlobal: positiveInteger(options.quotas?.maxActiveGlobal, 128, 'maxActiveGlobal'),
      maxActivePerExtension: positiveInteger(
        options.quotas?.maxActivePerExtension,
        16,
        'maxActivePerExtension'
      ),
      maxActivePerWorkspace: positiveInteger(
        options.quotas?.maxActivePerWorkspace,
        32,
        'maxActivePerWorkspace'
      ),
      maxActivePerKind: positiveInteger(options.quotas?.maxActivePerKind, 32, 'maxActivePerKind'),
      maxQueuedPerExtension: positiveInteger(
        options.quotas?.maxQueuedPerExtension,
        32,
        'maxQueuedPerExtension'
      ),
      maxStartsPerMinutePerExtension: positiveInteger(
        options.quotas?.maxStartsPerMinutePerExtension,
        120,
        'maxStartsPerMinutePerExtension'
      )
    }
    this.unsubscribeStore = this.store.subscribe((snapshot, event) => {
      for (const subscription of this.subscriptions.values()) {
        if (subscription.jobId === snapshot.id) subscription.offer(snapshot, event)
      }
    })
  }

  registerCoreExecutor(executor: ExtensionJobCoreExecutor): () => void {
    validateBoundedString(executor.kind, 'executor.kind', 128)
    if (this.executors.has(executor.kind)) {
      throw new ExtensionJobServiceError(
        'invalid_request',
        `Core executor is already registered for ${executor.kind}`,
        false
      )
    }
    this.executors.set(executor.kind, executor)
    return () => {
      if (this.executors.get(executor.kind) === executor) this.executors.delete(executor.kind)
    }
  }

  async initialize(): Promise<ExtensionJobRecoverySummary> {
    this.recovery ??= this.recoverOnStartup()
    return this.recovery
  }

  async createJob(input: ExtensionJobCreateInput): Promise<ExtensionJobCreateResult> {
    return this.serializeAdmission(async () => {
      validateCreateInput(input, this.maxCheckpointBytes)
      this.assertCreationAllowed(input.owner)
      await this.options.authorizeCreate?.(structuredClone(input))

      const idempotency = input.idempotencyKey === undefined
        ? undefined
        : { operation: input.initiatingOperation, key: input.idempotencyKey }
      if (idempotency !== undefined) {
        const existing = await this.store.findIdempotent(input.owner, idempotency)
        if (existing !== undefined) return { snapshot: existing, created: false }
      }

      const jobs = await this.store.list()
      this.enforceAdmissionQuota(input, jobs)
      this.consumeStartRate(input.owner.extensionId)
      const now = this.now().toISOString()
      const created = await this.store.create({
        snapshot: {
          schemaVersion: EXTENSION_JOB_SCHEMA_VERSION,
          id: this.createId(),
          kind: input.kind,
          kindSchemaVersion: input.kindSchemaVersion,
          ownerExtensionId: input.owner.extensionId,
          ownerExtensionVersion: input.owner.extensionVersion,
          workspaceId: input.owner.workspaceId,
          initiatingOperation: input.initiatingOperation,
          state: 'queued',
          executionAttempt: 0,
          createdAt: now,
          updatedAt: now
        },
        workspaceRoot: input.workspaceRoot,
        permissionsSnapshot: input.permissionsSnapshot,
        ...(idempotency ? { idempotency } : {}),
        ...(input.checkpoint ? { checkpoint: input.checkpoint } : {})
      })
      this.diagnostic(created.snapshot, 'created')
      return created
    })
  }

  async createAndDispatch(input: ExtensionJobCreateInput): Promise<ExtensionJobCreateResult> {
    const created = await this.createJob(input)
    if (created.created) await this.dispatch(created.snapshot.id)
    return created
  }

  async dispatch(jobId: string): Promise<ExtensionJobSnapshot> {
    const stored = await this.store.getStored(jobId)
    if (stored === undefined) throw this.notFound()
    this.assertMutationAllowed(stored.snapshot)
    const executor = this.executors.get(stored.snapshot.kind)
    if (executor === undefined) {
      throw new ExtensionJobServiceError(
        'executor_unavailable',
        'No core executor is available for this job kind',
        true,
        { kind: stored.snapshot.kind }
      )
    }
    return this.beginExecution(stored, executor, false)
  }

  async getOwned(caller: ExtensionJobCaller, jobId: string): Promise<ExtensionJobSnapshot> {
    const snapshot = await this.store.get(jobId)
    if (snapshot === undefined || !callerOwns(caller, snapshot)) throw this.notFound()
    return snapshot
  }

  async listOwned(
    caller: ExtensionJobCaller,
    options: { filter?: ExtensionJobFilter; cursor?: string; limit?: number } = {}
  ): Promise<ExtensionJobPage> {
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)))
    const filter = options.filter ?? {}
    const all = (await this.store.list()).filter((snapshot) =>
      callerOwns(caller, snapshot) && matchesFilter(snapshot, filter))
    const marker = options.cursor === undefined ? undefined : decodePageCursor(options.cursor)
    const start = marker === undefined
      ? 0
      : Math.max(0, all.findIndex((snapshot) => snapshot.id === marker.id && snapshot.createdAt === marker.createdAt) + 1)
    const items = all.slice(start, start + limit)
    const hasMore = start + items.length < all.length
    return {
      items,
      page: {
        hasMore,
        ...(hasMore && items.length > 0 ? { nextCursor: encodePageCursor(items[items.length - 1]!) } : {})
      }
    }
  }

  async cancel(
    caller: ExtensionJobCaller,
    jobId: string,
    reason = 'owner_request'
  ): Promise<ExtensionJobCancelResult> {
    const owned = await this.getOwned(caller, jobId)
    if (isExtensionJobTerminal(owned.state)) return { accepted: false, snapshot: owned }
    this.assertMutationAllowed(owned)
    const snapshot = await this.cancelInternal(jobId, reason)
    return { accepted: true, snapshot }
  }

  async subscribe(
    caller: ExtensionJobCaller,
    jobId: string,
    cursor?: string
  ): Promise<ExtensionJobSubscription> {
    const owned = await this.getOwned(caller, jobId)
    this.assertMutationAllowed(owned)
    const subscription = new ExtensionJobSubscription({
      jobId,
      ownerExtensionId: owned.ownerExtensionId,
      workspaceId: owned.workspaceId,
      maxQueueEvents: this.maxSubscriberEvents,
      maxQueueBytes: this.maxSubscriberBytes,
      onClose: (subscriptionId) => this.subscriptions.delete(subscriptionId)
    })
    this.subscriptions.set(subscription.subscriptionId, subscription)
    try {
      const replay = await this.store.replay(jobId, cursor)
      if (replay === undefined || !callerOwns(caller, replay.snapshot)) throw this.notFound()
      subscription.initialize(replay)
      return subscription
    } catch (error) {
      subscription.close()
      throw error
    }
  }

  unsubscribe(caller: ExtensionJobCaller, subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId)
    if (
      subscription === undefined ||
      subscription.ownerExtensionId !== caller.extensionId ||
      !caller.workspaceIds.includes(subscription.workspaceId)
    ) return false
    subscription.close()
    return true
  }

  async reportProgress(
    jobId: string,
    attempt: number,
    input: Omit<ExtensionJobProgress, 'updatedAt'>
  ): Promise<void> {
    const snapshot = await this.store.get(jobId)
    if (
      snapshot === undefined ||
      snapshot.state !== 'running' ||
      snapshot.executionAttempt !== attempt ||
      snapshot.cancelRequestedAt !== undefined
    ) return
    const value = normalizeProgress(input, snapshot.progress, this.now())
    const last = this.lastProgressAt.get(jobId)
    const elapsed = last === undefined ? Number.POSITIVE_INFINITY : this.now().getTime() - last
    if (this.progressIntervalMs === 0 || elapsed >= this.progressIntervalMs) {
      await this.persistProgress(jobId, attempt, value)
      return
    }
    const existing = this.pendingProgress.get(jobId)
    if (existing?.timer !== undefined) clearTimeout(existing.timer)
    const pending: PendingProgress = { attempt, value }
    pending.timer = setTimeout(() => {
      if (this.pendingProgress.get(jobId) !== pending) return
      this.pendingProgress.delete(jobId)
      void this.persistProgress(jobId, attempt, pending.value).catch(() => undefined)
    }, Math.max(1, this.progressIntervalMs - elapsed))
    pending.timer.unref?.()
    this.pendingProgress.set(jobId, pending)
  }

  async saveCheckpoint(
    jobId: string,
    attempt: number,
    checkpoint: ExtensionJobCheckpoint
  ): Promise<void> {
    enforceJsonBound(checkpoint, this.maxCheckpointBytes, 'checkpoint')
    await this.store.mutate(jobId, (record) => {
      if (
        record.snapshot.state !== 'running' ||
        record.snapshot.executionAttempt !== attempt ||
        record.snapshot.cancelRequestedAt !== undefined ||
        this.isSnapshotFenced(record.snapshot)
      ) return undefined
      return { checkpoint }
    })
  }

  async complete(
    jobId: string,
    attempt: number,
    result: ExtensionJobResult = { schemaVersion: 1, generatedArtifacts: [] }
  ): Promise<ExtensionJobSnapshot> {
    const bounded = normalizeResult(result, this.maxResultBytes)
    return (await this.commitTerminal(jobId, attempt, 'completed', { result: bounded })).snapshot
  }

  async fail(jobId: string, attempt: number, error: unknown): Promise<ExtensionJobSnapshot> {
    return (await this.commitTerminal(jobId, attempt, 'failed', {
      error: normalizeError(error, this.maxErrorBytes)
    })).snapshot
  }

  async interrupt(
    jobId: string,
    error: ExtensionJobErrorData
  ): Promise<ExtensionJobSnapshot> {
    await this.flushProgress(jobId)
    const bounded = normalizeError(error, this.maxErrorBytes)
    const now = this.now().toISOString()
    const commit = await this.store.mutate(jobId, (record) => {
      if (isExtensionJobTerminal(record.snapshot.state)) return undefined
      const snapshot: ExtensionJobSnapshot = {
        ...record.snapshot,
        state: 'interrupted',
        updatedAt: now,
        terminalAt: now,
        error: bounded
      }
      delete snapshot.result
      return { snapshot, event: { type: 'interrupted', error: bounded } }
    })
    if (commit === undefined) throw this.notFound()
    this.clearProgress(jobId)
    this.diagnostic(commit.snapshot, 'terminal', bounded.code)
    return commit.snapshot
  }

  async waitForIdle(jobId: string): Promise<void> {
    await this.active.get(jobId)?.promise
    await this.cancellations.get(jobId)
  }

  get activeCount(): number {
    return this.active.size
  }

  get subscriptionCount(): number {
    return this.subscriptions.size
  }

  async handleExtensionDisabled(extensionId: string): Promise<ExtensionJobLifecycleSummary> {
    return this.fenceExtension(extensionId, 'extension_disabled')
  }

  async handleExtensionRollback(extensionId: string): Promise<ExtensionJobLifecycleSummary> {
    return this.fenceExtension(extensionId, 'extension_rollback')
  }

  async handleExtensionUninstalled(extensionId: string): Promise<ExtensionJobLifecycleSummary> {
    return this.fenceExtension(extensionId, 'extension_uninstalled')
  }

  async handleWorkspaceRevoked(
    extensionId: string,
    workspaceId: string
  ): Promise<ExtensionJobLifecycleSummary> {
    this.workspaceFences.set(workspaceFenceKey(extensionId, workspaceId), 'workspace_revoked')
    this.revokeSubscriptions((subscription) =>
      subscription.ownerExtensionId === extensionId && subscription.workspaceId === workspaceId)
    return this.fenceOwnedJobs(
      (snapshot) => snapshot.ownerExtensionId === extensionId && snapshot.workspaceId === workspaceId,
      'workspace_revoked'
    )
  }

  async handleExtensionHostCrash(
    extensionId: string,
    workspaceIds?: readonly string[]
  ): Promise<ExtensionJobLifecycleSummary> {
    const scopedWorkspaceIds = workspaceIds === undefined ? undefined : new Set(workspaceIds)
    this.revokeSubscriptions((subscription) =>
      subscription.ownerExtensionId === extensionId &&
      (scopedWorkspaceIds === undefined || scopedWorkspaceIds.has(subscription.workspaceId)))
    return this.fenceOwnedJobs((snapshot) => {
      if (snapshot.ownerExtensionId !== extensionId) return false
      if (scopedWorkspaceIds !== undefined && !scopedWorkspaceIds.has(snapshot.workspaceId)) return false
      return this.executors.get(snapshot.kind)?.connectionBound === true
    }, 'extension_host_crash')
  }

  async handleRuntimeShutdown(): Promise<ExtensionJobLifecycleSummary> {
    if (this.shuttingDown) {
      return { matched: 0, cancelled: 0, interrupted: 0, alreadyTerminal: 0 }
    }
    this.shuttingDown = true
    this.revokeSubscriptions(() => true)
    const summary = await this.fenceOwnedJobs(() => true, 'runtime_shutdown')
    this.unsubscribeStore()
    return summary
  }

  clearExtensionFence(extensionId: string): void {
    this.extensionFences.delete(extensionId)
  }

  clearWorkspaceFence(extensionId: string, workspaceId: string): void {
    this.workspaceFences.delete(workspaceFenceKey(extensionId, workspaceId))
  }

  private async fenceExtension(
    extensionId: string,
    reason: string
  ): Promise<ExtensionJobLifecycleSummary> {
    this.extensionFences.set(extensionId, reason)
    this.revokeSubscriptions((subscription) => subscription.ownerExtensionId === extensionId)
    return this.fenceOwnedJobs(
      (snapshot) => snapshot.ownerExtensionId === extensionId,
      reason
    )
  }

  private async fenceOwnedJobs(
    matches: (snapshot: ExtensionJobSnapshot) => boolean,
    reason: string
  ): Promise<ExtensionJobLifecycleSummary> {
    const snapshots = (await this.store.list()).filter(matches)
    const summary: ExtensionJobLifecycleSummary = {
      matched: snapshots.length,
      cancelled: 0,
      interrupted: 0,
      alreadyTerminal: 0
    }
    const outcomes = await Promise.all(snapshots.map(async (snapshot) => {
      if (isExtensionJobTerminal(snapshot.state)) {
        return { terminal: snapshot, alreadyTerminal: true }
      }
      return { terminal: await this.cancelInternal(snapshot.id, reason), alreadyTerminal: false }
    }))
    for (const { terminal, alreadyTerminal } of outcomes) {
      if (alreadyTerminal) {
        summary.alreadyTerminal += 1
        continue
      }
      if (terminal.state === 'cancelled') summary.cancelled += 1
      else if (terminal.state === 'interrupted') summary.interrupted += 1
      else summary.alreadyTerminal += 1
    }
    return summary
  }

  private revokeSubscriptions(matches: (subscription: ExtensionJobSubscription) => boolean): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (matches(subscription)) subscription.close()
    }
  }

  private async recoverOnStartup(): Promise<ExtensionJobRecoverySummary> {
    await this.store.load()
    const summary: ExtensionJobRecoverySummary = {
      queued: 0,
      deferred: 0,
      resumed: 0,
      cancelled: 0,
      interrupted: 0
    }
    const records = (await this.store.listStored()).sort(compareRecoveryPriority)
    for (const record of records) {
      const snapshot = record.snapshot
      if (isExtensionJobTerminal(snapshot.state)) {
        const executor = this.executors.get(snapshot.kind)
        if (executor?.recoverTerminal !== undefined) {
          try {
            await executor.recoverTerminal(snapshot, record.checkpoint, {
              workspaceRoot: record.workspaceRoot
            })
          } catch {
            this.diagnostic(snapshot, 'result-finalization-incomplete')
          }
        }
        continue
      }
      if (snapshot.cancelRequestedAt !== undefined) {
        const terminal = await this.cancelInternal(
          snapshot.id,
          record.cancellationReason ?? 'recovered_cancel_intent'
        )
        if (terminal.state === 'cancelled') summary.cancelled += 1
        else summary.interrupted += 1
        continue
      }
      if (await this.isRecoveryAuthorized(record) === false) {
        await this.interrupt(snapshot.id, interruptionError(
          'JOB_RECOVERY_UNAUTHORIZED',
          'Job owner or workspace is no longer authorized during recovery'
        ))
        summary.interrupted += 1
        continue
      }
      const executor = this.executors.get(snapshot.kind)
      if (executor === undefined) {
        await this.interrupt(snapshot.id, interruptionError(
          'JOB_RECOVERY_EXECUTOR_UNAVAILABLE',
          'The core executor required to recover this job is unavailable'
        ))
        summary.interrupted += 1
        continue
      }
      if (snapshot.state === 'queued') {
        if (await this.canDispatchRecovered(snapshot) === false) {
          summary.deferred += 1
          continue
        }
        await this.beginExecution(record, executor, true)
        summary.queued += 1
        continue
      }
      let decision: ExtensionJobRecoveryDecision = 'interrupt'
      try {
        decision = await executor.recover?.(snapshot, record.checkpoint, {
          workspaceRoot: record.workspaceRoot
        }) ?? 'interrupt'
      } catch {
        decision = 'interrupt'
      }
      if (decision === 'resume' || decision === 'restart') {
        await this.beginExecution(record, executor, true)
        summary.resumed += 1
      } else {
        await this.interrupt(snapshot.id, interruptionError(
          'JOB_RECOVERY_UNSAFE',
          'The previous execution outcome is unknown and cannot be replayed safely'
        ))
        summary.interrupted += 1
      }
    }
    return summary
  }

  private async isRecoveryAuthorized(record: StoredExtensionJob): Promise<boolean> {
    const snapshot = record.snapshot
    if (this.extensionFences.has(snapshot.ownerExtensionId)) return false
    if (this.workspaceFences.has(workspaceFenceKey(snapshot.ownerExtensionId, snapshot.workspaceId))) {
      return false
    }
    try {
      return await this.options.reauthorize?.(
        structuredClone(snapshot),
        record.workspaceRoot
      ) ?? true
    } catch {
      return false
    }
  }

  private async canDispatchRecovered(snapshot: ExtensionJobSnapshot): Promise<boolean> {
    const running = (await this.store.list()).filter((job) =>
      job.state === 'running' && this.active.has(job.id))
    return running.length < this.quotas.maxActiveGlobal &&
      running.filter((job) => job.ownerExtensionId === snapshot.ownerExtensionId).length <
        this.quotas.maxActivePerExtension &&
      running.filter((job) => job.workspaceId === snapshot.workspaceId).length <
        this.quotas.maxActivePerWorkspace &&
      running.filter((job) => job.kind === snapshot.kind).length < this.quotas.maxActivePerKind
  }

  private async beginExecution(
    stored: StoredExtensionJob,
    executor: ExtensionJobCoreExecutor,
    recovery: boolean
  ): Promise<ExtensionJobSnapshot> {
    if (this.active.has(stored.snapshot.id)) return this.active.get(stored.snapshot.id) === undefined
      ? stored.snapshot
      : (await this.store.get(stored.snapshot.id)) ?? stored.snapshot
    const now = this.now().toISOString()
    const commit = await this.store.mutate(stored.snapshot.id, (record) => {
      if (record.snapshot.cancelRequestedAt !== undefined || isExtensionJobTerminal(record.snapshot.state)) {
        return undefined
      }
      if (
        (!recovery && record.snapshot.state !== 'queued') ||
        (recovery && record.snapshot.state !== 'queued' && record.snapshot.state !== 'running')
      ) {
        return undefined
      }
      const snapshot: ExtensionJobSnapshot = {
        ...record.snapshot,
        state: 'running',
        executionAttempt: record.snapshot.executionAttempt + 1,
        startedAt: record.snapshot.startedAt ?? now,
        updatedAt: now
      }
      return {
        snapshot,
        event: { type: recovery ? 'recovery' : 'state' }
      }
    })
    if (commit === undefined) throw this.notFound()
    if (!commit.changed) return commit.snapshot
    const controller = new AbortController()
    const jobId = commit.snapshot.id
    const active: ActiveExecution = {
      attempt: commit.snapshot.executionAttempt,
      workspaceRoot: stored.workspaceRoot,
      controller,
      executor,
      promise: Promise.resolve(),
      resultDiscardFailed: false
    }
    active.promise = this.execute(active, commit.snapshot, stored.checkpoint).finally(() => {
      if (this.active.get(jobId) === active) this.active.delete(jobId)
    })
    this.active.set(jobId, active)
    this.diagnostic(commit.snapshot, recovery ? 'recovered' : 'started')
    return commit.snapshot
  }

  private async execute(
    active: ActiveExecution,
    snapshot: ExtensionJobSnapshot,
    checkpoint: ExtensionJobCheckpoint | undefined
  ): Promise<void> {
    try {
      const result = await active.executor.execute(snapshot, {
        jobId: snapshot.id,
        attempt: active.attempt,
        workspaceRoot: active.workspaceRoot,
        signal: active.controller.signal,
        checkpoint: checkpoint === undefined ? undefined : structuredClone(checkpoint),
        reportProgress: (progress) => this.reportProgress(snapshot.id, active.attempt, progress),
        saveCheckpoint: (next) => this.saveCheckpoint(snapshot.id, active.attempt, next)
      })
      const bounded = normalizeResult(
        result ?? { schemaVersion: 1, generatedArtifacts: [] },
        this.maxResultBytes
      )
      let completion: { snapshot: ExtensionJobSnapshot; changed: boolean }
      try {
        completion = await this.commitTerminal(
          snapshot.id,
          active.attempt,
          'completed',
          { result: bounded }
        )
      } catch (error) {
        await this.discardExecutionResult(active, snapshot, bounded)
        throw error
      }
      if (completion.changed) {
        if (active.executor.commitResult !== undefined) {
          try {
            await active.executor.commitResult(snapshot, bounded, {
              workspaceRoot: active.workspaceRoot
            })
          } catch {
            // The durable completed result and validated target remain valid.
            // A core finalizer may deliberately retain recovery material when
            // its best-effort cleanup cannot finish.
            this.diagnostic(completion.snapshot, 'result-finalization-incomplete')
          }
        }
      } else if (completion.snapshot.state !== 'completed') {
        await this.discardExecutionResult(active, snapshot, bounded)
      }
    } catch (error) {
      const current = await this.store.get(snapshot.id)
      if (current?.cancelRequestedAt !== undefined || isExtensionJobTerminal(current?.state ?? 'interrupted')) return
      await this.fail(snapshot.id, active.attempt, error)
    }
  }

  private async discardExecutionResult(
    active: ActiveExecution,
    snapshot: ExtensionJobSnapshot,
    result: ExtensionJobResult
  ): Promise<void> {
    if (active.executor.discardResult === undefined) {
      if (result.generatedArtifacts.length > 0) active.resultDiscardFailed = true
      return
    }
    try {
      await active.executor.discardResult(snapshot, result, {
        workspaceRoot: active.workspaceRoot
      })
    } catch {
      active.resultDiscardFailed = true
    }
  }

  private async commitTerminal(
    jobId: string,
    attempt: number,
    state: 'completed' | 'failed',
    outcome: { result?: ExtensionJobResult; error?: ExtensionJobErrorData }
  ): Promise<{ snapshot: ExtensionJobSnapshot; changed: boolean }> {
    await this.flushProgress(jobId)
    const now = this.now().toISOString()
    const commit = await this.store.mutate(jobId, (record) => {
      if (
        record.snapshot.state !== 'running' ||
        record.snapshot.executionAttempt !== attempt ||
        record.snapshot.cancelRequestedAt !== undefined ||
        (state === 'completed' && this.isSnapshotFenced(record.snapshot))
      ) return undefined
      const snapshot: ExtensionJobSnapshot = {
        ...record.snapshot,
        state,
        updatedAt: now,
        terminalAt: now,
        ...(outcome.result ? { result: outcome.result } : {}),
        ...(outcome.error ? { error: outcome.error } : {})
      }
      if (state === 'completed') delete snapshot.error
      else delete snapshot.result
      return {
        snapshot,
        event: { type: state, ...outcome }
      }
    })
    if (commit === undefined) throw this.notFound()
    if (!commit.changed) {
      const current = commit.snapshot
      if (
        !isExtensionJobTerminal(current.state) &&
        current.cancelRequestedAt === undefined &&
        current.executionAttempt === attempt &&
        current.state !== 'running'
      ) {
        throw new ExtensionJobServiceError(
          'invalid_transition',
          `Cannot transition extension job from ${current.state} to ${state}`,
          false
        )
      }
      return { snapshot: current, changed: false }
    }
    this.clearProgress(jobId)
    this.diagnostic(commit.snapshot, 'terminal', outcome.error?.code)
    return { snapshot: commit.snapshot, changed: true }
  }

  private async cancelInternal(jobId: string, reason: string): Promise<ExtensionJobSnapshot> {
    const existingTask = this.cancellations.get(jobId)
    if (existingTask !== undefined) return existingTask
    const task = this.performCancellation(jobId, reason).finally(() => {
      if (this.cancellations.get(jobId) === task) this.cancellations.delete(jobId)
    })
    this.cancellations.set(jobId, task)
    return task
  }

  private async performCancellation(jobId: string, reason: string): Promise<ExtensionJobSnapshot> {
    // Keep a reference even if the active map's finally-handler wins the race
    // while the durable cancellation intent is being written.
    const active = this.active.get(jobId)
    const now = this.now().toISOString()
    const commit = await this.store.mutate(jobId, (record) => {
      if (isExtensionJobTerminal(record.snapshot.state)) return undefined
      if (record.snapshot.cancelRequestedAt !== undefined) return undefined
      const queued = record.snapshot.state === 'queued'
      const snapshot: ExtensionJobSnapshot = {
        ...record.snapshot,
        cancelRequestedAt: now,
        updatedAt: now,
        ...(queued ? {
          state: 'cancelled' as const,
          terminalAt: now,
          error: cancellationError(reason)
        } : {})
      }
      return {
        snapshot,
        cancellationReason: sanitizeText(reason, 256),
        event: queued
          ? { type: 'cancelled', error: cancellationError(reason) }
          : { type: 'cancellation-requested' }
      }
    })
    if (commit === undefined) throw this.notFound()
    if (!commit.changed) {
      const current = commit.snapshot
      if (!isExtensionJobTerminal(current.state) && current.cancelRequestedAt !== undefined) {
        return this.finishRunningCancellation(current, reason, active)
      }
      return current
    }
    if (commit.snapshot.state === 'cancelled') {
      this.clearProgress(jobId)
      this.diagnostic(commit.snapshot, 'cancelled', 'cancelled')
      return commit.snapshot
    }
    return this.finishRunningCancellation(commit.snapshot, reason, active)
  }

  private async finishRunningCancellation(
    snapshot: ExtensionJobSnapshot,
    reason: string,
    activeHint?: ActiveExecution
  ): Promise<ExtensionJobSnapshot> {
    const active = activeHint?.attempt === snapshot.executionAttempt
      ? activeHint
      : this.active.get(snapshot.id)
    const stored = active === undefined ? await this.store.getStored(snapshot.id) : undefined
    const workspaceRoot = active?.workspaceRoot ?? stored?.workspaceRoot
    if (workspaceRoot === undefined) throw this.notFound()
    active?.controller.abort(new Error('Extension job cancelled'))
    const executor = active?.executor ?? this.executors.get(snapshot.kind)
    const cleanupTasks: Promise<void>[] = []
    if (active !== undefined) cleanupTasks.push(active.promise)
    const cleanupController = new AbortController()
    let cleanupTimer: NodeJS.Timeout | undefined
    if (executor?.cancel !== undefined) {
      cleanupTimer = setTimeout(() => cleanupController.abort(
        new Error('Cancellation cleanup deadline exceeded')),
        this.cancellationDeadlineMs)
      cleanupTimer.unref?.()
      cleanupTasks.push(Promise.resolve().then(() => executor.cancel!(snapshot, {
        reason: sanitizeText(reason, 256),
        signal: cleanupController.signal,
        workspaceRoot,
        ...(stored?.checkpoint ? { checkpoint: structuredClone(stored.checkpoint) } : {})
      })))
    }
    let cleanupFailed = cleanupTasks.length === 0
    const cleanupOperation = Promise.all(cleanupTasks.map(async (task) => {
      try {
        await task
      } catch {
        cleanupFailed = true
      }
    })).then(() => {
      if (active?.resultDiscardFailed) cleanupFailed = true
    })
    let cleanupComplete = false
    try {
      cleanupComplete = cleanupTasks.length > 0 &&
        await runWithDeadline(cleanupOperation, this.cancellationDeadlineMs) &&
        !cleanupFailed
    } finally {
      if (!cleanupComplete && !cleanupController.signal.aborted) {
        cleanupController.abort(new Error('Cancellation cleanup deadline exceeded'))
      }
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer)
    }
    await this.flushProgress(snapshot.id)
    const now = this.now().toISOString()
    const state = cleanupComplete ? 'cancelled' as const : 'interrupted' as const
    const error = cleanupComplete
      ? cancellationError(reason)
      : interruptionError('cancellation_cleanup_incomplete', 'Cancellation cleanup did not finish safely')
    const commit = await this.store.mutate(snapshot.id, (record) => {
      if (isExtensionJobTerminal(record.snapshot.state)) return undefined
      const next: ExtensionJobSnapshot = {
        ...record.snapshot,
        state,
        updatedAt: now,
        terminalAt: now,
        error
      }
      delete next.result
      return { snapshot: next, event: { type: state, error } }
    })
    this.clearProgress(snapshot.id)
    const terminal = commit?.snapshot ?? await this.store.get(snapshot.id)
    if (terminal === undefined) throw this.notFound()
    this.diagnostic(terminal, state, error.code)
    return terminal
  }

  private async persistProgress(
    jobId: string,
    attempt: number,
    progress: ExtensionJobProgress
  ): Promise<void> {
    const commit = await this.store.mutate(jobId, (record) => {
      if (
        record.snapshot.state !== 'running' ||
        record.snapshot.executionAttempt !== attempt ||
        record.snapshot.cancelRequestedAt !== undefined ||
        this.isSnapshotFenced(record.snapshot)
      ) return undefined
      return {
        snapshot: { ...record.snapshot, updatedAt: progress.updatedAt, progress },
        event: { type: 'progress', progress }
      }
    })
    if (commit?.changed) this.lastProgressAt.set(jobId, this.now().getTime())
  }

  private async flushProgress(jobId: string): Promise<void> {
    const pending = this.pendingProgress.get(jobId)
    if (pending === undefined) return
    this.pendingProgress.delete(jobId)
    if (pending.timer !== undefined) clearTimeout(pending.timer)
    await this.persistProgress(jobId, pending.attempt, pending.value)
  }

  private clearProgress(jobId: string): void {
    const pending = this.pendingProgress.get(jobId)
    if (pending?.timer !== undefined) clearTimeout(pending.timer)
    this.pendingProgress.delete(jobId)
    this.lastProgressAt.delete(jobId)
  }

  private assertCreationAllowed(owner: ExtensionJobOwner): void {
    if (this.shuttingDown) {
      throw new ExtensionJobServiceError('lifecycle_fenced', 'Runtime is shutting down', true)
    }
    const reason = this.extensionFences.get(owner.extensionId) ??
      this.workspaceFences.get(workspaceFenceKey(owner.extensionId, owner.workspaceId))
    if (reason !== undefined) {
      throw new ExtensionJobServiceError(
        'lifecycle_fenced',
        'Extension background jobs are fenced by lifecycle policy',
        true,
        { reason }
      )
    }
  }

  private assertMutationAllowed(snapshot: ExtensionJobSnapshot): void {
    if (this.shuttingDown || this.isSnapshotFenced(snapshot)) {
      throw new ExtensionJobServiceError(
        'lifecycle_fenced',
        'Extension background job mutations are fenced by lifecycle policy',
        true
      )
    }
  }

  private isSnapshotFenced(snapshot: ExtensionJobSnapshot): boolean {
    return this.extensionFences.has(snapshot.ownerExtensionId) ||
      this.workspaceFences.has(workspaceFenceKey(snapshot.ownerExtensionId, snapshot.workspaceId))
  }

  private enforceAdmissionQuota(input: ExtensionJobCreateInput, jobs: ExtensionJobSnapshot[]): void {
    const active = jobs.filter((job) => !isExtensionJobTerminal(job.state))
    const queuedForOwner = active.filter((job) =>
      job.state === 'queued' && job.ownerExtensionId === input.owner.extensionId).length
    const limits: Array<[boolean, string]> = [
      [active.length >= this.quotas.maxActiveGlobal, 'global_active'],
      [active.filter((job) => job.ownerExtensionId === input.owner.extensionId).length >=
        this.quotas.maxActivePerExtension, 'extension_active'],
      [active.filter((job) => job.workspaceId === input.owner.workspaceId).length >=
        this.quotas.maxActivePerWorkspace, 'workspace_active'],
      [active.filter((job) => job.kind === input.kind).length >= this.quotas.maxActivePerKind, 'kind_active'],
      [queuedForOwner >= this.quotas.maxQueuedPerExtension, 'extension_queued']
    ]
    const exceeded = limits.find(([condition]) => condition)?.[1]
    if (exceeded !== undefined) {
      throw new ExtensionJobServiceError(
        'quota_exceeded',
        'Extension background job quota exceeded',
        true,
        { quota: exceeded }
      )
    }
  }

  private consumeStartRate(extensionId: string): void {
    const now = this.now().getTime()
    const recent = (this.startWindows.get(extensionId) ?? []).filter((value) => now - value < 60_000)
    if (recent.length >= this.quotas.maxStartsPerMinutePerExtension) {
      throw new ExtensionJobServiceError(
        'quota_exceeded',
        'Extension background job start rate exceeded',
        true,
        { quota: 'extension_start_rate' }
      )
    }
    recent.push(now)
    this.startWindows.set(extensionId, recent)
  }

  private diagnostic(snapshot: ExtensionJobSnapshot, action: string, code?: string): void {
    this.options.onDiagnostic?.({
      jobId: snapshot.id,
      ownerExtensionId: snapshot.ownerExtensionId,
      kind: snapshot.kind,
      state: snapshot.state,
      executionAttempt: snapshot.executionAttempt,
      action,
      ...(code ? { code: normalizeJobErrorCode(code) } : {})
    })
  }

  private notFound(): ExtensionJobServiceError {
    return new ExtensionJobServiceError('not_found', 'Extension job was not found', false)
  }

  private serializeAdmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.admissionOperation.then(operation, operation)
    this.admissionOperation = result.then(() => undefined, () => undefined)
    return result
  }
}

function validateCreateInput(input: ExtensionJobCreateInput, maxCheckpointBytes: number): void {
  validateBoundedString(input.owner.extensionId, 'owner.extensionId', 255)
  validateBoundedString(input.owner.extensionVersion, 'owner.extensionVersion', 64)
  validateBoundedString(input.owner.workspaceId, 'owner.workspaceId', 256)
  validateBoundedString(input.workspaceRoot, 'workspaceRoot', 4_096)
  if (!isAbsolute(input.workspaceRoot) || containsAsciiControl(input.workspaceRoot)) {
    throw new ExtensionJobServiceError('invalid_request', 'Invalid workspaceRoot', false)
  }
  try {
    if (extensionWorkspaceKey(input.workspaceRoot) !== input.owner.workspaceId) {
      throw new ExtensionJobServiceError(
        'invalid_request',
        'Job workspace identity does not match its trusted root',
        false
      )
    }
  } catch (error) {
    if (error instanceof ExtensionJobServiceError) throw error
    throw new ExtensionJobServiceError('invalid_request', 'Invalid workspaceRoot', false)
  }
  validateBoundedString(input.kind, 'kind', 128)
  validateBoundedString(input.initiatingOperation, 'initiatingOperation', 128)
  if (!Number.isSafeInteger(input.kindSchemaVersion) || input.kindSchemaVersion <= 0) {
    throw new ExtensionJobServiceError('invalid_request', 'Invalid job kind schema version', false)
  }
  if (input.permissionsSnapshot.length > 64 || !input.permissionsSnapshot.every((value) =>
    typeof value === 'string' && value.length > 0 && value.length <= 128)) {
    throw new ExtensionJobServiceError('invalid_request', 'Invalid job permission snapshot', false)
  }
  if (input.idempotencyKey !== undefined) {
    validateBoundedString(input.idempotencyKey, 'idempotencyKey', 128)
  }
  if (input.checkpoint !== undefined) enforceJsonBound(input.checkpoint, maxCheckpointBytes, 'checkpoint')
}

function validateBoundedString(value: string, field: string, maxLength: number): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new ExtensionJobServiceError('invalid_request', `Invalid ${field}`, false)
  }
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function callerOwns(caller: ExtensionJobCaller, snapshot: ExtensionJobSnapshot): boolean {
  return caller.extensionId === snapshot.ownerExtensionId && caller.workspaceIds.includes(snapshot.workspaceId)
}

function matchesFilter(snapshot: ExtensionJobSnapshot, filter: ExtensionJobFilter): boolean {
  return (filter.states === undefined || filter.states.includes(snapshot.state)) &&
    (filter.kinds === undefined || filter.kinds.includes(snapshot.kind)) &&
    (filter.workspaceId === undefined || filter.workspaceId === snapshot.workspaceId) &&
    (filter.createdAfter === undefined || snapshot.createdAt > filter.createdAfter) &&
    (filter.createdBefore === undefined || snapshot.createdAt < filter.createdBefore)
}

function encodePageCursor(snapshot: ExtensionJobSnapshot): string {
  return Buffer.from(JSON.stringify({ id: snapshot.id, createdAt: snapshot.createdAt }), 'utf8')
    .toString('base64url')
}

function decodePageCursor(cursor: string): { id: string; createdAt: string } | undefined {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      id?: unknown
      createdAt?: unknown
    }
    return typeof value.id === 'string' && typeof value.createdAt === 'string'
      ? { id: value.id, createdAt: value.createdAt }
      : undefined
  } catch {
    return undefined
  }
}

function normalizeProgress(
  input: Omit<ExtensionJobProgress, 'updatedAt'>,
  previous: ExtensionJobProgress | undefined,
  now: Date
): ExtensionJobProgress {
  const phase = input.phase === undefined ? previous?.phase : sanitizeText(input.phase, 128)
  const samePhase = phase === previous?.phase
  const total = finitePositive(input.total, 'progress.total')
  let completed = finiteNonNegative(input.completed, 'progress.completed')
  let percentage = finiteRange(input.percentage, 0, 100, 'progress.percentage')
  if (samePhase && previous?.completed !== undefined && completed !== undefined) {
    completed = Math.max(previous.completed, completed)
  }
  if (completed !== undefined && total !== undefined && completed > total) {
    throw new ExtensionJobServiceError(
      'invalid_request',
      'Invalid progress.completed: value exceeds total',
      false
    )
  }
  if (completed !== undefined && total !== undefined && total > 0 && percentage === undefined) {
    percentage = Math.min(100, completed / total * 100)
  }
  if (samePhase && previous?.percentage !== undefined && percentage !== undefined) {
    percentage = Math.max(previous.percentage, percentage)
  }
  return JobProgressSchema.parse({
    ...(phase ? { phase } : {}),
    ...(completed !== undefined ? { completed } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(input.unit ? { unit: sanitizeText(input.unit, 64) } : {}),
    ...(percentage !== undefined ? { percentage } : {}),
    ...(input.message ? { message: sanitizeText(input.message, 1_024) } : {}),
    updatedAt: now.toISOString()
  })
}

function finiteNonNegative(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) {
    throw new ExtensionJobServiceError('invalid_request', `Invalid ${field}`, false)
  }
  return value
}

function finitePositive(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0) {
    throw new ExtensionJobServiceError('invalid_request', `Invalid ${field}`, false)
  }
  return value
}

function finiteRange(
  value: number | undefined,
  min: number,
  max: number,
  field: string
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new ExtensionJobServiceError('invalid_request', `Invalid ${field}`, false)
  }
  return value
}

function normalizeResult(result: ExtensionJobResult, maxBytes: number): ExtensionJobResult {
  let normalized: ExtensionJobResult
  try {
    normalized = JobResultSchema.parse(structuredClone(result))
  } catch {
    throw new ExtensionJobServiceError('invalid_request', 'Invalid extension job result', false)
  }
  enforceJsonBound(normalized, maxBytes, 'result')
  return normalized
}

function normalizeError(error: unknown, maxBytes: number): ExtensionJobErrorData {
  const source = error as {
    code?: unknown
    message?: unknown
    retryable?: unknown
    category?: unknown
    details?: unknown
  }
  const category = isJobErrorCategory(source?.category) ? source.category : undefined
  const details = isPlainRecord(source?.details)
    ? sanitizeJson(source.details) as Record<string, JsonValue>
    : undefined
  const normalized = JobErrorSchema.parse({
    code: normalizeJobErrorCode(typeof source?.code === 'string' ? source.code : 'EXECUTOR_FAILED'),
    message: sanitizeText(
      typeof source?.message === 'string' ? source.message : 'Extension background job failed',
      2_048
    ),
    retryable: source?.retryable === true,
    ...(category ? { category } : {}),
    ...(details ? { details } : {})
  })
  if (jsonBytes(normalized) <= maxBytes) return normalized
  return {
    code: normalized.code,
    message: sanitizeText(normalized.message, Math.max(64, Math.floor(maxBytes / 2))),
    retryable: normalized.retryable,
    details: { truncated: true }
  }
}

function cancellationError(reason: string): ExtensionJobErrorData {
  return {
    code: 'CANCELLED',
    message: `Extension background job cancelled: ${sanitizeText(reason, 256)}`,
    retryable: true,
    category: 'cancelled'
  }
}

function interruptionError(code: string, message: string): ExtensionJobErrorData {
  return {
    code: normalizeJobErrorCode(code),
    message: sanitizeText(message, 1_024),
    retryable: true,
    category: 'internal'
  }
}

function normalizeJobErrorCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^_+/, '').slice(0, 128)
  if (/^[A-Z][A-Z0-9_]*$/.test(normalized)) return normalized
  return 'EXECUTOR_FAILED'
}

function isJobErrorCategory(value: unknown): value is NonNullable<ExtensionJobErrorData['category']> {
  return value === 'permission' || value === 'scope' || value === 'quota' ||
    value === 'unavailable' || value === 'cancelled' || value === 'invalid' || value === 'internal'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeJson(value: unknown): unknown {
  return walkStrings(redactSecrets(toJsonValue(value)), (text) => sanitizeText(text, 2_048))
}

function toJsonValue(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return null
    return JSON.parse(serialized) as JsonValue
  } catch {
    return null
  }
}

function walkStrings(value: JsonValue, transform: (value: string) => string): JsonValue {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map((item) => walkStrings(item, transform))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walkStrings(child, transform)]))
  }
  return value
}

function sanitizeText(value: string, maxLength: number): string {
  return redactSecretText(value)
    .replace(/kun-media:\/\/[^\s]+/gi, 'kun-media://<redacted>')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/|\/tmp\/)[^\s,;]+/g, '<redacted-path>')
    .slice(0, maxLength)
}

function enforceJsonBound(value: unknown, maxBytes: number, field: string): void {
  if (jsonBytes(value) > maxBytes) {
    throw new ExtensionJobServiceError(
      'payload_too_large',
      `Extension job ${field} exceeds its byte limit`,
      false,
      { field, maxBytes }
    )
  }
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function workspaceFenceKey(extensionId: string, workspaceId: string): string {
  return `${extensionId}\0${workspaceId}`
}

function compareRecoveryPriority(left: StoredExtensionJob, right: StoredExtensionJob): number {
  const priority = (record: StoredExtensionJob) => record.snapshot.cancelRequestedAt !== undefined
    ? 0
    : record.snapshot.state === 'running' ? 1 : 2
  return priority(left) - priority(right) ||
    left.snapshot.createdAt.localeCompare(right.snapshot.createdAt) ||
    left.snapshot.id.localeCompare(right.snapshot.id)
}

async function runWithDeadline(operation: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(`${name} must be positive`)
  return normalized
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${name} must be non-negative`)
  return normalized
}
