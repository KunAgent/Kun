import { createImmutablePrefix, type ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { PipelineStage } from '../contracts/events.js'
import { makeUserItem } from '../domain/item.js'
import { ThreadItemProjectionService } from '../services/thread-item-projection.js'
import type {
  ModelRoundOutcome,
  ToolDispatchInput,
  ToolDispatchOutcome,
  TurnExecutionFailure,
  TurnRunOutcome
} from './turn-execution-types.js'
import { ModelRoutingService } from './model-routing-service.js'
import { HistoryCompactionService } from './history-compaction-service.js'
import { ToolStormBreaker } from './tool-storm-breaker.js'
import { LoopTelemetry } from './loop-telemetry.js'
import { ModelRoundEngine } from './model-round-engine.js'
import { InteractiveToolBridge } from './interactive-tool-bridge.js'
import { TurnContextResolver } from './turn-context-resolver.js'
import { ThreadTitleService } from './thread-title-service.js'
import { TurnBudgetGate } from './turn-budget-gate.js'
import { TurnAttachmentService } from './turn-attachment-service.js'
import { ToolExecutionService } from './tool-execution-service.js'
import { ToolCallDispatcher } from './tool-call-dispatcher.js'
import { RoundOutcomeCoordinator } from './round-outcome-coordinator.js'
import { createToolExecutionContext } from './tool-context-factory.js'
import {
  GoalTurnCoordinator
} from './goal-turn-coordinator.js'
import {
  InterruptedTurnCoordinator
} from './interrupted-turn-coordinator.js'
import {
  type TurnLifecycleHookDeps
} from './turn-lifecycle-hooks.js'
import {
  ModelStepService,
  type ModelStepServiceDeps
} from './model-step-service.js'
import { normalizeTurnLimits } from './turn-limits.js'
import type { AgentLoopOptions } from './agent-loop-options.js'

const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  setup: 'Setup',
  pre_start: 'Pre-Start',
  post_start: 'Post-Start',
  input_received: 'Input Received',
  input_cached: 'Input Cached',
  input_routed: 'Input Routed',
  input_compressed: 'Input Compressed',
  input_remembered: 'Input Remembered',
  pre_send: 'Pre-Send',
  post_send: 'Post-Send',
  response_received: 'Response Received'
}

export abstract class AgentLoopBase {
  protected readonly opts: AgentLoopOptions
  protected readonly modelRouting: ModelRoutingService
  protected readonly toolStormBreakers = new Map<string, ToolStormBreaker>()
  protected readonly telemetry: LoopTelemetry
  protected readonly threadItems: ThreadItemProjectionService
  protected readonly historyCompaction: HistoryCompactionService
  protected readonly modelRoundEngine: ModelRoundEngine
  protected readonly modelSteps: ModelStepService
  protected readonly roundOutcome: RoundOutcomeCoordinator
  protected readonly threadTitle: ThreadTitleService
  protected readonly budgetGate: TurnBudgetGate
  protected readonly turnAttachments: TurnAttachmentService
  protected readonly turnContextResolver: TurnContextResolver
  protected readonly interactiveToolBridge: InteractiveToolBridge
  protected readonly toolExecution: ToolExecutionService
  protected readonly toolCallDispatcher: ToolCallDispatcher
  protected readonly turnFailures = new Map<string, TurnExecutionFailure>()
  /**
   * One owned runner per turn. Calls made under the same execution lease share
   * the exact promise; a Graph wake-up that has already acquired a new lease
   * may chain its continuation behind the runner that is still parking.
   */
  protected readonly activeTurnRuns = new Map<string, {
    promise: Promise<TurnRunOutcome>
    signal: AbortSignal | undefined
  }>()
  protected readonly goalTurns: GoalTurnCoordinator
  protected readonly interruptedTurns: InterruptedTurnCoordinator

  abstract runTurn(threadId: string, turnId: string): Promise<TurnRunOutcome>

