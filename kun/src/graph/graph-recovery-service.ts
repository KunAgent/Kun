import {
  GRAPH_CONTRACT_VERSION,
  type GraphCleanupRecordV1,
  type GraphNodeAttemptV1,
  type GraphRunV1
} from '../contracts/graph.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import type { GraphSupervisionPort } from './graph-scheduler-types.js'
import type {
  GraphRunStore,
  GraphStoreDiagnostic
} from './graph-run-store.js'
import type { FileGraphWriteCoordinator } from './graph-write-coordinator.js'
import { createGraphCheckVerifier } from './graph-check-verifier.js'
import { finalizeGraphWorkerResult } from './graph-worker-result-finalizer.js'
import {
  currentIterationAttemptCount,
  effectiveNodeMaxAttempts,
  GRAPH_RUNTIME_RESTART_ATTEMPT_FAILURE
} from './graph-scheduler-policy.js'
import type { GraphSchedulerOptions } from './graph-scheduler-types.js'

export type GraphRecoveryReport = {
  runsInspected: number
  orphanedAttempts: number
  retriedNodes: number
  pausedRuns: number
  expiredLeases: number
  orphanedWorktrees: number
  orphanedChildRuns: number
  completedChildrenRecovered: number
  storeDiagnostics: GraphStoreDiagnostic[]
}

export class GraphRecoveryService {
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string
  private readonly verifyChecks: NonNullable<GraphSchedulerOptions['verifyChecks']>

