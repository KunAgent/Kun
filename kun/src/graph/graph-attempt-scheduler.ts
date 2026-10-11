import {
  GRAPH_CONTRACT_VERSION,
  type GraphDomainEventV1,
  type GraphNodeAttemptV1,
  type GraphNodeProjectionV1,
  type GraphRunV1
} from '../contracts/graph.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime.js'
import { buildGraphWorkerContext } from './graph-worker-context.js'
import { GraphRunConflictError } from './graph-run-store.js'
import type { GraphPathLease } from './graph-write-coordinator.js'
import {
  currentIterationAttemptCount,
  effectiveRunAttemptCount,
  effectiveNodeMaxAttempts,
  errorMessage,
  findAttempt,
  GRAPH_HOST_SHUTDOWN_ATTEMPT_FAILURE,
  isTerminalAttemptStatus,
  isTerminalRunStatus,
  totalAttemptLimit
} from './graph-scheduler-policy.js'
import type {
  GraphSchedulerOptions,
  GraphSupervisionPort
} from './graph-scheduler-types.js'
import { graphWorkerSecuritySnapshot } from './graph-worker-security.js'
import { bindGraphAttemptSession } from './graph-attempt-activity.js'
import { resolveGraphAttemptAssignment } from './graph-attempt-routing.js'
import { finalizeGraphWorkerResult } from './graph-worker-result-finalizer.js'
import { GraphAttemptLeaseManager } from './graph-attempt-leases.js'

type ActiveAttempt = {
  runId: string
  nodeId: string
  attemptId: string
  abort: AbortController
  timeout: NodeJS.Timeout
  deadlineAt: number
  promise: Promise<void>
}

export abstract class GraphAttemptScheduler {
  protected readonly active = new Map<string, ActiveAttempt>()
  protected readonly fencedRuns = new Set<string>()
  private readonly cancellingRuns = new Set<string>()
  private readonly leaseManager: GraphAttemptLeaseManager
  private readonly retryNotBefore = new Map<string, number>()
  protected readonly nowIso: () => string
  protected readonly nextId: (prefix: string) => string