  constructor(opts: AgentLoopOptions) {
    this.opts = opts
    this.telemetry = new LoopTelemetry()
    this.threadItems = new ThreadItemProjectionService({
      threadStore: opts.threadStore,
      sessionStore: opts.sessionStore,
      nowIso: opts.nowIso
    })
    this.historyCompaction = new HistoryCompactionService({
      sessionStore: opts.sessionStore,
      compactor: opts.compactor,
      prefix: opts.prefix,
      model: opts.model,
      usage: opts.usage,
      events: opts.events,
      ids: opts.ids,
      telemetry: this.telemetry,
      recordGoalUsage: (threadId, tokens) => this.recordGoalUsage(threadId, tokens),
      getContextCompaction: () => opts.contextCompaction,
      getHooks: () => opts.hooks,
      clearReadTracker: (threadId?: string) => opts.toolHost.clearReadTracker?.(threadId),
      rewriteThreadItemsFromSession: (threadId) => this.threadItems.syncFromSession(threadId)
    })
    this.turnAttachments = new TurnAttachmentService(() => opts.attachmentStore)
    this.modelRouting = new ModelRoutingService(opts.model)
    this.threadTitle = new ThreadTitleService({
      threadStore: opts.threadStore,
      sessionStore: opts.sessionStore,
      model: opts.model,
      events: opts.events,
      nowIso: opts.nowIso,
      getRoles: () => opts.roles
    })
    this.budgetGate = new TurnBudgetGate({
      threadStore: opts.threadStore,
      turns: opts.turns,
      events: opts.events,
      usage: opts.usage,
      nowIso: opts.nowIso
    })
    this.goalTurns = new GoalTurnCoordinator({
      threadStore: opts.threadStore,
      turns: opts.turns,
      events: opts.events,
      nowIso: opts.nowIso,
      nowMs: () => opts.nowMs?.() ?? Date.now(),
      runTurn: (threadId, turnId) => this.runTurn(threadId, turnId),
      ...(opts.goalResume ? { goalResume: opts.goalResume } : {})
    })
    this.interruptedTurns = new InterruptedTurnCoordinator({
      threadStore: opts.threadStore,
      turns: opts.turns,
      events: opts.events,
      nowIso: opts.nowIso,
      nowMs: () => opts.nowMs?.() ?? Date.now(),
      runTurn: (threadId, turnId) => this.runTurn(threadId, turnId),
      ...(opts.interruptedResume ? { interruptedResume: opts.interruptedResume } : {})
    })
    this.modelRoundEngine = new ModelRoundEngine({
      model: opts.model,
      events: opts.events,
      turns: opts.turns,
      usage: opts.usage,
      telemetry: this.telemetry,
      ids: opts.ids,
      recordPipelineStage: (threadId, turnId, stage, details) =>
        this.recordPipelineStage(threadId, turnId, stage, details),
      recordGoalUsage: (threadId, tokens) => this.recordGoalUsage(threadId, tokens),
      rememberFailure: (turnId, failure) => this.rememberTurnFailure(turnId, failure),
      recordToolCallLimit: (threadId, turnId, message) =>
        this.recordTurnLimitExceeded(threadId, turnId, 'tool_call_limit_exceeded', message)
    })
    this.interactiveToolBridge = new InteractiveToolBridge({
      approvalGate: opts.approvalGate,
      userInputGate: opts.userInputGate,
      events: opts.events,
      turns: opts.turns,
      sessionStore: opts.sessionStore,
      nowIso: opts.nowIso,
      ...(opts.approvalReview ? { approvalReview: opts.approvalReview } : {})
    })
    this.toolExecution = new ToolExecutionService({
      toolHost: opts.toolHost,
      inflight: opts.inflight,
      toolCancellation: opts.toolCancellation,
      turns: opts.turns,
      events: opts.events,
      nowIso: opts.nowIso,
      ...(opts.awaitWorkspaceCheckpoint
        ? { awaitWorkspaceCheckpoint: opts.awaitWorkspaceCheckpoint }
        : {}),
      ...(opts.onPlanWritten ? { onPlanWritten: opts.onPlanWritten } : {})
    })
    this.toolCallDispatcher = new ToolCallDispatcher(this.toolExecution)
    this.roundOutcome = new RoundOutcomeCoordinator({
      sessionStore: opts.sessionStore,
      turns: opts.turns,
      events: opts.events,
      ids: opts.ids,
      dispatchToolCalls: (input) => this.dispatchToolCalls(input),
      suppressToolCalls: (input, reason) => this.toolCallDispatcher.suppressAll(input, reason),
      rememberFailure: (turnId, failure) => this.rememberTurnFailure(turnId, failure),
      hasTurnMadeProgress: (turnId) => this.goalTurns.hasMadeProgress(turnId),
      suppressGoalResume: (turnId) => this.goalTurns.suppressResume(turnId),
      ...(opts.receipts ? { receipts: opts.receipts } : {})
    })
    this.turnContextResolver = new TurnContextResolver({
      toolHost: opts.toolHost,
      resolveAttachments: (input) => this.turnAttachments.resolveTurnAttachments(input),
      ...(opts.skillRuntime ? { skillRuntime: opts.skillRuntime } : {}),
      ...(opts.instructionRuntime ? { instructionRuntime: opts.instructionRuntime } : {}),
      getMemoryStore: () => opts.memoryStore,
      interactiveToolBridge: this.interactiveToolBridge,
      ...(opts.forcedAllowedToolNames ? { forcedAllowedToolNames: opts.forcedAllowedToolNames } : {}),
      ...(opts.allowedProviderIds ? { allowedProviderIds: opts.allowedProviderIds } : {}),
      ...(opts.allowedSkillIds ? { allowedSkillIds: opts.allowedSkillIds } : {}),
      ...(opts.allowedReadPaths ? { allowedReadPaths: opts.allowedReadPaths } : {}),
      ...(opts.allowedWritePaths ? { allowedWritePaths: opts.allowedWritePaths } : {}),
      ...(opts.allowedArtifactIds ? { allowedArtifactIds: opts.allowedArtifactIds } : {}),
      ...(opts.pptWorkflowScope ? { pptWorkflowScope: opts.pptWorkflowScope } : {}),
      ...(opts.blockedProviderIds ? { blockedProviderIds: opts.blockedProviderIds } : {}),
      ...(opts.blockedToolNames ? { blockedToolNames: opts.blockedToolNames } : {}),
      ...(opts.blockedSkillIds ? { blockedSkillIds: opts.blockedSkillIds } : {}),
      ...(opts.runtimeDataDir ? { runtimeDataDir: opts.runtimeDataDir } : {}),
      ...(opts.fastContext ? { fastContext: true } : {}),
      ...(opts.fastContextTaskCount ? { fastContextTaskCount: opts.fastContextTaskCount } : {})
    })
    const modelStepDeps: ModelStepServiceDeps = {
      threadStore: opts.threadStore,
      sessionStore: opts.sessionStore,
      turns: opts.turns,
      events: opts.events,
      model: opts.model,
      compactor: opts.compactor,
      prefix: opts.prefix,
      ids: opts.ids,
      nowIso: opts.nowIso,
      get modelCapabilities() { return opts.modelCapabilities },
      get activePlanContext() { return opts.activePlanContext },
      get tokenEconomy() { return opts.tokenEconomy },
      get toolArgumentRepair() { return opts.toolArgumentRepair },
      get turnLimits() { return opts.turnLimits },
      modelRouting: this.modelRouting,
      budgetGate: this.budgetGate,
      goalTurns: this.goalTurns,
      threadItems: this.threadItems,
      turnContextResolver: this.turnContextResolver,
      telemetry: this.telemetry,
      historyCompaction: this.historyCompaction,
      turnAttachments: this.turnAttachments,
      modelRoundEngine: this.modelRoundEngine,
      roundOutcome: this.roundOutcome,
      ...(opts.awaitWorkspaceCheckpoint
        ? { awaitWorkspaceCheckpoint: opts.awaitWorkspaceCheckpoint }
        : {}),
      recordPipelineStage: (threadId, turnId, stage, details) =>
        this.recordPipelineStage(threadId, turnId, stage, details),
      recordToolCatalogDrift: (input) => this.recordToolCatalogDrift(input),
      recordTokenEconomySavings: (input) => this.recordTokenEconomySavings(input),
      rememberFailure: (turnId, failure) => this.rememberTurnFailure(turnId, failure)
    }
    this.modelSteps = new ModelStepService(modelStepDeps)
  }

