import {
  GRAPH_CONTRACT_VERSION,
  type GraphNodeAttemptV1,
  type GraphNodeProjectionV1,
  type GraphReviewResultV1,
  type GraphRunSummaryV1,
  type GraphRunV1
} from '../contracts/graph.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type { ChildRunRecord, DelegationRuntime } from '../delegation/delegation-runtime.js'
import type {
  GraphLeadDeliveryResult,
  GraphSupervisionPort
} from './graph-scheduler-types.js'
import type { GraphRunStore } from './graph-run-store.js'
import { runGraphBackgroundTask } from './graph-background-task.js'
import { graphLeadLifecycleSupervisionEnabled } from './graph-rollout-policy.js'
import {
  errorMessage,
  projectGraphVerifiedCheckResult,
  terminalRequiredFailure
} from './graph-scheduler-policy.js'
import { graphSupervisionObligationIsActionable, graphSupervisionSignalForObligation } from './graph-supervision-obligation.js'
import {
  graphSupervisionProjection,
  type GraphSupervisionProjectionV1
} from './graph-supervision-view.js'
import { GraphSupervisorReviewService } from './graph-supervisor-review-service.js'
import { GraphSupervisionObligationManager } from './graph-supervision-obligation-manager.js'

const SUPERVISION_OBLIGATION_SWEEP_MS = 1_000

export class GraphSupervisor implements GraphSupervisionPort {
  private started = false
  private readonly pending = new Map<string, {
    reasons: Set<Parameters<GraphSupervisionPort['signal']>[0]['reason']>
    nodeIds: Set<string>
    digests: string[]
    obligationIds: Set<string>
    timer?: NodeJS.Timeout
  }>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly leadQueues = new Map<string, Promise<unknown>>()
  private readonly nowIso: () => string
  private readonly nowMs: () => number
  private readonly nextId: (prefix: string) => string
  private readonly reviewService: GraphSupervisorReviewService
  private readonly obligations: GraphSupervisionObligationManager
  private stopped = false
  private sweepTimer?: NodeJS.Timeout
  private obligationSweepTimer?: NodeJS.Timeout