  constructor(protected readonly options: GraphSchedulerOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.leaseManager = new GraphAttemptLeaseManager({
      writes: options.writes,
      config: options.config
    })
    let next = 0
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Date.now()}_${++next}`)
  }

  protected retryReady(runId: string, nodeId: string): boolean {
    return (this.retryNotBefore.get(`${runId}:${nodeId}`) ?? 0) <= Date.now()
  }

  async cancelRun(
    runId: string,
    disposition: 'pause' | 'cancel' = 'pause'
  ): Promise<number> {
    this.fencedRuns.add(runId)
    if (disposition === 'cancel') this.cancellingRuns.add(runId)
    else this.cancellingRuns.delete(runId)
    const attempts = [...this.active.values()].filter((attempt) => attempt.runId === runId)
    for (const attempt of attempts) attempt.abort.abort()
    await Promise.allSettled(attempts.map((attempt) => attempt.promise))
    if (disposition === 'cancel') this.stopRunLeaseHeartbeats(runId)
    return attempts.length
  }

  protected activateRun(runId: string): void {
    this.fencedRuns.delete(runId)
    this.cancellingRuns.delete(runId)
  }

  async resumeRun(runId: string): Promise<void> {
    this.activateRun(runId)
    await this.tick().catch((error) => {
      console.warn(`[kun] Graph scheduler wake failed: ${errorMessage(error)}`)
    })
  }

  protected async scheduleNode(runId: string, nodeId: string): Promise<boolean> {
    const delegation = this.options.delegation()
    if (!delegation?.enabled()) {
      let awaitingSupervision = false
      await this.withRunQueue(runId, async () => {
        const run = await this.requireRun(runId)
        if (run.status !== 'running' && run.status !== 'awaiting_supervision') return
        if (run.status === 'running') {
          await this.transitionRun(
            run,
            'awaiting_supervision',
            'Subagent runtime is temporarily unavailable.'
          )
        }
        awaitingSupervision = true
      })
      if (awaitingSupervision) {
        await this.requestSupervision(
          runId,
          'recovery',
          [nodeId],
          'Subagent runtime is unavailable; the GraphRun is awaiting remediation.'
        )
      }
      return false
    }
    let writeLease: GraphPathLease | undefined
    let preparation: {
      run: GraphRunV1
      nodeId: string
      attempt: GraphNodeAttemptV1
      lease: GraphPathLease
    } | null
    try {
      preparation = await this.withRunQueue(runId, async () => {
      let run = await this.requireRun(runId)
      const node = run.nodes[nodeId]
      if (!node || node.status !== 'ready') return null
      run = await this.deliverSteering(run, nodeId)
      const currentNode = run.nodes[nodeId]
      const maxAttempts = effectiveNodeMaxAttempts(run, currentNode, this.options.config())
      if (currentIterationAttemptCount(currentNode) >= maxAttempts) {
        await this.transitionNode(
          run,
          nodeId,
          'failed',
          `node attempt limit exhausted before admission (${maxAttempts})`
        )
        return null
      }
      if (effectiveRunAttemptCount(run) >= totalAttemptLimit(run)) {
        run = await this.failForBudget(run, 'attempt budget exhausted')
        return null
      }
      const assignment = await resolveGraphAttemptAssignment(this.options, run, node)
      const attemptId = this.nextId('graph_attempt')
      const attemptNumber = node.attempts.length + 1
      const writeClaim = await this.options.writes.acquire({
        runId,
        nodeId,
        attemptId,
        workspaceRoot: assignment.workspaceRoot,
        scopes: assignment.writeScopes
      })
      if (!writeClaim.acquired) {
        await this.requestSupervision(
          runId,
          'conflict',
          [nodeId],
          `Write scopes are waiting on ${writeClaim.conflicts.length} active lease(s).`
        )
        return null
      }
      writeLease = writeClaim.lease
      const attempt: GraphNodeAttemptV1 = {
        version: GRAPH_CONTRACT_VERSION,
        id: attemptId,
        runId,
        nodeId,
        revision: run.currentRevision,
        attemptNumber,
        iteration: node.loopIteration,
        commandId: this.nextId('graph_command'),
        idempotencyKey: `attempt:${runId}:${nodeId}:${attemptNumber}:${node.loopIteration}`,
        status: 'queued',
        assignment: {
          ...assignment,
          workspaceRoot: writeClaim.workspaceRoot
        },
        queuedAt: this.nowIso(),
        tokenUsage: 0,
        elapsedMs: 0
      }
      run = await this.appendEventWithConflictRetry(
        run,
        { type: 'attempt_created', payload: { attempt } },
        attempt.commandId,
        attempt.idempotencyKey
      )
      return { run, nodeId, attempt, lease: writeClaim.lease }
      })
    } catch (error) {
      if (writeLease) {
        await this.options.writes.rollback(writeLease.leaseId).catch((rollbackError) => {
          console.warn(
            `[kun] Graph admission rollback failed for ${writeLease!.attemptId}: ` +
            errorMessage(rollbackError)
          )
        })
      }
      // Supervisor/review events legitimately advance the durable sequence
      // while admission is resolving authority or acquiring a write lease.
      // An optimistic conflict is therefore a retryable scheduler race, not
      // evidence that the node itself failed admission.
      if (error instanceof GraphRunConflictError) return false
      await this.handleAdmissionFailure(runId, nodeId, error)
      return false
    }
    if (!preparation) return false
    const abort = new AbortController()
    this.leaseManager.track(preparation.attempt.id, preparation.lease)
    this.leaseManager.startHeartbeat({
      runId,
      attemptId: preparation.attempt.id,
      lease: preparation.lease,
      abort,
      onRenewalFailure: (error) => {
        void this.requestSupervision(
          runId,
          'conflict',
          [nodeId],
          `Write lease renewal failed for ${preparation.attempt.id}: ${errorMessage(error)}`
        )
      }
    })
    const active: ActiveAttempt = {
      runId,
      nodeId,
      attemptId: preparation.attempt.id,
      abort,
      timeout: setTimeout(() => {
        abort.abort(new Error('Graph node wall-time budget exhausted'))
      }, preparation.attempt.assignment.maxWallTimeMs),
      deadlineAt: Date.now() + preparation.attempt.assignment.maxWallTimeMs,
      promise: Promise.resolve()
    }
    active.promise = this.executeAttempt(
      preparation.run,
      preparation.nodeId,
      preparation.attempt,
      preparation.lease,
      abort.signal
    ).catch((error) => {
      console.warn(
        `[kun] Graph attempt ${preparation.attempt.id} failed outside its state boundary: ` +
        errorMessage(error)
      )
    }).finally(() => {
      clearTimeout(active.timeout)
      this.active.delete(preparation.attempt.id)
      void this.tick().catch((error) => {
        console.warn(`[kun] Graph scheduler follow-up tick failed: ${errorMessage(error)}`)
      })
    })
    this.active.set(preparation.attempt.id, active)
    return true
  }

  private async handleAdmissionFailure(
    runId: string,
    nodeId: string,
    error: unknown
  ): Promise<void> {
    const message = `Graph node admission failed: ${errorMessage(error)}`
    let settled = false
    try {
      await this.withRunQueue(runId, async () => {
        let run = await this.requireRun(runId)
        const node = run.nodes[nodeId]
        if (
          !node ||
          node.status !== 'ready' ||
          (run.status !== 'running' && run.status !== 'awaiting_supervision')
        ) return
        run = await this.transitionNode(run, nodeId, 'failed', message)
        if (run.status === 'running') {
          await this.transitionRun(run, 'awaiting_supervision', message)
        }
        settled = true
      })
    } catch (stateError) {
      this.fencedRuns.add(runId)
      console.warn(
        `[kun] Graph admission failure could not be persisted; fenced ${runId}/${nodeId}: ` +
        errorMessage(stateError)
      )
      throw stateError
    }
    if (settled) await this.requestSupervision(runId, 'failure', [nodeId], message)
  }

  private async executeAttempt(
    initialRun: GraphRunV1,
    nodeId: string,
    attempt: GraphNodeAttemptV1,
    lease: GraphPathLease,
    signal: AbortSignal
  ): Promise<void> {
    const delegation = this.options.delegation()
    if (!delegation) return
    const context = buildGraphWorkerContext(initialRun, nodeId, this.options.config())
    let boundChildId: string | undefined
    try {
      const child = await delegation.runChild({
        parentThreadId: initialRun.threadId,
        parentTurnId: initialRun.sourceTurnId,
        launcher: 'graph',
        label: initialRun.nodes[nodeId].node.title,
        prompt: context.prompt,
        workspace: attempt.assignment.workspaceRoot,
        inheritedModel: attempt.assignment.model,
        inheritedProviderId: attempt.assignment.providerId,
        inheritedAccountId: attempt.assignment.accountId,
        inheritedReasoningEffort: attempt.assignment.reasoningEffort,
        ...(attempt.assignment.harnessId ? { harnessId: attempt.assignment.harnessId } : {}),
        ...(attempt.assignment.credentialMode ? { credentialMode: attempt.assignment.credentialMode } : {}),
        ...(attempt.assignment.gatewayBinding ? { gatewayBinding: attempt.assignment.gatewayBinding } : {}),
        approvalPolicy: attempt.assignment.approvalPolicy,
        sandboxMode: attempt.assignment.sandboxMode,
        approvalReviewer: attempt.assignment.approvalReviewer,
        inlineProfile: {
          id: attempt.assignment.profileId,
          source: attempt.assignment.profileOrigin === 'ephemeral' ? 'custom' : 'configured',
          profile: {
            name: attempt.assignment.name,
            description: initialRun.nodes[nodeId].node.objective.slice(0, 500),
            mode: 'subagent',
            model: attempt.assignment.model,
            providerId: attempt.assignment.providerId,
            systemPrompt: attempt.assignment.systemPrompt,
            toolPolicy: attempt.assignment.toolPolicy,
            ...(attempt.assignment.allowedTools.length
              ? { allowedTools: attempt.assignment.allowedTools }
              : {}),
            blockedTools: attempt.assignment.blockedTools,
            blockedSkills: attempt.assignment.blockedSkills,
            blockedMcpServers: attempt.assignment.blockedMcpServers,
            skillsEnabled: attempt.assignment.allowedSkills.length > 0,
            reasoningEffort: attempt.assignment.reasoningEffort
          }
        },
        security: graphWorkerSecuritySnapshot(attempt.assignment, context.artifactRefs),
        toolPolicyCeiling: attempt.assignment.toolPolicy === 'readOnly' ? 'readOnly' : undefined,
        // Graph owns its structured result and evidence validation. The
        // delegation runtime's `evidence` format derives evidence only from
        // successful tool calls, which incorrectly rejects valid no-tool
        // workers even when their JSON result contains explicit evidence.
        returnFormat: 'summary',
        onQueued: (childId) => {
          boundChildId = childId
          bindGraphAttemptSession(this.options, initialRun, nodeId, attempt, childId)
        },
        onRunning: async (childId) => {
          await this.withRunQueue(initialRun.id, async () => {
            let run = await this.requireRun(initialRun.id)
            if (isTerminalRunStatus(run.status)) return
            const current = findAttempt(run, nodeId, attempt.id)
            if (current.status === 'queued') {
              run = await this.transitionAttempt(
                run,
                nodeId,
                attempt.id,
                'running',
                undefined,
                undefined,
                childId
              )
            }
            if (run.nodes[nodeId].status === 'queued') {
              await this.transitionNode(run, nodeId, 'running', 'child agent started')
            }
          })
        },
        signal
      })
      if (
        signal.aborted &&
        signal.reason instanceof Error &&
        signal.reason.message === GRAPH_HOST_SHUTDOWN_ATTEMPT_FAILURE
      ) {
        throw signal.reason
      }
      await this.finishChild(initialRun.id, nodeId, attempt.id, child, lease)
    } catch (error) {
      const timedOut = signal.aborted && signal.reason instanceof Error &&
        signal.reason.message === 'Graph node wall-time budget exhausted'
      const interruptedFailure =
        signal.aborted && !timedOut && signal.reason instanceof Error
          ? signal.reason
          : error
      await this.failAttempt(
        initialRun.id,
        nodeId,
        attempt.id,
        lease,
        timedOut ? signal.reason : interruptedFailure,
        signal.aborted && !timedOut
      )
    } finally {
      if (boundChildId) this.options.workerSessions.release(boundChildId)
    }
  }

  private async finishChild(
    runId: string,
    nodeId: string,
    attemptId: string,
    child: ChildRunRecord,
    lease: GraphPathLease
  ): Promise<void> {
    if (child.status !== 'completed') {
      await this.failAttempt(
        runId,
        nodeId,
        attemptId,
        lease,
        child.error ?? `child ended with ${child.status}`,
        child.status === 'aborted'
      )
      return
    }
    let submittedSummary: string | undefined
    await this.withRunQueue(runId, async () => {
      let run = await this.requireRun(runId)
      const projection = run.nodes[nodeId]
      const attempt = findAttempt(run, nodeId, attemptId)
      if (isTerminalRunStatus(run.status)) {
        if (!isTerminalAttemptStatus(attempt.status)) {
          run = await this.transitionAttempt(run, nodeId, attemptId, 'cancelled')
        }
        const currentNode = run.nodes[nodeId]
        if (currentNode.status === 'queued' || currentNode.status === 'running') {
          await this.transitionNode(run, nodeId, 'cancelled', 'run ended before worker result')
        }
        return
      }
      if (attempt.status === 'queued') {
        run = await this.transitionAttempt(
          run,
          nodeId,
          attemptId,
          'running',
          undefined,
          undefined,
          child.id
        )
      }
      if (run.nodes[nodeId].status === 'queued') {
        run = await this.transitionNode(run, nodeId, 'running', 'child completed before running callback')
      }
      const finalized = await finalizeGraphWorkerResult({
        run,
        node: projection,
        attempt,
        child,
        writes: this.options.writes,
        verifyChecks: this.options.verifyChecks,
        existingResult: attempt.result
      })
      const { result, validation } = finalized
      run = await this.appendEventWithConflictRetry(
        run,
        {
          type: 'result_submitted',
          payload: {
            nodeId,
            attemptId,
            result,
            validation,
            tokenUsage: child.usage.totalTokens,
            elapsedMs: child.durationMs ?? 0
          }
        },
        `result_${attemptId}`,
        attempt.result ? `result-final:${attemptId}` : `result:${attemptId}`
      )
      run = await this.transitionAttempt(
        run,
        nodeId,
        attemptId,
        'submitted',
        undefined,
        undefined,
        child.id
      )
      run = await this.transitionNode(
        run,
        nodeId,
        'submitted',
        'executor result captured for source Lead review'
      )
      run = await this.updateBudget(run, {
        totalTokens: run.budget.totalTokens + child.usage.totalTokens,
        elapsedMs: Math.max(run.budget.elapsedMs, Date.now() - Date.parse(run.createdAt)),
        artifactBytes: run.budget.artifactBytes
      }, 'worker attempt completed')
      run = await this.handleAttemptSteering(run, nodeId, attemptId)
      submittedSummary = result.summary
      return run
    })
    // Do not invoke supervision while holding the scheduler's run queue.
    // Test/embedded supervisors may synchronously record a Lead review and
    // wake reconciliation; keeping the queue here would deadlock that wake.
    if (submittedSummary !== undefined) {
      try {
        await this.requestSupervision(runId, 'submitted', [nodeId], submittedSummary)
      } catch (error) {
        // The result is already durable; reconciliation can redeliver a
        // notification conflict without downgrading the submitted attempt.
        if (!(error instanceof GraphRunConflictError)) throw error
        console.warn(`[kun] Graph supervision raced durable state for ${attemptId}; ` +
          'leaving the result reviewable for reconciliation.')
      }
    }
    const latest = await this.requireRun(runId)
    if (isTerminalRunStatus(latest.status)) {
      await this.releaseWrite(attemptId, 'cancelled')
      return
    }
  }

  private async failAttempt(
    runId: string,
    nodeId: string,
    attemptId: string,
    lease: GraphPathLease,
    error: unknown,
    interrupted: boolean
  ): Promise<void> {
    await this.withRunQueue(runId, async () => {
      let run = await this.requireRun(runId)
      const attempt = findAttempt(run, nodeId, attemptId)
      if (isTerminalRunStatus(run.status)) {
        if (!isTerminalAttemptStatus(attempt.status)) {
          run = await this.transitionAttempt(run, nodeId, attemptId, 'cancelled')
        }
        const currentNode = run.nodes[nodeId]
        if (currentNode.status === 'queued' || currentNode.status === 'running') {
          await this.transitionNode(run, nodeId, 'cancelled', 'run ended while worker was active')
        }
        return
      }
      const cancelling = interrupted && this.cancellingRuns.has(runId)
      const terminal = cancelling
        ? 'cancelled'
        : interrupted || attempt.status === 'queued'
          ? 'interrupted'
          : 'failed'
      if (
        !['accepted', 'repair_required', 'failed', 'interrupted', 'cancelled', 'orphaned']
          .includes(attempt.status) &&
        (attempt.status === 'queued' || attempt.status === 'running' || attempt.status === 'waiting')
      ) {
        run = await this.transitionAttempt(
          run,
          nodeId,
          attemptId,
          terminal,
          cancelling ? undefined : interrupted ? 'interrupted' : 'retryable',
          errorMessage(error)
        )
      }
      const node = run.nodes[nodeId]
      if (node.status === 'queued' || node.status === 'running') {
        run = await this.transitionNode(
          run,
          nodeId,
          cancelling ? 'cancelled' : 'failed',
          errorMessage(error)
        )
      }
      if (!cancelling) {
        run = await this.maybeRetry(run, nodeId)
        await this.requestSupervision(run.id, 'failure', [nodeId], errorMessage(error))
      }
      return run
    })
    await this.releaseWrite(attemptId, interrupted ? 'cancelled' : 'failed')
  }

  protected async integrateWrite(attemptId: string): Promise<'applied' | 'conflict'> {
    return this.leaseManager.integrate(attemptId)
  }

  protected async releaseWrite(
    attemptId: string,
    disposition: 'failed' | 'cancelled'
  ): Promise<void> {
    await this.leaseManager.release(attemptId, disposition)
  }

  protected stopRunLeaseHeartbeats(runId: string): void {
    this.leaseManager.stopRunHeartbeats(runId)
  }

  protected stopAllLeaseHeartbeats(): void {
    this.leaseManager.stopAllHeartbeats()
  }

  protected abortOverdueAttempts(now = Date.now()): void {
    for (const attempt of this.active.values()) {
      if (attempt.deadlineAt <= now && !attempt.abort.signal.aborted) {
        attempt.abort.abort(new Error('Graph node wall-time budget exhausted'))
      }
    }
  }

  protected async maybeRetry(runInput: GraphRunV1, nodeId: string): Promise<GraphRunV1> {
    let run = runInput
    const node = run.nodes[nodeId]
    const maxAttempts = effectiveNodeMaxAttempts(run, node, this.options.config())
    const iterationAttempts = currentIterationAttemptCount(node)
    if (iterationAttempts >= maxAttempts) return run
    const delay = Math.min(30_000, 500 * 2 ** Math.max(0, iterationAttempts - 1))
    this.retryNotBefore.set(`${run.id}:${nodeId}`, Date.now() + delay)
    if (node.status === 'failed' || node.status === 'repair_required') {
      run = await this.transitionNode(
        run,
        nodeId,
        'ready',
        `retry ${node.attempts.length + 1} scheduled`
      )
    }
    return run
  }

  protected async appendEventWithConflictRetry(
    initialRun: GraphRunV1,
    event: GraphDomainEventV1,
    commandId: string,
    idempotencyKey: string
  ): Promise<GraphRunV1> {
    let run = initialRun
    for (let retry = 0; retry < 5; retry += 1) {
      try {
        return (await this.options.store.append(run.id, {
          expectedSeq: run.lastEventSeq,
          graphRevision: run.currentRevision,
          commandId,
          idempotencyKey,
          event
        })).state
      } catch (error) {
        if (!(error instanceof GraphRunConflictError) || retry === 4) throw error
        run = await this.requireRun(run.id)
      }
    }
    throw new GraphRunConflictError(
      `GraphRun ${initialRun.id} durable append retry exhausted`
    )
  }

  abstract tick(): Promise<void>
  protected abstract failForBudget(run: GraphRunV1, reason: string): Promise<GraphRunV1>
  protected abstract deliverSteering(run: GraphRunV1, nodeId: string): Promise<GraphRunV1>
  protected abstract handleAttemptSteering(
    run: GraphRunV1,
    nodeId: string,
    attemptId: string
  ): Promise<GraphRunV1>
  protected abstract updateBudget(
    run: GraphRunV1,
    fields: Partial<Pick<GraphRunV1['budget'], 'totalTokens' | 'elapsedMs' | 'artifactBytes'>>,
    reason: string
  ): Promise<GraphRunV1>
  protected abstract transitionRun(
    run: GraphRunV1,
    to: GraphRunV1['status'],
    reason: string
  ): Promise<GraphRunV1>
  protected abstract transitionNode(
    run: GraphRunV1,
    nodeId: string,
    to: GraphNodeProjectionV1['status'],
    reason: string
  ): Promise<GraphRunV1>
  protected abstract transitionAttempt(
    run: GraphRunV1,
    nodeId: string,
    attemptId: string,
    to: GraphNodeAttemptV1['status'],
    failureClass?: GraphNodeAttemptV1['failureClass'],
    normalizedFailure?: string,
    childThreadId?: string
  ): Promise<GraphRunV1>
  protected abstract requestSupervision(
    runId: string,
    reason: Parameters<GraphSupervisionPort['signal']>[0]['reason'],
    nodeIds: string[],
    digest: string
  ): Promise<void>
  protected abstract withRunQueue<T>(
    runId: string,
    operation: () => Promise<T>
  ): Promise<T>
  protected abstract requireRun(runId: string): Promise<GraphRunV1>
}