  /** Cancel any pending goal auto-resume timers (called on runtime shutdown). */
  shutdownGoalResume(): void {
    this.goalTurns.shutdown()
  }

  /** Cancel any pending interrupted-turn resume timers (runtime shutdown). */
  shutdownInterruptedResume(): void {
    this.interruptedTurns.shutdown()
  }

  /**
   * Resume ordinary threads whose in-flight turn was interrupted by a runtime
   * restart (no active goal — goal threads use `resumeInterruptedGoals`).
   * Gated by the per-thread cooldown and the master switch so a crash loop
   * cannot burn model budget by resuming the same thread on every boot.
   */
  async resumeInterruptedTurns(
    threadIds: readonly string[],
    childRecoveryCandidates: readonly import('./interrupted-turn-coordinator.js').InterruptedSubagentRecoveryCandidate[] = []
  ): Promise<number> {
    return this.interruptedTurns.resumeInterruptedTurns(threadIds, childRecoveryCandidates)
  }

  /**
   * Resume goals stranded by a runtime restart (path A). `threadIds` are the
   * threads whose in-flight turn was just reconciled to `failed`; only those
   * with a still-`active` goal are relaunched, so dormant goals on unrelated
   * threads are never auto-started on boot.
   */
  async resumeInterruptedGoals(threadIds: readonly string[]): Promise<number> {
    return this.goalTurns.resumeInterruptedGoals(threadIds)
  }

