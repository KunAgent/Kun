import { join } from 'node:path'
import { buildGraphModeLocalTools } from '../adapters/tool/graph-mode-tool-provider.js'
import { emitPlanningEvent } from '../adapters/tool/graph-define-plan-tool.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { ManagerRemoteGraphRunStore } from '../manager/remote-data-stores.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type { GraphRunV1 } from '../contracts/graph.js'
import type { ThreadStatus } from '../contracts/threads.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import {
  FileGraphRunStore,
  FileGraphPlanningDraftStore,
  FileGraphThreadReferenceStore,
  FileGraphWriteCoordinator,
  FileProjectAgentRegistry,
  GraphAssignmentResolver,
  GraphControlService,
  GraphLearningService,
  GraphMailbox,
  GraphPlanningDraftConflictError,
  GraphRecoveryService,
  GraphRetentionService,
  GraphRunConflictError,
  GraphScheduler,
  GraphSupervisor,
  GraphWorkerSessionRegistry,
  graphPhysicalPathsEqual,
  type GraphLeadDeliveryResult,
  type GraphParentAuthority,
  type GraphRunStore
} from '../graph/index.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { createGraphCheckVerifier } from '../graph/graph-check-verifier.js'
import {
  isGraphRunCompletionFinalizing,
  isGraphRunSemanticComplete
} from '../graph/graph-run-completion.js'
import {
  recoverGraphLeadOwnership,
  recoverGraphPlanningCommits
} from './graph-runtime-recovery.js'

export type GraphRuntimeStartOptions = {
  delegation: () => DelegationRuntime | undefined
  steerTurn?: (input: {
    threadId: string
    turnId: string
    text: string
    displayText?: string
    messageSource?: 'graph_runtime'
  }) => Promise<void>
  leadTurn: (input: {
    run: GraphRunV1
    reasons: string[]
    nodeIds: string[]
    digest: string
  }) => Promise<GraphLeadDeliveryResult | void>
  isLeadTurnActive?: (run: GraphRunV1) => boolean
  authorityForRun: (run: GraphRunV1) => Promise<GraphParentAuthority> | GraphParentAuthority
}

export class GraphRuntimeComposition {
  readonly store: GraphRunStore
  readonly drafts: FileGraphPlanningDraftStore
  readonly writes: FileGraphWriteCoordinator
  readonly control: GraphControlService
  readonly references: FileGraphThreadReferenceStore
  readonly registry: FileProjectAgentRegistry
  readonly mailbox: GraphMailbox
  readonly assignments: GraphAssignmentResolver
  readonly workerSessions = new GraphWorkerSessionRegistry()
  readonly learning: GraphLearningService
  readonly retention: GraphRetentionService
  readonly toolsProvider
  scheduler!: GraphScheduler
  supervisor!: GraphSupervisor
  recovery!: GraphRecoveryService
  private readonly backgroundTasks = new Set<Promise<unknown>>()
  private delegation?: GraphRuntimeStartOptions['delegation']
  private steerChildTurn?: GraphRuntimeStartOptions['steerTurn']
  private retentionTimer?: NodeJS.Timeout

