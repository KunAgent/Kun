import {
  GRAPH_CONTRACT_VERSION,
  type GraphDomainEventV1,
  type GraphNodeAttemptV1,
  type GraphNodeProjectionV1,
  type GraphRunV1
} from '../contracts/graph.js'
import { GraphRunConflictError } from './graph-run-store.js'
import { GraphAttemptScheduler } from './graph-attempt-scheduler.js'
import {
  deterministicReview,
  effectiveReviewKinds,
  errorMessage,
  findAttempt,
  GRAPH_HOST_SHUTDOWN_ATTEMPT_FAILURE,
  hasPendingExternalReview,
  isTerminalRunStatus,
  reviewDisposition,
  rotate,
  terminalRequiredFailure,
  validationFailureSummary
} from './graph-scheduler-policy.js'
import {
  loopGateHandlesNodeOutcome,
  loopGateWaivesIncompleteNode
} from './graph-loop-policy.js'
import { evaluateGraphLoopGates } from './graph-loop-gate-evaluator.js'
import { finishGraphRun, isGraphRunCompletionFinalizing, tryCompleteGraphRun } from './graph-run-completion.js'
import { reconcileGraphReadiness } from './graph-readiness-reconciler.js'
import type { GraphSchedulerDiagnostics, GraphSchedulerOptions, GraphSupervisionPort } from './graph-scheduler-types.js'
import { recordGraphTerminalCleanup } from './graph-terminal-cleanup.js'
import {
  deliverNodeSteering,
  handleNodeAttemptSteering
} from './graph-steering-delivery.js'
import { GraphPeerReviewCoordinator } from './graph-peer-review-coordinator.js'
import { enforceGraphBudgets, recordGraphReconcileFailure } from './graph-scheduler-maintenance.js'
export type { GraphLeadDeliveryResult, GraphSchedulerOptions, GraphSupervisionPort } from './graph-scheduler-types.js'
export { parseWorkerResult, validateWorkerResult } from './graph-scheduler-policy.js'
export class GraphScheduler extends GraphAttemptScheduler {
  private readonly runQueues = new Map<string, Promise<unknown>>()
  private readonly cleanupTasks = new Set<Promise<void>>()
  private readonly peerReviews: GraphPeerReviewCoordinator
  private timer?: NodeJS.Timeout
  private ticking = false
  private stopping = false
  private currentTick?: Promise<void>
  private fairCursor = 0
  constructor(options: GraphSchedulerOptions) {
    super(options)
    this.peerReviews = new GraphPeerReviewCoordinator({
      store: options.store,
      nextId: this.nextId,
      nowIso: this.nowIso,
      isStopping: () => this.stopping,
      onResume: (runId) => this.resumeRun(runId),
      withRunQueue: (runId, operation) => this.withRunQueue(runId, operation),
      requireRun: (runId) => this.requireRun(runId)
    })
  }
  start(): void {
    if (this.timer) return
    this.stopping = false
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.warn(`[kun] Graph scheduler tick failed: ${errorMessage(error)}`)
      })
    }, this.options.tickIntervalMs ?? 5_000)
    this.timer.unref?.()
    void this.tick().catch((error) => {
      console.warn(`[kun] Graph scheduler initial tick failed: ${errorMessage(error)}`)
    })
  }
  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const attempt of this.active.values()) {
      attempt.abort.abort(new Error(GRAPH_HOST_SHUTDOWN_ATTEMPT_FAILURE))
    }
    this.peerReviews.abortAll()
    await this.currentTick?.catch(() => undefined)
    // A scheduleNode already inside tickOnce may publish its active handle
    // after the first snapshot. Once currentTick drains no new admission is
    // possible, so take a second snapshot before declaring quiescence.
    for (const attempt of this.active.values()) {
      attempt.abort.abort(new Error(GRAPH_HOST_SHUTDOWN_ATTEMPT_FAILURE))
    }
    this.peerReviews.abortAll()
    await Promise.allSettled([...this.active.values()].map((attempt) => attempt.promise))
    await Promise.allSettled(this.peerReviews.pending())
    this.stopAllLeaseHeartbeats()
    await Promise.allSettled([...this.cleanupTasks])
  }
  override async resumeRun(runId: string): Promise<void> {
    this.activateRun(runId)
    // If a periodic pass is reconciling an older snapshot, let it fully clear
    // its lifecycle flag before taking one fresh pass for this durable input.
    await this.currentTick?.catch((error) => {
      console.warn(`[kun] Graph scheduler wake wait failed: ${errorMessage(error)}`)
    })
    await this.tick().catch((error) => {
      console.warn(`[kun] Graph scheduler wake failed: ${errorMessage(error)}`)
    })
  }
  async tick(): Promise<void> {
    if (this.stopping || this.ticking || !this.options.config().enabled) return
    this.ticking = true
    const operation = this.tickOnce()
    let completion!: Promise<void>
    completion = operation.finally(() => {
      this.ticking = false
      if (this.currentTick === completion) this.currentTick = undefined
    })
    this.currentTick = completion
    await completion
  }
  private async tickOnce(): Promise<void> {
    this.abortOverdueAttempts()
    const runs = await this.options.store.list({
      statuses: ['running', 'awaiting_supervision', 'awaiting_human', 'completing']
    })
    if (!runs.length) return
    const ordered = rotate(runs, this.fairCursor++ % runs.length)
    const configuredRunCapacity = this.options.config().scheduler.maxConcurrentRuns
    const activeRunIds = new Set([...this.active.values()].map((attempt) => attempt.runId))
    const admittedRunIds = new Set([...activeRunIds].slice(0, configuredRunCapacity))
    for (const run of ordered) {
      if (admittedRunIds.size >= configuredRunCapacity) break
      admittedRunIds.add(run.id)
    }
    for (const initial of ordered) {
      if (!admittedRunIds.has(initial.id)) continue
      if (this.fencedRuns.has(initial.id)) continue
      try {
        let run = await this.reconcileRunWithConflictRetry(initial.id)
        if (run.status === 'completing') continue
        if (run.status !== 'running' && run.status !== 'awaiting_supervision') continue
        if (this.active.size >= this.options.config().scheduler.maxConcurrentNodes) break
        const perRunActive = [...this.active.values()].filter((item) => item.runId === run.id).length
        const capacity = Math.min(
          run.budget.limits.maxConcurrentNodes,
          this.options.config().scheduler.maxConcurrentNodesPerRun
        ) - perRunActive
        if (capacity <= 0) continue
        const ready = Object.values(run.nodes)
          .filter((node) => node.status === 'ready' && node.node.kind !== 'loop_gate')
          .sort((a, b) =>
            b.node.priority - a.node.priority ||
            a.node.id.localeCompare(b.node.id))
          .slice(0, capacity)
        for (const node of ready) {
          if (this.active.size >= this.options.config().scheduler.maxConcurrentNodes) break
          if (!this.retryReady(run.id, node.node.id)) continue
          const scheduled = await this.scheduleNode(run.id, node.node.id)
          if (scheduled) run = await this.requireRun(run.id)
        }
      } catch (error) {
        await this.recordReconcileFailure(initial, error)
      }
    }
  }
  private async reconcileRunWithConflictRetry(runId: string): Promise<GraphRunV1> {
    for (let retry = 0; retry < 5; retry += 1) {
      try {
        return await this.reconcileRun(runId)
      } catch (error) {
        if (!(error instanceof GraphRunConflictError) || retry === 4) throw error
      }
    }
    throw new GraphRunConflictError(`GraphRun ${runId} reconciliation retry exhausted`)
  }
  diagnostics(): GraphSchedulerDiagnostics {
    return {
      active: [...this.active.values()].map(({ runId, nodeId, attemptId }) => ({
        runId,
        nodeId,
        attemptId
      })),
      fairCursor: this.fairCursor
    }
  }
  private async reconcileRun(runId: string): Promise<GraphRunV1> {
    const deferredSupervision: Array<{
      reason: Parameters<GraphSupervisionPort['signal']>[0]['reason']
      nodeIds: string[]
      digest: string
    }> = []
    const reconciled = await this.withRunQueue(runId, async () => {
      let run = await this.requireRun(runId)
      if (
        run.status !== 'running' &&
        run.status !== 'awaiting_supervision' &&
        run.status !== 'awaiting_human' &&
        run.status !== 'completing'
      ) return run
      if (run.status === 'completing') return this.finishCompletion(run)
      run = await this.options.mailbox.expire(run, `scheduler_${run.id}_${run.lastEventSeq}`)
      if (
        (run.status === 'awaiting_supervision' || run.status === 'awaiting_human') &&
        isGraphRunCompletionFinalizing(run, this.options.mailbox)
      ) {
        run = await this.transitionRun(
          run,
          'completing',
          'retry persisted final synthesis after supervision interruption'
        )
        return this.finishCompletion(run)
      }
      run = await this.reconcileSubmitted(run, (request) => deferredSupervision.push(request))
      const exhaustedRequiredNode = terminalRequiredFailure(run, this.options.config())
      if (exhaustedRequiredNode) {
        return this.holdRequiredFailure(run, exhaustedRequiredNode)
      }
      if (
        (run.status === 'awaiting_supervision' || run.status === 'awaiting_human') &&
        !hasPendingExternalReview(run) &&
        !run.supervisionObligations.some((obligation) =>
          obligation.state !== 'resolved' &&
          (
            obligation.kind === 'scheduler_error' ||
            obligation.state === 'needs_attention'
          )) &&
        this.options.delegation()?.enabled() === true
      ) {
        run = await this.transitionRun(run, 'running', 'reviews resolved')
      }
      if (run.status !== 'running' && run.status !== 'awaiting_supervision') return run
      run = await reconcileGraphReadiness(
        run,
        (current, nodeId, to, reason) =>
          this.transitionNode(current, nodeId, to, reason)
      )
      const failedGate = terminalRequiredFailure(run, this.options.config())
      if (failedGate) {
        return this.holdRequiredFailure(run, failedGate)
      }
      if (run.status === 'running' || run.status === 'awaiting_supervision') {
        run = await this.evaluateLoopGates(run)
        if (
          run.status === 'running' ||
          !this.peerReviews.hasActiveForRun(run.id)
        ) {
          run = await this.enforceBudgets(run)
        }
      }
      if (run.status === 'running') run = await this.tryComplete(run)
      return run
    })
    if (deferredSupervision.length) {
      // A supervision adapter may run the source Lead immediately, and that
      // Lead may call resumeRun after recording a review. Waiting for delivery
      // inside currentTick would make resumeRun wait on the tick that is
      // itself waiting on delivery. Track delivery as shutdown-safe background
      // work so the scheduler pass can first release its lifecycle barrier.
      const task = Promise.all(deferredSupervision.map((request) =>
        this.requestSupervision(
          reconciled.id,
          request.reason,
          request.nodeIds,
          request.digest
        ))).then(() => undefined).catch((error) => {
        console.warn(
          `[kun] Graph supervision dispatch failed for ${reconciled.id}: ${errorMessage(error)}`
        )
      })
      this.cleanupTasks.add(task)
      void task.finally(() => this.cleanupTasks.delete(task))
    }
    return reconciled
  }
  private async evaluateLoopGates(runInput: GraphRunV1): Promise<GraphRunV1> {
    return evaluateGraphLoopGates(runInput, {
      appendLoopAdvance: async (run, projection, resetNodeIds) => (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: `loop_advance_${run.id}_${projection.loopIteration + 1}`,
        idempotencyKey: `loop-advance:${run.id}:${projection.node.id}:${projection.loopIteration + 1}`,
        event: { type: 'loop_iteration_advanced', payload: {
          gateNodeId: projection.node.id, continueTargetNodeId: projection.node.loopGate!.continueTargetNodeId,
          resetNodeIds, iteration: projection.loopIteration + 1
        } }
      })).state,
      bumpLoopBudget: (run) => this.bumpLoopBudget(run),
      transitionNode: (run, nodeId, to, reason) => this.transitionNode(run, nodeId, to, reason)
    })
  }
  private async reconcileSubmitted(
    runInput: GraphRunV1,
    deferSupervision: (request: {
      reason: Parameters<GraphSupervisionPort['signal']>[0]['reason']
      nodeIds: string[]
      digest: string
    }) => void
  ): Promise<GraphRunV1> {
    let run = runInput
    for (const projection of Object.values(run.nodes)) {
      if (projection.status !== 'submitted' && projection.status !== 'reviewing') continue
      const attempt = projection.attempts.at(-1)
      if (!attempt?.result || !attempt.validation) continue
      if (projection.status === 'submitted') {
        run = await this.transitionNode(run, projection.node.id, 'reviewing', 'review started')
      }
      if (attempt.status === 'submitted') {
        run = await this.transitionAttempt(run, projection.node.id, attempt.id, 'reviewing')
      }
      const currentNode = run.nodes[projection.node.id]
      const currentAttempt = currentNode.attempts.find((entry) => entry.id === attempt.id)!
      run = await this.ensureReviews(run, projection.node.id, attempt.id)
      const reviewedNode = run.nodes[projection.node.id]
      const reviewedAttempt = reviewedNode.attempts.find((entry) => entry.id === attempt.id)!
      const requiredKinds = effectiveReviewKinds(
        reviewedNode,
        this.options.config(),
        run.plans.at(-1)!.completionNodeIds.includes(reviewedNode.node.id)
      )
      const reviews = run.reviews.filter((review) =>
        review.nodeId === reviewedNode.node.id &&
        review.attemptId === reviewedAttempt.id)
      const disposition = reviewDisposition({
        requiredKinds,
        requireAll: reviewedNode.node.completion.review.requireAll,
        validationValid: reviewedAttempt.validation?.valid === true,
        reviews
      })
      if (disposition.kind === 'awaiting_lead' || disposition.kind === 'invalid') {
        if (run.status === 'running') {
          run = await this.transitionRun(
            run,
            'awaiting_supervision',
            disposition.kind === 'awaiting_lead' && reviewedAttempt.validation?.valid === true
              ? 'source Lead review pending'
              : validationFailureSummary(reviewedAttempt)
          )
        }
        const durableReviewObligation = run.supervisionObligations.some((obligation) =>
          obligation.kind === 'review_required' &&
          obligation.state !== 'resolved' &&
          obligation.attemptIds.includes(reviewedAttempt.id))
        if (!durableReviewObligation) {
          deferSupervision({
            reason: 'submitted',
            nodeIds: [reviewedNode.node.id],
            digest: disposition.kind === 'awaiting_lead' && reviewedAttempt.validation?.valid === true
              ? `Source Lead review is required for attempt ${reviewedAttempt.id}.`
              : validationFailureSummary(reviewedAttempt)
          })
        }
        continue
      }
      if (disposition.kind === 'repair') {
        run = await this.requireRepair(run, reviewedNode, reviewedAttempt, disposition.reason)
        continue
      }
      if (disposition.kind === 'awaiting_human') {
        if (run.status === 'running' || run.status === 'awaiting_supervision') {
          run = await this.transitionRun(run, 'awaiting_human', 'review requires human decision')
        }
        continue
      }
      if (disposition.kind === 'awaiting_evidence') {
        if (run.status === 'running') {
          run = await this.transitionRun(run, 'awaiting_supervision', 'external review pending')
        }
        continue
      }
      const integration = await this.integrateWrite(reviewedAttempt.id)
      if (integration !== 'applied') {
        if (run.status === 'running' || run.status === 'awaiting_supervision') {
          run = await this.transitionRun(run, 'awaiting_human', 'write integration requires human resolution')
        }
        await this.requestSupervision(
          run.id,
          'conflict',
          [reviewedNode.node.id],
          'Accepted worker result could not be integrated safely.'
        )
        continue
      }
      run = await this.transitionAttempt(run, reviewedNode.node.id, reviewedAttempt.id, 'accepted')
      run = await this.transitionNode(
        run,
        reviewedNode.node.id,
        'accepted',
        'source Lead accepted the executor result'
      )
    }
    return run
  }
  private async requireRepair(
    run: GraphRunV1,
    node: GraphNodeProjectionV1,
    attempt: GraphNodeAttemptV1,
    reason: string
  ): Promise<GraphRunV1> {
    run = await this.transitionAttempt(
      run,
      node.node.id,
      attempt.id,
      'repair_required',
      'retryable',
      reason
    )
    run = await this.transitionNode(run, node.node.id, 'repair_required', reason)
    await this.releaseWrite(attempt.id, 'failed')
    return this.maybeRetry(run, node.node.id)
  }
  protected override maybeRetry(run: GraphRunV1, nodeId: string): Promise<GraphRunV1> {
    if (loopGateHandlesNodeOutcome(run, nodeId)) return Promise.resolve(run)
    return super.maybeRetry(run, nodeId)
  }
  private async holdRequiredFailure(
    run: GraphRunV1,
    node: GraphNodeProjectionV1
  ): Promise<GraphRunV1> {
    const reason =
      `Required node ${node.node.id} exhausted automatic attempts: ${node.status}`
    if (run.status === 'running' || run.status === 'awaiting_human') {
      run = await this.transitionRun(run, 'awaiting_supervision', reason)
    }
    // A Lead revise can consume the last attempt while the run is already
    // awaiting supervision. Signal that semantic-patch episode as well; the
    // supervisor's durable episode key keeps repeated reconciliation idempotent.
    if (run.status === 'awaiting_supervision') {
      await this.requestSupervision(run.id, 'failure', [node.node.id], reason)
    }
    return run
  }
  private async ensureReviews(
    runInput: GraphRunV1,
    nodeId: string,
    attemptId: string
  ): Promise<GraphRunV1> {
    let run = runInput
    const node = run.nodes[nodeId]
    const attempt = node.attempts.find((entry) => entry.id === attemptId)!
    const kinds = effectiveReviewKinds(
      node,
      this.options.config(),
      run.plans.at(-1)!.completionNodeIds.includes(nodeId)
    )
    for (const kind of kinds) {
      if (run.reviews.some((review) =>
        review.nodeId === nodeId &&
        review.attemptId === attemptId &&
        review.reviewerKind === kind)) continue
      if (kind === 'human' || kind === 'lead') continue
      if (kind === 'deterministic') {
        const review = deterministicReview(
          node,
          attempt,
          this.nextId('graph_review'),
          this.nowIso()
        )
        run = (await this.options.store.append(run.id, {
          expectedSeq: run.lastEventSeq,
          graphRevision: run.currentRevision,
          commandId: `review_${review.reviewId}`,
          idempotencyKey: `review:${review.reviewId}`,
          event: { type: 'review_recorded', payload: { review } }
        })).state
        continue
      }
      this.peerReviews.launch(run, node, attempt, this.options.supervision?.())
    }
    return run
  }

  private async recordReconcileFailure(run: GraphRunV1, error: unknown): Promise<void> {
    await recordGraphReconcileFailure(run, error, {
      withRunQueue: (runId, operation) => this.withRunQueue(runId, operation),
      requireRun: (runId) => this.requireRun(runId),
      transitionRun: (current, to, reason) => this.transitionRun(current, to, reason),
      requestSupervision: (runId, reason, nodeIds, digest) => this.requestSupervision(runId, reason, nodeIds, digest)
    })
  }

  private async enforceBudgets(run: GraphRunV1): Promise<GraphRunV1> {
    return enforceGraphBudgets(run, {
      nowIso: this.nowIso,
      updateBudget: (current, fields, reason) => this.updateBudget(current, fields, reason),
      failForBudget: (current, reason) => this.failForBudget(current, reason),
      append: (current, event, key) => this.append(current, event, key),
      requestSupervision: (runId, reason, nodeIds, digest) => this.requestSupervision(runId, reason, nodeIds, digest)
    })
  }
  protected async failForBudget(run: GraphRunV1, reason: string): Promise<GraphRunV1> {
    const next = await this.failRun(run, reason)
    if (next === run) return run
    await this.requestSupervision(run.id, 'budget', [], reason)
    return next
  }
  private async failRun(run: GraphRunV1, reason: string): Promise<GraphRunV1> {
    if (run.status !== 'running' && run.status !== 'awaiting_supervision') return run
    this.fencedRuns.add(run.id)
    const attempts = [...this.active.values()].filter((attempt) => attempt.runId === run.id)
    for (const attempt of attempts) attempt.abort.abort(new Error(reason))
    if (attempts.length) {
      const fenced = run.status === 'awaiting_supervision'
        ? run
        : await this.transitionRun(
            run,
            'awaiting_supervision',
            `failure dispatch fenced: ${reason}`
          )
      this.scheduleFailureFinalization(run.id, reason, attempts.map((attempt) => attempt.promise))
      return fenced
    }
    return this.finalizeFailure(run, reason)
  }
  private async finalizeFailure(run: GraphRunV1, reason: string): Promise<GraphRunV1> {
    if (run.status !== 'running' && run.status !== 'awaiting_supervision') return run
    run = await this.recordTerminalCleanup(run)
    const next = await this.transitionRun(run, 'failed', reason)
    await this.requestSupervision(run.id, 'failure', [], reason)
    await this.options.onTerminal?.(next)
    return next
  }
  private scheduleFailureFinalization(
    runId: string,
    reason: string,
    attemptPromises: readonly Promise<void>[]
  ): void {
    const task = Promise.allSettled(attemptPromises).then(() =>
      this.withRunQueue(runId, async () => {
        const run = await this.requireRun(runId)
        await this.finalizeFailure(run, reason)
      })
    ).catch((error) => {
      console.warn(`[kun] Graph failure finalization failed for ${runId}: ${errorMessage(error)}`)
    })
    this.cleanupTasks.add(task)
    void task.finally(() => this.cleanupTasks.delete(task))
  }
  private async tryComplete(runInput: GraphRunV1): Promise<GraphRunV1> {
    return tryCompleteGraphRun(runInput, this.completionOptions())
  }
  private async finishCompletion(initialRun: GraphRunV1): Promise<GraphRunV1> {
    return finishGraphRun(initialRun, this.completionOptions())
  }
  private completionOptions() {
    return {
      mailbox: this.options.mailbox,
      supervision: () => this.options.supervision?.(),
      nowIso: this.nowIso,
      nextId: this.nextId,
      append: (run: GraphRunV1, event: GraphDomainEventV1, key: string) => this.append(run, event, key),
      transitionRun: (run: GraphRunV1, to: GraphRunV1['status'], reason: string) => this.transitionRun(run, to, reason),
      recordTerminalCleanup: (run: GraphRunV1) => this.recordTerminalCleanup(run),
      requestSupervision: (runId: string, reason: 'completion', nodeIds: string[], digest: string) => this.requestSupervision(runId, reason, nodeIds, digest),
      onTerminal: this.options.onTerminal
    }
  }
  private recordTerminalCleanup(run: GraphRunV1): Promise<GraphRunV1> {
    this.stopRunLeaseHeartbeats(run.id)
    return recordGraphTerminalCleanup({
      run,
      writes: this.options.writes,
      nextId: this.nextId,
      nowIso: this.nowIso,
      append: (current, event, key) => this.append(current, event, key)
    })
  }
  protected async deliverSteering(
    initialRun: GraphRunV1,
    nodeId: string
  ): Promise<GraphRunV1> {
    return deliverNodeSteering(
      initialRun,
      nodeId,
      (run, event, key) => this.append(run, event, key)
    )
  }
  protected async handleAttemptSteering(
    initialRun: GraphRunV1,
    nodeId: string,
    attemptId: string
  ): Promise<GraphRunV1> {
    return handleNodeAttemptSteering(
      initialRun,
      nodeId,
      attemptId,
      (run, event, key) => this.append(run, event, key)
    )
  }
  protected async updateBudget(
    run: GraphRunV1,
    fields: Partial<Pick<GraphRunV1['budget'], 'totalTokens' | 'elapsedMs' | 'artifactBytes'>>,
    reason: string
  ): Promise<GraphRunV1> {
    const ledger = { ...run.budget, ...fields }
    return this.appendEventWithConflictRetry(
      run,
      { type: 'budget_updated', payload: { ledger, reason } },
      `budget_${run.id}_${run.lastEventSeq + 1}`,
      `budget:${run.id}:${run.lastEventSeq + 1}`
    )
  }
  private async bumpLoopBudget(run: GraphRunV1): Promise<GraphRunV1> {
    const ledger = { ...run.budget, loopIterations: run.budget.loopIterations + 1 }
    return this.appendEventWithConflictRetry(
      run,
      {
        type: 'budget_updated',
        payload: { ledger, reason: 'bounded LoopGate continuation' }
      },
      `loop_${run.id}_${ledger.loopIterations}`,
      `loop:${run.id}:${ledger.loopIterations}`
    )
  }
  protected transitionRun(
    run: GraphRunV1,
    to: GraphRunV1['status'],
    reason: string
  ): Promise<GraphRunV1> {
    return this.append(run, {
      type: 'run_status_changed',
      payload: { from: run.status, to, reason }
    }, `run:${run.id}:${run.status}:${to}:${run.lastEventSeq + 1}`)
  }
  protected transitionNode(
    run: GraphRunV1,
    nodeId: string,
    to: GraphNodeProjectionV1['status'],
    reason: string
  ): Promise<GraphRunV1> {
    const from = run.nodes[nodeId].status
    return this.append(run, {
      type: 'node_status_changed',
      payload: { nodeId, from, to, reason }
    }, `node:${run.id}:${nodeId}:${from}:${to}:${run.lastEventSeq + 1}`)
  }
  protected transitionAttempt(
    run: GraphRunV1,
    nodeId: string,
    attemptId: string,
    to: GraphNodeAttemptV1['status'],
    failureClass?: GraphNodeAttemptV1['failureClass'],
    normalizedFailure?: string,
    childThreadId?: string
  ): Promise<GraphRunV1> {
    const attempt = findAttempt(run, nodeId, attemptId)
    return this.append(run, {
      type: 'attempt_status_changed',
      payload: {
        nodeId,
        attemptId,
        from: attempt.status,
        to,
        ...(childThreadId ? { childThreadId } : {}),
        ...(failureClass ? { failureClass } : {}),
        ...(normalizedFailure ? { normalizedFailure: normalizedFailure.slice(0, 512) } : {})
      }
    }, `attempt:${attemptId}:${attempt.status}:${to}`)
  }
  private async append(
    run: GraphRunV1,
    event: GraphDomainEventV1,
    idempotencyKey: string
  ): Promise<GraphRunV1> {
    return this.appendEventWithConflictRetry(
      run,
      event,
      this.nextId('graph_command'),
      idempotencyKey
    )
  }

  protected async requestSupervision(
    runId: string,
    reason: Parameters<GraphSupervisionPort['signal']>[0]['reason'],
    nodeIds: string[],
    digest: string
  ): Promise<void> {
    await this.options.supervision?.()?.signal({
      runId,
      reason,
      nodeIds,
      digest: digest.slice(0, 4_096)
    })
  }

  protected withRunQueue<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runQueues.get(runId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    this.runQueues.set(runId, guard)
    return run.finally(() => {
      if (this.runQueues.get(runId) === guard) this.runQueues.delete(runId)
    })
  }

  protected async requireRun(runId: string): Promise<GraphRunV1> {
    const run = await this.options.store.get(runId)
    if (!run) throw new Error(`GraphRun not found: ${runId}`)
    return run
  }
}