  constructor(private readonly options: {
    store: GraphRunStore
    config: () => GraphRuntimeConfig
    delegation: () => DelegationRuntime | undefined
    leadTurn?: (input: {
      run: GraphRunV1
      reasons: string[]
      nodeIds: string[]
      digest: string
    }) => Promise<GraphLeadDeliveryResult | void>
    isLeadTurnActive?: (run: GraphRunV1) => boolean
    synthesize?: (run: GraphRunV1) => Promise<GraphRunSummaryV1>
    nowIso?: () => string
    nowMs?: () => number
    nextId?: (prefix: string) => string
  }) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nowMs = options.nowMs ?? Date.now
    let next = 0
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Date.now()}_${++next}`)
    this.reviewService = new GraphSupervisorReviewService({
      config: options.config,
      delegation: options.delegation,
      nextId: this.nextId,
      nowIso: this.nowIso,
      nowMs: this.nowMs
    })
    this.obligations = new GraphSupervisionObligationManager({
      store: options.store,
      nowIso: this.nowIso,
      nowMs: this.nowMs,
      nextId: this.nextId,
      isLeadTurnActive: options.isLeadTurnActive
    })
  }

  start(): void {
    this.started = true
    this.reconfigure()
    for (const [runId, pending] of this.pending) this.schedulePending(runId, pending)
  }

  reconfigure(): void {
    if (this.stopped) return
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.obligationSweepTimer) clearInterval(this.obligationSweepTimer)
    this.sweepTimer = undefined
    this.obligationSweepTimer = undefined
    if (!graphLeadLifecycleSupervisionEnabled(this.options.config())) {
      this.clearPending()
      return
    }
    const interval = Math.max(
      5_000,
      Math.min(60_000, Math.floor(this.options.config().supervision.stallTimeoutMs / 3))
    )
    this.sweepTimer = setInterval(() => {
      runGraphBackgroundTask(
        'Graph supervisor stall sweep failed',
        this.sweepStalls()
      )
    }, interval)
    this.sweepTimer.unref?.()
    this.obligationSweepTimer = setInterval(() => {
      runGraphBackgroundTask(
        'Graph supervisor obligation sweep failed',
        this.sweepObligations()
      )
    }, SUPERVISION_OBLIGATION_SWEEP_MS)
    this.obligationSweepTimer.unref?.()
  }

  async signal(
    input: Parameters<GraphSupervisionPort['signal']>[0]
  ): Promise<void> {
    if (this.stopped || !graphLeadLifecycleSupervisionEnabled(this.options.config())) return
    const obligation = await this.withRunQueue(
      input.runId,
      () => this.obligations.persistSignal(input, true)
    )
    if (!obligation || !this.obligations.canQueue(obligation)) return
    this.queuePending(input, [obligation.id])
  }

  redeliver(
    input: Parameters<GraphSupervisionPort['signal']>[0]
  ): void {
    if (this.stopped || !graphLeadLifecycleSupervisionEnabled(this.options.config())) return
    runGraphBackgroundTask(
      `Graph supervisor redelivery preparation failed for ${input.runId}`,
      this.prepareRedelivery(input)
    )
  }

  async redeliverNow(
    input: Parameters<GraphSupervisionPort['signal']>[0]
  ): Promise<void> {
    if (this.stopped || !graphLeadLifecycleSupervisionEnabled(this.options.config())) return
    await this.prepareRedelivery(input)
    await this.flush(input.runId)
  }

  private prepareRedelivery(
    input: Parameters<GraphSupervisionPort['signal']>[0]
  ): Promise<void> {
    return this.withRunQueue(input.runId, async () => {
      const obligation = await this.obligations.persistSignal(input, false)
      if (obligation && this.obligations.canQueue(obligation)) {
        this.queuePending(input, [obligation.id])
      }
    })
  }

  private queuePending(
    input: Parameters<GraphSupervisionPort['signal']>[0],
    obligationIds: readonly string[]
  ): void {
    const pending = this.pending.get(input.runId) ?? {
      reasons: new Set(),
      nodeIds: new Set(),
      digests: [],
      obligationIds: new Set()
    }
    pending.reasons.add(input.reason)
    for (const nodeId of input.nodeIds) pending.nodeIds.add(nodeId)
    for (const obligationId of obligationIds) pending.obligationIds.add(obligationId)
    pending.digests.push(input.digest.slice(0, 4_096))
    if (pending.digests.length > 32) pending.digests.shift()
    this.pending.set(input.runId, pending)
    if (this.started) this.schedulePending(input.runId, pending)
  }

  private schedulePending(
    runId: string,
    pending: { timer?: NodeJS.Timeout }
  ): void {
    if (pending.timer) return
    pending.timer = setTimeout(() => {
      pending.timer = undefined
      runGraphBackgroundTask(
        `Graph supervisor flush failed for ${runId}`,
        this.flush(runId)
      )
    }, this.options.config().supervision.coalesceWindowMs)
    pending.timer.unref?.()
  }

  async flush(runId: string): Promise<void> {
    const pending = this.pending.get(runId)
    if (!pending || this.stopped) return
    if (!graphLeadLifecycleSupervisionEnabled(this.options.config())) {
      if (pending.timer) clearTimeout(pending.timer)
      this.pending.delete(runId)
      return
    }
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(runId)
    await this.withLeadQueue(runId, async () => {
      const claimed = await this.withRunQueue(
        runId,
        () => this.obligations.claim(runId, [...pending.obligationIds])
      )
      if (!claimed || claimed.obligations.length === 0) return
      const { run, obligations } = claimed
      if (!this.options.leadTurn) {
        await this.obligations.scheduleRetry(
          runId,
          obligations,
          'Graph source Lead delivery is unavailable.'
        )
        return
      }
      const deliveredSteeringIds = run.steering
        .filter((entry) =>
          (entry.target.kind === 'lead' || entry.target.kind === 'run') &&
          (entry.status === 'persisted' || entry.status === 'delivered'))
        .map((entry) => entry.steeringId)
      try {
        const rawDelivery = await this.options.leadTurn({
          run,
          reasons: [...pending.reasons],
          nodeIds: [...pending.nodeIds],
          digest: pending.digests.join('\n').slice(0, 16_384)
        })
        const delivery: GraphLeadDeliveryResult = rawDelivery ?? {
          status: 'delivered',
          sourceTurnId: run.sourceTurnId,
          deliveredSeq: run.lastEventSeq,
          executionActive: this.options.isLeadTurnActive?.(run) ?? false
        }
        if (delivery.status === 'delivered') {
          await this.acknowledgeLeadSteering(runId, deliveredSteeringIds)
          await this.obligations.recordDelivered(runId, obligations, delivery)
          if (delivery.parkedWithPendingSupervision || !delivery.executionActive) {
            await this.rearmAfterNoProgress(runId, obligations.map((entry) => entry.id))
          }
          return
        }
        if (delivery.status === 'deferred') {
          await this.obligations.scheduleRetry(runId, obligations, delivery.reason)
          return
        }
        if (delivery.status === 'orphaned') {
          await this.obligations.markNeedsAttention(runId, obligations, delivery.reason)
          return
        }
        await this.obligations.resolve(runId, obligations)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await this.obligations.scheduleRetry(runId, obligations, message)
        console.warn(`[kun] Graph Lead supervision deferred: ${message.slice(0, 512)}`)
      }
    })
  }

  async projection(runId: string): Promise<GraphSupervisionProjectionV1 | null> {
    const run = await this.options.store.get(runId)
    return run
      ? graphSupervisionProjection(run, {
          leadActive: this.options.isLeadTurnActive?.(run) ?? false,
          nowMs: this.nowMs(),
          peerReviewLeases: this.reviewService.leasesForRun(run.id)
        })
      : null
  }

  async wake(
    runId: string,
    obligationId?: string,
    idempotencyKey?: string
  ): Promise<GraphRunV1 | null> {
    const run = await this.options.store.get(runId)
    if (!run) return null
    if (isTerminal(run.status)) return run
    const targets = run.supervisionObligations.filter((obligation) =>
      obligation.state !== 'resolved' &&
      (!obligationId || obligation.id === obligationId))
    for (const obligation of targets) {
      const updated = await this.obligations.update(
        runId,
        obligation.id,
        (_latest, current) => {
          if (current.state === 'resolved') return null
          if (current.state === 'delivering' && future(current.leaseUntil, this.nowMs())) {
            return null
          }
          if (
            current.state === 'awaiting_action' &&
            this.options.isLeadTurnActive?.(_latest)
          ) return null
          const next = {
            ...current,
            state: 'retry_scheduled' as const,
            nextWakeAt: this.nowIso(),
            updatedAt: this.nowIso()
          }
          delete next.leaseUntil
          return next
        },
        'manual-wake',
        idempotencyKey
          ? `manual-wake:${idempotencyKey}:${obligation.id}`
          : undefined
      )
      if (updated?.changed) {
        this.queuePending(
          graphSupervisionSignalForObligation(runId, updated.obligation),
          [updated.obligation.id]
        )
      }
    }
    return this.options.store.get(runId)
  }

  private async rearmAfterNoProgress(
    runId: string,
    obligationIds: readonly string[]
  ): Promise<void> {
    const attention = await this.obligations.rearmAfterNoProgress(runId, obligationIds)
    if (attention.length > 0) {
      await this.obligations.transitionRunToHuman(
        runId,
        attention[0]!.attentionReason ?? 'Graph supervision requires human attention.'
      )
    }
  }

  review(input: {
    run: GraphRunV1
    node: GraphNodeProjectionV1
    attempt: GraphNodeAttemptV1
    kind: 'peer' | 'lead'
    signal?: AbortSignal
  }): Promise<GraphReviewResultV1> {
    return this.reviewService.review(input)
  }

  /** Abort reviewer children without waiting for source-Lead queues. */
  quiesceReviews(): void { this.reviewService.quiesce() }

  private async acknowledgeLeadSteering(
    runId: string,
    deliveredSteeringIds: readonly string[]
  ): Promise<void> {
    let run = await this.options.store.get(runId)
    if (!run) return
    for (const steeringId of deliveredSteeringIds) {
      run = await this.options.store.get(runId)
      if (!run) return
      const steering = run.steering.find((entry) => entry.steeringId === steeringId)
      if (!steering || steering.status === 'handled' || steering.status === 'superseded') continue
      run = (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: this.nextId('graph_supervision'),
        idempotencyKey: `steering-handled:lead:${run.id}:${steering.steeringId}`,
        event: {
          type: 'steering_status_changed',
          payload: {
            steeringId: steering.steeringId,
            from: steering.status,
            to: 'handled'
          }
        }
      })).state
    }
  }

  async synthesize(run: GraphRunV1): Promise<GraphRunSummaryV1> {
    if (this.options.synthesize) return this.options.synthesize(run)
    const accepted = Object.values(run.nodes).flatMap((node) =>
      node.attempts.filter((attempt) => attempt.id === node.acceptedAttemptId))
    const summaries = run.plans.at(-1)!.completionNodeIds.flatMap((nodeId) => {
      const node = run.nodes[nodeId]
      return node?.attempts
        .filter((attempt) => attempt.id === node.acceptedAttemptId)
        .map((attempt) => attempt.result?.summary)
        .filter((summary): summary is string => Boolean(summary)) ?? []
    })
    return {
      version: GRAPH_CONTRACT_VERSION,
      finalAnswer: (summaries.join('\n\n') || 'GraphRun completed.').slice(0, 32_768),
      evidenceRefs: accepted.flatMap((attempt) => attempt.result?.artifactRefs ?? []).slice(0, 256),
      unresolvedRisks: accepted.flatMap((attempt) => attempt.result?.risks ?? []).slice(0, 128),
      changedFiles: [...new Set(accepted.flatMap((attempt) =>
        attempt.result?.changedFiles ?? []))].slice(0, 10_000),
      validationResults: accepted.flatMap((attempt) =>
        attempt.result?.verifiedChecks?.map(projectGraphVerifiedCheckResult) ?? []).slice(0, 512),
      totalTokens: run.budget.totalTokens,
      totalElapsedMs: run.budget.elapsedMs,
      completedAt: this.nowIso()
    }
  }

  async sweepObligations(): Promise<number> {
    if (!graphLeadLifecycleSupervisionEnabled(this.options.config())) return 0
    const runs = await this.options.store.list({
      statuses: [
        'running',
        'paused',
        'awaiting_supervision',
        'awaiting_human',
        'completing',
        'completed',
        'failed',
        'cancelled'
      ]
    })
    let queued = 0
    for (const snapshot of runs) {
      if (this.stopped) break
      for (const node of Object.values(snapshot.nodes)) {
        const attempt = node.attempts.at(-1)
        if (
          !attempt ||
          !['submitted', 'reviewing'].includes(node.status) ||
          !['submitted', 'reviewing'].includes(attempt.status) ||
          snapshot.reviews.some((review) =>
            review.attemptId === attempt.id && review.reviewerKind === 'lead') ||
          snapshot.supervisionObligations.some((obligation) =>
            obligation.kind === 'review_required' &&
            obligation.attemptIds.includes(attempt.id))
        ) continue
        await this.signal({
          runId: snapshot.id,
          reason: 'submitted',
          nodeIds: [node.node.id],
          digest: `Source Lead review is required for submitted attempt ${attempt.id}.`
        })
        queued += 1
      }
      const exhausted = terminalRequiredFailure(snapshot, this.options.config())
      if (
        exhausted &&
        !snapshot.supervisionObligations.some((obligation) =>
          obligation.kind === 'repair_required' &&
          obligation.graphRevision === snapshot.currentRevision &&
          obligation.nodeIds.includes(exhausted.node.id))
      ) {
        await this.signal({
          runId: snapshot.id,
          reason: 'failure',
          nodeIds: [exhausted.node.id],
          digest: `Required node ${exhausted.node.id} exhausted automatic attempts.`
        })
        queued += 1
      }

      let run = await this.options.store.get(snapshot.id)
      if (!run) continue
      const activeObligations = run.supervisionObligations.filter((obligation) =>
        obligation.state !== 'resolved' && obligation.state !== 'needs_attention')
      if (
        run.status === 'awaiting_supervision' &&
        activeObligations.length === 0 &&
        !isTerminal(run.status)
      ) {
        await this.signal({
          runId: run.id,
          reason: 'recovery',
          nodeIds: [],
          digest: 'GraphRun is awaiting source Lead supervision without an active obligation.'
        })
        queued += 1
        run = await this.options.store.get(run.id) ?? run
      }

      for (const obligation of run.supervisionObligations) {
        if (obligation.state === 'resolved') continue
        if (obligation.state === 'needs_attention') {
          if (run.status !== 'awaiting_human' && !isTerminal(run.status)) {
            await this.obligations.transitionRunToHuman(
              run.id,
              obligation.attentionReason ?? 'Graph supervision requires human attention.'
            )
            run = await this.options.store.get(run.id) ?? run
          }
          continue
        }
        if (!graphSupervisionObligationIsActionable(run, obligation)) {
          await this.obligations.resolve(run.id, [obligation])
          continue
        }
        if (obligation.state === 'delivering') {
          if (!future(obligation.leaseUntil, this.nowMs())) {
            await this.obligations.scheduleRetry(
              run.id,
              [obligation],
              'Graph supervision delivery lease expired.'
            )
          }
          continue
        }
        if (obligation.state === 'awaiting_action') {
          if (this.options.isLeadTurnActive?.(run)) continue
          if (!future(obligation.nextWakeAt, this.nowMs())) {
            await this.rearmAfterNoProgress(run.id, [obligation.id])
          }
          continue
        }
        if (
          (obligation.state === 'pending' || obligation.state === 'retry_scheduled') &&
          !future(obligation.nextWakeAt, this.nowMs())
        ) {
          this.queuePending(
            graphSupervisionSignalForObligation(run.id, obligation),
            [obligation.id]
          )
          queued += 1
        }
      }
    }
    return queued
  }

  async sweepStalls(): Promise<number> {
    if (!graphLeadLifecycleSupervisionEnabled(this.options.config())) return 0
    const runs = await this.options.store.list({ statuses: ['running', 'awaiting_supervision'] })
    let signaled = 0
    const now = this.nowMs()
    const childRunsByThread = new Map<string, Map<string, ChildRunRecord>>()
    for (const run of runs) {
      let childRunsById = childRunsByThread.get(run.threadId)
      if (!childRunsById) {
        childRunsById = await this.loadChildRunsById(run.threadId)
        childRunsByThread.set(run.threadId, childRunsById)
      }
      const stalled = Object.values(run.nodes).filter((node) => {
        const attempt = node.attempts.at(-1)
        if (node.status !== 'running' || !attempt?.startedAt) return false
        const child = attempt.childThreadId
          ? childRunsById.get(attempt.childThreadId)
          : undefined
        const latestActivityAt = child?.activity?.updatedAt ??
          child?.updatedAt ??
          attempt.startedAt
        const latestActivityMs = Date.parse(latestActivityAt)
        return Number.isFinite(latestActivityMs) &&
          now - latestActivityMs >= this.options.config().supervision.stallTimeoutMs
      })
      if (!stalled.length) continue
      await this.signal({
        runId: run.id,
        reason: 'stall',
        nodeIds: stalled.map((node) => node.node.id),
        digest:
          `${stalled.length} running node attempt(s) had no safe child activity within the ` +
          'supervision quiet threshold. Attempts remain running; inspect durable state before acting.'
      })
      signaled += 1
    }
    return signaled
  }

  private async loadChildRunsById(threadId: string): Promise<Map<string, ChildRunRecord>> {
    const delegation = this.options.delegation()
    if (!delegation) return new Map()
    try {
      const diagnostics = await delegation.diagnostics(threadId)
      return new Map(diagnostics.childRuns.map((child) => [child.id, child]))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[kun] Graph supervisor could not read child activity for ${threadId}: ` +
        message.slice(0, 512)
      )
      return new Map()
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.quiesceReviews()
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.obligationSweepTimer) clearInterval(this.obligationSweepTimer)
    this.sweepTimer = undefined
    this.obligationSweepTimer = undefined
    this.clearPending()
    await Promise.allSettled([
      ...this.queues.values(),
      ...this.leadQueues.values()
    ])
  }

  private clearPending(): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
    }
    this.pending.clear()
  }

  private withRunQueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    return this.withQueue(this.queues, runId, operation)
  }

  private withLeadQueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    return this.withQueue(this.leadQueues, runId, operation)
  }

  private withQueue<T>(
    queues: Map<string, Promise<unknown>>,
    runId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = queues.get(runId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    queues.set(runId, guard)
    return run.finally(() => {
      if (queues.get(runId) === guard) queues.delete(runId)
    })
  }
}

function future(value: string | undefined, nowMs: number): boolean {
  if (!value) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > nowMs
}

function isTerminal(status: GraphRunV1['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