  constructor(private readonly options: {
    dataDir: string
    config: () => GraphRuntimeConfig
    artifactStore: ArtifactStore
    runtimeEvents: Pick<RuntimeEventRecorder, 'record'>
    threadStore: Pick<ThreadStore, 'get'>
    sessionStore?: Pick<SessionStore, 'loadItems'>
    ids: IdGenerator
    nowIso: () => string
    serviceManager?: ServiceManagerConnection
  }) {
    const nextId = (prefix: string): string => options.ids.next(prefix)
    this.store = options.serviceManager
      ? new ManagerRemoteGraphRunStore(options.serviceManager, options.config)
      : new FileGraphRunStore({
          rootDir: join(options.dataDir, 'graphs'),
          config: options.config,
          artifactStore: options.artifactStore,
          runtimeEvents: options.runtimeEvents,
          nowIso: options.nowIso,
          nextId
        })
    this.drafts = new FileGraphPlanningDraftStore({
      rootDir: join(options.dataDir, 'graph-planning'),
      nowIso: options.nowIso
    })
    this.writes = new FileGraphWriteCoordinator({
      rootDir: join(options.dataDir, 'graph-resources'),
      config: options.config,
      artifactStore: options.artifactStore,
      nowIso: options.nowIso,
      nextId
    })
    this.control = new GraphControlService({
      store: this.store,
      config: options.config,
      authorizeCreate: async (input) => {
        const thread = await options.threadStore.get(input.threadId)
        if (!thread || thread.status === 'deleted') {
          throw new GraphRunConflictError(
            `GraphRun parent thread is unavailable: ${input.threadId}`
          )
        }
        if (thread.status === 'archived') {
          throw new GraphRunConflictError(
            `cannot create a GraphRun for archived thread ${input.threadId}`
          )
        }
        const sourceTurn = thread.turns.find((turn) => turn.id === input.sourceTurnId)
        if (!sourceTurn) {
          throw new GraphRunConflictError(
            `GraphRun source turn does not belong to thread ${input.threadId}`
          )
        }
        if (sourceTurn.orchestration !== 'graph') {
          throw new GraphRunConflictError(
            `GraphRun source turn is not authorized for Graph orchestration`
          )
        }
        if (sourceTurn.status !== 'running') {
          throw new GraphRunConflictError(
            `GraphRun source turn is not active: ${input.sourceTurnId}`
          )
        }
        const [threadIdentity, planIdentity] = await Promise.all([
          this.registry.identify(thread.workspace),
          this.registry.identify(input.plan.workspaceRoot)
        ])
        if (
          !graphPhysicalPathsEqual(
            threadIdentity.canonicalWorkspaceRoot,
            planIdentity.canonicalWorkspaceRoot
          ) ||
          threadIdentity.projectId !== planIdentity.projectId
        ) {
          throw new GraphRunConflictError(
            'GraphRun plan workspace must match the parent thread workspace'
          )
        }
        if (input.projectId !== threadIdentity.projectId) {
          throw new GraphRunConflictError(
            'GraphRun project id does not match the canonical parent workspace'
          )
        }
      },
      pauseActive: async (run) => {
        await this.scheduler?.cancelRun(run.id, 'pause')
      },
      cancelActive: async (run) => {
        await this.scheduler?.cancelRun(run.id, 'cancel')
      },
      resumeActive: (run) => this.scheduler?.resumeRun(run.id),
      onSteering: (run, steering) => this.supervisor?.signal({
        runId: run.id,
        reason: 'user_steering',
        nodeIds:
          steering.target.kind === 'node' || steering.target.kind === 'attempt'
            ? [steering.target.nodeId]
            : [],
        digest: steering.text
      }),
      onCancelled: (run, reason) => this.supervisor?.signal({
        runId: run.id,
        reason: 'completion',
        nodeIds: [],
        digest: reason
          ? `GraphRun was cancelled: ${reason}`
          : 'GraphRun was cancelled.'
      }),
      cleanupResources: (run) => this.writes.cleanupRun(run.id),
      nowIso: options.nowIso,
      nextId
    })
    this.references = new FileGraphThreadReferenceStore({
      path: join(options.dataDir, 'graphs', 'thread-references.json'),
      runs: this.store,
      nowIso: options.nowIso,
      nextId
    })
    this.registry = new FileProjectAgentRegistry({
      rootDir: join(options.dataDir, 'project-agents'),
      config: options.config,
      nowIso: options.nowIso,
      nextId
    })
    this.mailbox = new GraphMailbox({
      store: this.store,
      config: options.config,
      nowIso: options.nowIso
    })
    this.assignments = new GraphAssignmentResolver({
      registry: this.registry,
      nowIso: options.nowIso
    })
    this.learning = new GraphLearningService({
      rootDir: join(options.dataDir, 'graph-learning'),
      config: options.config,
      registry: this.registry,
      nowIso: options.nowIso,
      nextId
    })
    this.retention = new GraphRetentionService({
      runs: this.store,
      references: this.references,
      registry: this.registry,
      learning: this.learning,
      artifacts: options.artifactStore,
      config: options.config,
      nowIso: options.nowIso
    })
    this.toolsProvider = {
      id: 'graph-mode',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      effects: {
        network: false,
        externalWrite: false,
        processExecution: false,
        guiAutomation: false
      },
      tools: buildGraphModeLocalTools({
        control: this.control,
        store: this.store,
        mailbox: this.mailbox,
        registry: this.registry,
        artifactStore: options.artifactStore,
        workerSessions: this.workerSessions,
        drafts: this.drafts,
        events: options.runtimeEvents,
        threads: options.threadStore,
        sessions: options.sessionStore,
        steerChildTurn: () => this.steerChildTurn,
        childActivity: async (parentThreadId, childThreadId) => {
          const runtime = this.delegation?.()
          if (!runtime) return undefined
          const record = (await runtime.diagnostics(parentThreadId)).childRuns
            .find((child) => child.id === childThreadId)
          return record
            ? {
                status: record.status,
                ...(record.activity ? { activity: record.activity } : {}),
                updatedAt: record.updatedAt
              }
            : undefined
        },
        config: options.config,
        enabled: () => options.config().enabled,
        signalSupervision: (input) => this.supervisor?.signal(input),
        nowIso: options.nowIso,
        nextId
      })
    }
  }