  constructor(private readonly options: {
    store: GraphRunStore
    config: () => GraphRuntimeConfig
    writes: FileGraphWriteCoordinator
    delegation: () => DelegationRuntime | undefined
    verifyChecks?: GraphSchedulerOptions['verifyChecks']
    supervision?: () => GraphSupervisionPort | undefined
    nowIso?: () => string
    nextId?: (prefix: string) => string
  }) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.verifyChecks = options.verifyChecks ?? createGraphCheckVerifier()
    let next = 0
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Date.now()}_${++next}`)
  }

  async reconcile(): Promise<GraphRecoveryReport> {
    const allRuns = await this.options.store.list()
    const knownAttemptIds = new Set(allRuns.flatMap((run) =>
      Object.values(run.nodes).flatMap((node) =>
        node.attempts.map((attempt) => attempt.id))))
    const writeReport = await this.options.writes.reconcile(knownAttemptIds)
    const delegation = this.options.delegation()
    const orphanedChildRuns =
      await delegation?.reconcileOrphanedChildRuns().catch(() => 0) ?? 0
    const persistedChildren = typeof delegation?.diagnostics === 'function'
      ? await delegation.diagnostics().then((report) => report.childRuns).catch(() => [])
      : []
    const childById = new Map(persistedChildren.map((child) => [child.id, child]))
    const recoverableStatuses: GraphRunV1['status'][] = [
        'draft',
        'validating',
        'ready',
        'running',
        'pausing',
        'paused',
        'awaiting_supervision',
        'awaiting_human',
        'completing'
    ]
    const runs = allRuns.filter((run) => recoverableStatuses.includes(run.status))
    let orphanedAttempts = 0
    let completedChildrenRecovered = 0
    let retriedNodes = 0
    let pausedRuns = 0
    for (const initial of runs) {
      let run = initial
      const affected: string[] = []
      for (const node of Object.values(run.nodes)) {
        const attempt = node.attempts.at(-1)
        if (!attempt || !['queued', 'running', 'waiting'].includes(attempt.status)) continue
        const child = attempt.childThreadId
          ? childById.get(attempt.childThreadId)
          : undefined
        if (child?.status === 'completed') {
          run = await this.recoverCompletedChild(run, attempt, child)
          completedChildrenRecovered += 1
          affected.push(node.node.id)
          continue
        }
        run = await this.transitionAttemptToOrphan(run, attempt)
        orphanedAttempts += 1
        affected.push(node.node.id)
        if (node.status === 'queued' || node.status === 'running') {
          run = await this.transitionNode(run, node.node.id, 'failed', 'orphaned after runtime restart')
        }
        const recoveredNode = run.nodes[node.node.id]
        const maxAttempts = effectiveNodeMaxAttempts(
          run,
          recoveredNode,
          this.options.config()
        )
        if (
          currentIterationAttemptCount(recoveredNode) < maxAttempts &&
          run.status !== 'paused'
        ) {
          run = await this.transitionNode(run, node.node.id, 'ready', 'recovered for idempotent retry')
          retriedNodes += 1
        }
        run = await this.recordCleanup(run, {
          resourceKind: 'worker',
          resourceId: attempt.childThreadId ?? attempt.id,
          attemptId: attempt.id,
          state: 'orphaned',
          lastError: 'Child execution was not live after runtime restart.'
        })
      }
      if (affected.length) {
        await this.options.supervision?.()?.signal({
          runId: run.id,
          reason: 'recovery',
          nodeIds: affected,
          digest: `${affected.length} persisted attempt(s) were reconciled after restart.`
        })
      }
      if (run.status === 'pausing') {
        run = await this.transitionRun(run, 'paused', 'completed interrupted pause during recovery')
        pausedRuns += 1
      }
      await this.options.store.snapshot(run.id)
    }
    return {
      runsInspected: runs.length,
      orphanedAttempts,
      completedChildrenRecovered,
      retriedNodes,
      pausedRuns,
      expiredLeases: writeReport.expiredLeases,
      orphanedWorktrees: writeReport.orphanedWorktrees,
      orphanedChildRuns,
      storeDiagnostics: await this.options.store.diagnostics?.() ?? []
    }
  }

  private async recoverCompletedChild(
    initialRun: GraphRunV1,
    initialAttempt: GraphNodeAttemptV1,
    child: Awaited<ReturnType<DelegationRuntime['diagnostics']>>['childRuns'][number]
  ): Promise<GraphRunV1> {
    let run = initialRun
    let attempt = run.nodes[initialAttempt.nodeId]!.attempts.find((entry) =>
      entry.id === initialAttempt.id)!
    if (attempt.status === 'queued') {
      run = (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: this.nextId('graph_recovery'),
        idempotencyKey: `recovery:child-running:${attempt.id}`,
        event: {
          type: 'attempt_status_changed',
          payload: {
            nodeId: attempt.nodeId,
            attemptId: attempt.id,
            from: 'queued',
            to: 'running',
            childThreadId: child.id
          }
        }
      })).state
    }
    const node = run.nodes[attempt.nodeId]!
    if (node.status === 'queued') {
      run = await this.transitionNode(
        run,
        node.node.id,
        'running',
        'completed child recovered after runtime restart'
      )
    }
    attempt = run.nodes[initialAttempt.nodeId]!.attempts.find((entry) =>
      entry.id === initialAttempt.id)!
    let recoveredResult = false
    if (!attempt.result) {
      const finalized = await finalizeGraphWorkerResult({
        run,
        node: run.nodes[attempt.nodeId]!,
        attempt,
        child,
        writes: this.options.writes,
        verifyChecks: this.verifyChecks
      })
      const { result, validation } = finalized
      run = (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: this.nextId('graph_recovery'),
        idempotencyKey: `recovery:result:${attempt.id}`,
        event: {
          type: 'result_submitted',
          payload: {
            nodeId: attempt.nodeId,
            attemptId: attempt.id,
            result,
            validation,
            tokenUsage: child.usage.totalTokens,
            elapsedMs: child.durationMs ?? 0
          }
        }
      })).state
      recoveredResult = true
    }
    attempt = run.nodes[initialAttempt.nodeId]!.attempts.find((entry) =>
      entry.id === initialAttempt.id)!
    if (attempt.status === 'running' || attempt.status === 'waiting') {
      run = (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: this.nextId('graph_recovery'),
        idempotencyKey: `recovery:child-submitted:${attempt.id}`,
        event: {
          type: 'attempt_status_changed',
          payload: {
            nodeId: attempt.nodeId,
            attemptId: attempt.id,
            from: attempt.status,
            to: 'submitted',
            childThreadId: child.id
          }
        }
      })).state
    }
    const currentNode = run.nodes[attempt.nodeId]!
    if (currentNode.status === 'running') {
      run = await this.transitionNode(
        run,
        currentNode.node.id,
        'submitted',
        'persisted child result recovered after runtime restart'
      )
    }
    if (recoveredResult && child.usage.totalTokens > 0) {
      const ledger = {
        ...run.budget,
        totalTokens: run.budget.totalTokens + child.usage.totalTokens,
        elapsedMs: Math.max(run.budget.elapsedMs, child.durationMs ?? 0)
      }
      run = (await this.options.store.append(run.id, {
        expectedSeq: run.lastEventSeq,
        graphRevision: run.currentRevision,
        commandId: this.nextId('graph_recovery'),
        idempotencyKey: `recovery:usage:${attempt.id}`,
        event: {
          type: 'budget_updated',
          payload: { ledger, reason: 'recovered persisted child usage' }
        }
      })).state
    }
    return run
  }

  private async transitionAttemptToOrphan(
    run: GraphRunV1,
    attempt: GraphNodeAttemptV1
  ): Promise<GraphRunV1> {
    return (await this.options.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: this.nextId('graph_recovery'),
      idempotencyKey: `recovery:orphan:${attempt.id}`,
      event: {
        type: 'attempt_status_changed',
        payload: {
          nodeId: attempt.nodeId,
          attemptId: attempt.id,
          from: attempt.status,
          to: 'orphaned',
          failureClass: 'interrupted',
          normalizedFailure: GRAPH_RUNTIME_RESTART_ATTEMPT_FAILURE
        }
      }
    })).state
  }

  private async transitionNode(
    run: GraphRunV1,
    nodeId: string,
    to: GraphRunV1['nodes'][string]['status'],
    reason: string
  ): Promise<GraphRunV1> {
    const from = run.nodes[nodeId].status
    return (await this.options.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: this.nextId('graph_recovery'),
      idempotencyKey: `recovery:node:${run.id}:${nodeId}:${from}:${to}`,
      event: {
        type: 'node_status_changed',
        payload: { nodeId, from, to, reason }
      }
    })).state
  }

  private async transitionRun(
    run: GraphRunV1,
    to: GraphRunV1['status'],
    reason: string
  ): Promise<GraphRunV1> {
    return (await this.options.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: this.nextId('graph_recovery'),
      idempotencyKey: `recovery:run:${run.id}:${run.status}:${to}`,
      event: {
        type: 'run_status_changed',
        payload: { from: run.status, to, reason }
      }
    })).state
  }

  private async recordCleanup(
    run: GraphRunV1,
    input: Pick<
      GraphCleanupRecordV1,
      'resourceKind' | 'resourceId' | 'attemptId' | 'state' | 'lastError'
    >
  ): Promise<GraphRunV1> {
    const cleanup: GraphCleanupRecordV1 = {
      version: GRAPH_CONTRACT_VERSION,
      id: this.nextId('graph_cleanup'),
      runId: run.id,
      ...input,
      retryCount: 0,
      updatedAt: this.nowIso()
    }
    return (await this.options.store.append(run.id, {
      expectedSeq: run.lastEventSeq,
      graphRevision: run.currentRevision,
      commandId: this.nextId('graph_recovery'),
      idempotencyKey: `recovery:cleanup:${run.id}:${input.resourceKind}:${input.resourceId}`,
      event: { type: 'cleanup_updated', payload: { cleanup } }
    })).state
  }
}