  protected lifecycleHookDeps(): TurnLifecycleHookDeps {
    return {
      hooks: this.opts.hooks,
      threadStore: this.opts.threadStore,
      turns: this.opts.turns,
      events: this.opts.events,
      ids: this.opts.ids,
      nowIso: this.opts.nowIso
    }
  }

  /** Compatibility seam retained for focused mutation-race tests. */
  protected async maybeGenerateThreadTitle(
    threadId: string,
    turnId: string,
    signal?: AbortSignal
  ): Promise<void> {
    await this.threadTitle.generateAfterTurn(threadId, turnId, signal)
  }

  protected rememberTurnFailure(turnId: string, failure: TurnExecutionFailure): void {
    if (!failure.error.trim()) return
    this.turnFailures.set(turnId, failure)
  }


  protected async drainSteering(threadId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const pending = this.opts.steering.drain(turnId)
    if (pending.length === 0) return
    for (const entry of pending) {
      const item = makeUserItem({
        id: this.opts.ids.next('item_steered'),
        turnId,
        threadId,
        text: entry.text,
        ...(entry.displayText ? { displayText: entry.displayText } : {}),
        ...(entry.messageSource ? { messageSource: entry.messageSource } : {}),
        ...(entry.attachmentIds?.length ? { attachmentIds: entry.attachmentIds } : {})
      })
      await this.opts.turns.applyItem(threadId, item)
    }
    void signal
  }