  async createPlanningDraft(input: {
    threadId: string
    sourceTurnId: string
    goal: string
    workspace?: string
  }) {
    if (!input.workspace?.trim()) {
      throw new GraphRunConflictError('Graph planning requires a workspace')
    }
    const identity = await this.registry.identify(input.workspace)
    const draft = await this.drafts.create({
      id: this.options.ids.next('graph_draft'),
      reservedRunId: this.control.allocateId('graph_run'),
      threadId: input.threadId,
      sourceTurnId: input.sourceTurnId,
      projectId: identity.projectId,
      goal: input.goal
    })
    await emitPlanningEvent({
      drafts: this.drafts,
      events: this.options.runtimeEvents
    }, draft, 'draft_created').catch((error) => {
      console.warn(
        `[kun] Graph draft_created projection failed for ${draft.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    })
    await emitPlanningEvent({
      drafts: this.drafts,
      events: this.options.runtimeEvents
    }, draft, 'inspection_started').catch((error) => {
      console.warn(
        `[kun] Graph inspection_started projection failed for ${draft.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    })
    return planningLifecycle(draft)
  }

  async resolvePlanningDraft(input: {
    threadId: string
    sourceTurnId: string
  }) {
    const draft = await this.drafts.findBySourceTurn(input.sourceTurnId)
    if (!draft || draft.threadId !== input.threadId) return null
    return planningLifecycle(draft)
  }

  async transitionPlanningDraft(input: {
    threadId: string
    sourceTurnId: string
    action: 'suspend' | 'resume' | 'cancel'
  }) {
    const target =
      input.action === 'cancel'
        ? 'cancelled'
        : input.action === 'resume'
          ? 'planning'
          : 'needs_correction'
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.drafts.findBySourceTurn(input.sourceTurnId)
      if (!current || current.threadId !== input.threadId) return null
      if (
        current.status === 'committed' ||
        current.status === 'cancelled' ||
        current.status === 'host_error'
      ) {
        return planningLifecycle(current)
      }
      if (current.status === target) return planningLifecycle(current)
      try {
        const next = await this.drafts.update(current.id, {
          expectedRevision: current.revision,
          status: target,
          issues: current.issues
        })
        await emitPlanningEvent({
          drafts: this.drafts,
          events: this.options.runtimeEvents
        }, next).catch((error) => {
          console.warn(
            `[kun] Graph planning event delivery failed after durable revision ` +
            `${next.id}@${next.revision}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        })
        return planningLifecycle(next)
      } catch (error) {
        if (
          input.action !== 'cancel' ||
          !(error instanceof GraphPlanningDraftConflictError) ||
          attempt === 7
        ) throw error
      }
    }
    return null
  }

  async handleThreadFork(sourceThreadId: string, targetThreadId: string): Promise<void> {
    await this.references.fork(sourceThreadId, targetThreadId)
  }

  async handleThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
    if (status !== 'archived') return
    const runs = await this.store.list({ threadId })
    for (const run of runs) {
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        continue
      }
      const paused = await this.control.pause(run.id, {
        commandId: this.options.ids.next('graph_archive'),
        idempotencyKey: `archive:${threadId}:${run.id}:${run.lastEventSeq}`
      })
      if (
        paused.status !== 'paused' &&
        paused.status !== 'completed' &&
        paused.status !== 'failed' &&
        paused.status !== 'cancelled'
      ) {
        throw new GraphRunConflictError(
          `archiving thread ${threadId} did not settle GraphRun ${run.id}`
        )
      }
    }
  }

  async cancelThreadRuns(threadId: string): Promise<void> {
    const runs = await this.store.list({ threadId })
    for (const run of runs) {
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        continue
      }
      await this.control.cancel(run.id, {
        commandId: this.options.ids.next('graph_delete'),
        idempotencyKey: `delete:${threadId}:${run.id}:${run.lastEventSeq}`,
        reason: 'owning thread was deleted'
      })
    }
  }

  /**
   * Explicit user Stop / interruptTurn fence. Always cancels owned nonterminal
   * GraphRuns before the source turn is persisted as aborted. Do not use for
   * incidental Lead settlement (model failure, approval expiry, normal
   * completed turn) — call {@link handleSourceTurnTerminal} without force.
   */
  async cancelSourceTurnRunsExplicitly(
    threadId: string,
    sourceTurnId: string
  ): Promise<void> {
    await this.handleSourceTurnTerminal(threadId, sourceTurnId, 'aborted', {
      forceCancel: true
    })
  }

  async handleSourceTurnTerminal(
    threadId: string,
    sourceTurnId: string,
    status: 'completed' | 'failed' | 'aborted',
    options: { forceCancel?: boolean } = {}
  ): Promise<void> {
    const runs = await this.store.list({ threadId })
    for (const run of runs) {
      if (
        run.sourceTurnId !== sourceTurnId ||
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      ) {
        continue
      }
      if (
        options.forceCancel !== true &&
        isGraphRunSemanticComplete(run)
      ) {
        // Incidental settlement: never cancel semantically finished work.
        // resumeRun only auto-finishes when finalization is also safe
        // (no mailbox / human / scheduler holds). Explicit Stop uses
        // forceCancel and must not take this branch (#1071).
        if (isGraphRunCompletionFinalizing(run, this.mailbox)) {
          await this.scheduler?.resumeRun(run.id)
        }
        continue
      }
      try {
        await this.control.cancel(run.id, {
          commandId: this.options.ids.next(
            options.forceCancel === true
              ? 'graph_source_turn_stop'
              : 'graph_source_turn_terminal'
          ),
          idempotencyKey: options.forceCancel === true
            ? `source-turn-stop:${threadId}:${sourceTurnId}:${run.id}`
            : `source-turn-terminal:${threadId}:${sourceTurnId}:${run.id}:${status}`,
          reason: options.forceCancel === true
            ? 'user interrupted the owning source turn'
            : `owning source turn ended with status ${status}`
        })
      } catch (error) {
        // Completion may win after list() but before cancel(). That is already
        // a valid terminal fence for Stop; only a still-live run is an error.
        const latest = await this.store.get(run.id)
        if (
          latest?.status === 'completed' ||
          latest?.status === 'failed' ||
          latest?.status === 'cancelled'
        ) continue
        throw error
      }
    }
  }

  async start(options: GraphRuntimeStartOptions): Promise<void> {
    const nextId = (prefix: string): string => this.options.ids.next(prefix)
    this.delegation = options.delegation
    this.steerChildTurn = options.steerTurn
    this.supervisor = new GraphSupervisor({
      store: this.store,
      config: this.options.config,
      delegation: options.delegation,
      leadTurn: async (input) => {
        const thread = await this.options.threadStore.get(input.run.threadId)
        const sourceTurn = thread?.turns.find((turn) =>
          turn.id === input.run.sourceTurnId)
        if (sourceTurn?.status !== 'running') {
          return input.run.status === 'completed' ||
            input.run.status === 'failed' ||
            input.run.status === 'cancelled'
            ? { status: 'terminal' as const }
            : {
                status: 'orphaned' as const,
                reason: sourceTurn
                  ? `Graph source turn ${sourceTurn.id} is ${sourceTurn.status}`
                  : `Graph source turn not found: ${input.run.sourceTurnId}`
              }
        }
        const delivery = await options.leadTurn(input)
        return delivery ?? {
          status: 'delivered' as const,
          sourceTurnId: input.run.sourceTurnId,
          deliveredSeq: input.run.lastEventSeq,
          executionActive: options.isLeadTurnActive?.(input.run) ?? false
        }
      },
      isLeadTurnActive: options.isLeadTurnActive,
      nowIso: this.options.nowIso,
      nextId
    })
    this.scheduler = new GraphScheduler({
      store: this.store,
      config: this.options.config,
      delegation: options.delegation,
      registry: this.registry,
      assignments: this.assignments,
      mailbox: this.mailbox,
      writes: this.writes,
      workerSessions: this.workerSessions,
      authorityForRun: options.authorityForRun,
      artifactStore: this.options.artifactStore,
      verifyChecks: createGraphCheckVerifier(),
      supervision: () => this.supervisor,
      nowIso: this.options.nowIso,
      nextId,
      onTerminal: (run) => {
        this.trackBackground(
          `Graph learning capture failed for ${run.id}`,
          this.learning.capture(run)
        )
      }
    })
    this.recovery = new GraphRecoveryService({
      store: this.store,
      config: this.options.config,
      writes: this.writes,
      delegation: options.delegation,
      supervision: () => this.supervisor,
      nowIso: this.options.nowIso,
      nextId
    })
    await this.recovery.reconcile()
    const recoveredReadyRunIds = await recoverGraphPlanningCommits({
      store: this.store,
      drafts: this.drafts,
      control: this.control,
      runtimeEvents: this.options.runtimeEvents,
      ids: this.options.ids
    })
    for (const runId of recoveredReadyRunIds) {
      const run = await this.store.get(runId)
      if (run?.status !== 'ready') continue
      await this.control.start(run.id, {
        commandId: this.options.ids.next('graph_plan_recovery_start'),
        idempotencyKey: `graph-plan-recovery-start:${run.id}`
      })
    }
    await recoverGraphLeadOwnership({
      store: this.store,
      drafts: this.drafts,
      supervisor: this.supervisor,
      config: this.options.config,
      threadStore: this.options.threadStore,
      handleSourceTurnTerminal: (threadId, sourceTurnId, status) =>
        this.handleSourceTurnTerminal(threadId, sourceTurnId, status)
    })
    this.supervisor.start()
    this.scheduler.start()
    this.learning.start()
    this.trackBackground('Graph retention failed', this.runRetention())
    this.retentionTimer = setInterval(() => {
      this.trackBackground('Graph retention failed', this.runRetention())
    }, 6 * 60 * 60 * 1_000)
    this.retentionTimer.unref?.()
  }

  async reconfigureBackgroundServices(): Promise<void> {
    this.supervisor?.reconfigure()
    if (!this.options.config().enabled) {
      const runs = await this.store.list()
      for (const run of runs) {
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          continue
        }
        await this.control.pause(run.id, {
          commandId: this.options.ids.next('graph_disable'),
          idempotencyKey: `disable:${run.id}:${run.lastEventSeq}`
        })
      }
    }
    await this.learning.reconfigure()
  }

  async stop(): Promise<void> {
    if (this.retentionTimer) clearInterval(this.retentionTimer)
    this.retentionTimer = undefined
    await this.supervisor?.stop()
    await this.quiesceExecution()
    await this.learning.stop()
    await Promise.allSettled([...this.backgroundTasks])
  }

  /**
   * Stop Graph worker admission and durably classify active attempts before
   * source Lead turns are parked. Unlike stop(), this never waits for a Lead
   * queue, so host shutdown cannot deadlock behind an active Lead.
   */
  async quiesceExecution(): Promise<void> {
    this.supervisor?.quiesceReviews()
    await this.scheduler?.stop()
  }

  private async runRetention(): Promise<void> {
    await this.retention.run()
  }

  private trackBackground(label: string, operation: Promise<unknown>): void {
    const tracked = operation.catch((error) => {
      console.warn(`[kun] ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`)
    }).finally(() => {
      this.backgroundTasks.delete(tracked)
    })
    this.backgroundTasks.add(tracked)
  }
}

function planningLifecycle(draft: import('../contracts/graph.js').GraphPlanningDraftV1) {
  return {
    version: 1 as const,
    draftId: draft.id,
    reservedRunId: draft.reservedRunId,
    state: draft.status,
    draftRevision: draft.revision
  }
}