  /** Persist already accepted guidance, then close admission for a terminal path. */
  protected async drainAndSealSteering(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<void> {
    while (!this.opts.steering.sealIfEmpty(turnId)) {
      await this.drainSteering(threadId, turnId, signal)
    }
  }

  protected async recordTurnLimitExceeded(
    threadId: string,
    turnId: string,
    code: 'turn_step_limit' | 'turn_wall_time_limit' | 'tool_call_limit_exceeded' | 'extension_budget_exhausted',
    message: string
  ): Promise<void> {
    await this.opts.events.record({ kind: 'error', threadId, turnId, message, code, severity: 'warning' })
  }

  protected async modelStep(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex = 0,
    maxToolCallsPerStep = normalizeTurnLimits(this.opts.turnLimits).maxToolCallsPerStep
  ): Promise<ModelRoundOutcome> {
    return this.modelSteps.run(threadId, turnId, signal, stepIndex, maxToolCallsPerStep)
  }

  protected async dispatchToolCalls(input: ToolDispatchInput): Promise<ToolDispatchOutcome> {
    const context = createToolExecutionContext(input, {
      memoryEnabled: Boolean(this.opts.memoryStore),
      ...(this.opts.allowedProviderIds ? { allowedProviderIds: this.opts.allowedProviderIds } : {}),
      ...(this.opts.allowedSkillIds ? { allowedSkillIds: this.opts.allowedSkillIds } : {}),
      ...(this.opts.allowedReadPaths ? { allowedReadPaths: this.opts.allowedReadPaths } : {}),
      ...(this.opts.allowedWritePaths ? { allowedWritePaths: this.opts.allowedWritePaths } : {}),
      ...(this.opts.allowedArtifactIds ? { allowedArtifactIds: this.opts.allowedArtifactIds } : {}),
      ...(this.opts.pptWorkflowScope ? { pptWorkflowScope: this.opts.pptWorkflowScope } : {}),
      ...(this.opts.blockedProviderIds ? { blockedProviderIds: this.opts.blockedProviderIds } : {}),
      ...(this.opts.blockedToolNames ? { blockedToolNames: this.opts.blockedToolNames } : {}),
      ...(this.opts.blockedSkillIds ? { blockedSkillIds: this.opts.blockedSkillIds } : {}),
      ...(this.opts.runtimeDataDir ? { runtimeDataDir: this.opts.runtimeDataDir } : {}),
      ...(this.opts.artifactStore ? { artifactStore: this.opts.artifactStore } : {}),
      ...(this.opts.fastContext ? { fastContext: true } : {}),
      ...(this.opts.fastContextTaskCount ? { fastContextTaskCount: this.opts.fastContextTaskCount } : {}),
      interactiveToolBridge: this.interactiveToolBridge
    })
    const thread = await this.opts.threadStore.get(input.threadId)
    const turn = thread?.turns.find((candidate) => candidate.id === input.turnId)
    const used = turn?.extensionToolInvocations ?? 0
    const maximum = thread?.extensionBudget?.maxToolInvocations
    if (maximum !== undefined && used + input.calls.length > maximum) {
      const message = `Extension tool-invocation budget exhausted: ${used} used, ${input.calls.length} requested, ${maximum} allowed.`
      await this.toolCallDispatcher.suppressAll(input, message)
      await this.recordTurnLimitExceeded(
        input.threadId,
        input.turnId,
        'extension_budget_exhausted',
        message
      )
      return 'budget_exhausted'
    }
    let executed = 0
    const outcome = await this.toolCallDispatcher.dispatch({
      dispatch: input,
      context,
      stormBreaker: this.toolStormBreakers.get(input.turnId),
      onToolExecuted: (toolName) => {
        executed += 1
        this.goalTurns.noteToolExecuted(input.turnId, toolName)
      }
    })
    if (thread?.extensionBudget && executed > 0) {
      await this.opts.turns.updateTurnMetadata(input.threadId, input.turnId, {
        extensionToolInvocations: used + executed
      })
    }
    return outcome
  }

  protected async recordTokenEconomySavings(input: {
    threadId: string
    turnId: string
    model: string
    rawInputTokens: number
    sentInputTokens: number
  }): Promise<void> {
    const savedTokens = Math.max(0, Math.floor(input.rawInputTokens - input.sentInputTokens))
    if (savedTokens <= 0) return
    const usage = this.opts.usage.recordTokenEconomySavings(input.threadId, {
      tokenEconomySavingsTokens: savedTokens
    })
    await this.opts.events.record({
      kind: 'usage',
      threadId: input.threadId,
      turnId: input.turnId,
      model: input.model,
      usage
    })
  }

  protected async recordPipelineStage(
    threadId: string,
    turnId: string,
    stage: PipelineStage,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.opts.events.record({
      kind: 'pipeline_stage',
      threadId,
      turnId,
      stage,
      label: PIPELINE_STAGE_LABELS[stage],
      ...(details && Object.keys(details).length > 0 ? { details } : {})
    })
  }

  protected async recordToolCatalogDrift(input: {
    threadId: string
    turnId: string
    fingerprint: string
    toolCount: number
    toolNames: string[]
    changeKind: 'additive' | 'breaking'
    message: string
  }): Promise<void> {
    await this.opts.events.record({
      kind: 'tool_catalog_changed',
      threadId: input.threadId,
      turnId: input.turnId,
      fingerprint: input.fingerprint,
      toolCount: input.toolCount,
      changeKind: input.changeKind,
      toolNames: input.toolNames.slice(0, 50),
      message: input.message
    })
  }

  protected async recordGoalUsage(threadId: string, tokenDelta: number): Promise<void> {
    await this.goalTurns.recordUsage(threadId, tokenDelta)
  }

  /** Convenience factory for tests: builds a loop with sensible defaults. */
  static defaultPrefix(): ImmutablePrefix {
    return createImmutablePrefix({
      systemPrompt: 'You are Kun, a careful and helpful assistant.',
      pinnedConstraints: ['user: preserve recent turns', 'project: keep responses concise']
    })
  }
}
