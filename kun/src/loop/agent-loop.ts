import type { ModelClient } from '../ports/model-client.js'
import type { AgentSdkRuntime } from '../runtime/agent-sdk/agent-sdk-runtime.js'
import type {
  ToolHost,
  ToolHostContext,
  GuiPlanContext,
  GuiDesignArtifactContext
} from '../ports/tool-host.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { UsageService } from '../services/usage-service.js'
import type { TurnService, TurnSettlement } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadItemProjectionService } from '../services/thread-item-projection.js'
import type { PipelineStage } from '../contracts/events.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type {
  ModelRoundOutcome,
  ToolDispatchInput,
  ToolDispatchOutcome,
  TurnExecutionFailure,
  TurnExecutionStatus
} from './turn-execution-types.js'
import { ContextCompactor } from './context-compactor.js'
import type { RolesConfig } from '../config/kun-config.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'
import {
  createImmutablePrefix
} from '../cache/immutable-prefix.js'
import {
  makeUserItem,
  makeErrorItem
} from '../domain/item.js'
import type { ContextCompactionConfig } from './model-context-profile.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import type { InstructionRuntime } from '../instructions/instruction-runtime.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { ResolvedHook } from '../hooks/hook-engine.js'
import type { TokenEconomyConfig } from './token-economy.js'
import { ModelStepService, type ModelStepServiceDeps } from './model-step-service.js'
import { ModelRoutingService } from './model-routing-service.js'
import { HistoryCompactionService } from './history-compaction-service.js'
import { ToolStormBreaker, type ToolStormBreakerOptions } from './tool-storm-breaker.js'
import { LoopTelemetry } from './loop-telemetry.js'
import { ModelRoundEngine } from './model-round-engine.js'
import { modelClientDiagnostics } from './model-client-diagnostics.js'
import { InteractiveToolBridge } from './interactive-tool-bridge.js'
import { TurnContextResolver } from './turn-context-resolver.js'
import { TurnFinalizer, type TurnFinalizationRequest } from './turn-finalizer.js'
import { normalizeTurnLimits, type TurnLimitsConfig } from './turn-limits.js'
import { RoundOutcomeCoordinator } from './round-outcome-coordinator.js'
import { ThreadTitleService } from './thread-title-service.js'
import { TurnBudgetGate } from './turn-budget-gate.js'
import {
  TurnAttachmentService
} from './turn-attachment-service.js'
import { createToolExecutionContext } from './tool-context-factory.js'
import { ToolExecutionService } from './tool-execution-service.js'
import { ToolCallDispatcher } from './tool-call-dispatcher.js'
import {
  GoalTurnCoordinator,
  type GoalElapsedTimer,
  type GoalTurnCoordinatorOptions
} from './goal-turn-coordinator.js'
import {
  runTurnEndLifecycleHooks,
  runTurnStartLifecycleHooks,
  type TurnLifecycleHookDeps
} from './turn-lifecycle-hooks.js'
export {
  PLAN_MODE_INSTRUCTION,
  isPlanClarifyingQuestion,
  isStalePlanContext,
  resolvePlanModeToolSpecs,
  turnHasUnverifiedSourceChanges
} from './plan-mode.js'
export {
  buildRuntimeContextInstruction,
  shouldInjectInitialRuntimeContext
} from './runtime-context.js'
export {
  svgArtifactCompletionState,
  type SvgArtifactCompletionState
} from './svg-artifact-completion.js'
export { canUpgradeThreadTitle } from './thread-title-policy.js'
export { memoryInstructions } from './memory-instructions.js'
export {
  goalContinuationInstruction,
  todoContinuationInstruction
} from './continuation-instructions.js'

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

export type AgentLoopOptions = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  model: ModelClient
  toolHost: ToolHost
  usage: UsageService
  events: RuntimeEventRecorder
  turns: TurnService
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  prefix: ImmutablePrefix
  ids: IdGenerator
  nowIso: () => string
  nowMs?: () => number
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  instructionRuntime?: InstructionRuntime
  attachmentStore?: AttachmentStore
  memoryStore?: MemoryStore
  artifactStore?: ArtifactStore
  /** Kun runtime data root for sandbox-safe background shell output reads. */
  runtimeDataDir?: string
  tokenEconomy?: TokenEconomyConfig
  contextCompaction?: ContextCompactionConfig
  /** Internal-LLM role model routing (smallModel slot + title/summary/codeReview overrides). */
  roles?: RolesConfig
  toolStorm?: ToolStormBreakerOptions & { enabled?: boolean }
  turnLimits?: TurnLimitsConfig
  /**
   * Disable only the wall-clock deadline for this loop. Delegated child
   * agents use this so they run until completion or explicit cancellation;
   * step and per-response tool-call limits still apply.
   */
  disableWallTimeLimit?: boolean
  toolArgumentRepair?: {
    maxStringBytes?: number
  }
  /**
   * Tuning + test seams for goal auto-resume (KunAgent/Kun#370). Defaults
   * back off exponentially and bound consecutive no-progress retries; tests
   * inject a synchronous timer and small caps for determinism.
   */
  goalResume?: GoalTurnCoordinatorOptions
  /**
   * Hard allow-list intersected into every tool context for this loop. Used
   * by read-only subagents to clamp the inherited tool host to investigation
   * tools — enforced at both the schema (listTools) and execute layers.
   */
  forcedAllowedToolNames?: readonly string[]
  /**
   * Provider ids hard-blocked for this loop (e.g. a subagent profile's blocked
   * MCP servers, as `mcp:<serverId>`). Deny-list layered on top of inherit and
   * enforced at both the schema and execute layers.
   */
  blockedProviderIds?: readonly string[]
  /**
   * Tool names hard-blocked for this loop (e.g. a subagent profile's blocked
   * built-in tools). Deny-list layered on top of inherit; enforced at both layers.
   */
  blockedToolNames?: readonly string[]
  /**
   * Skill ids hard-blocked for this loop's turns (e.g. a subagent profile's
   * blockedSkills). Hidden from the catalog + auto-activation and rejected by
   * `load_skill`, without mutating the shared skill runtime.
   */
  blockedSkillIds?: readonly string[]
  /**
   * Lifecycle hooks (UserPromptSubmit, TurnStart, TurnEnd, PreCompact).
   * Tool phases are handled by the tool host; the loop ignores them.
   */
  hooks?: readonly ResolvedHook[]
  /**
   * Optional fallback GUI plan context for embedders that run the loop
   * without persisted turn metadata. Normal serve mode reads GUI plan
   * context from the active turn record.
   */
  activePlanContext?: GuiPlanContext
  /**
   * Optional callback to mutate the active plan context (e.g. when the
   * loop records a successful `create_plan` result). The default is a
   * no-op for callers that don't track plan state.
   */
  onActivePlanContextChange?: (context: GuiPlanContext | undefined) => void
  onPlanWritten?: (input: {
    threadId: string
    turnId: string
    planId: string
    relativePath: string
    markdown: string
  }) => Promise<void>
  /**
   * Subscription engine. When set and it owns the active thread's provider
   * (kind: 'agent-sdk'), the entire turn is delegated to the embedded Claude
   * Agent SDK instead of kun's own model loop, billing the user's Claude
   * subscription. kun's tools/persona/permissions are injected into the SDK.
   */
  sdkRuntime?: AgentSdkRuntime
}

/**
 * Cache-first agent loop. The loop:
 * 1. Drains pending steering text and injects it as user messages.
 * 2. Calls the model client with the immutable prefix + compacted history.
 * 3. Streams text, reasoning, and tool-call deltas; emits runtime events.
 * 4. Executes tool calls through the tool host with approval gating.
 * 5. Folds usage/cache telemetry into the per-thread snapshot.
 * 6. Triggers compaction when the history exceeds the soft threshold.
 *
 * The loop is driven by `runTurn(threadId, turnId)` and is fully
 * cancellable through the AbortSignal returned by `getAbortController`.
 */
export class AgentLoop {
  private readonly opts: AgentLoopOptions
  private readonly modelRouting: ModelRoutingService
  private readonly toolStormBreakers = new Map<string, ToolStormBreaker>()
  private readonly telemetry: LoopTelemetry
  private readonly threadItems: ThreadItemProjectionService
  private readonly historyCompaction: HistoryCompactionService
  private readonly modelRoundEngine: ModelRoundEngine
  private readonly modelSteps: ModelStepService
  private readonly roundOutcome: RoundOutcomeCoordinator
  private readonly threadTitle: ThreadTitleService
  private readonly budgetGate: TurnBudgetGate
  private readonly turnAttachments: TurnAttachmentService
  private readonly turnContextResolver: TurnContextResolver
  private readonly interactiveToolBridge: InteractiveToolBridge
  private readonly toolExecution: ToolExecutionService
  private readonly toolCallDispatcher: ToolCallDispatcher
  private readonly turnFailures = new Map<string, TurnExecutionFailure>()
  /** One owned runner per turn; duplicate callers share its terminal result. */
  private readonly activeTurnRuns = new Map<string, Promise<TurnExecutionStatus>>()
  private readonly goalTurns: GoalTurnCoordinator

  constructor(opts: AgentLoopOptions) {
    this.opts = opts
    this.telemetry = new LoopTelemetry(opts.sessionStore)
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
      nowIso: opts.nowIso
    })
    this.toolExecution = new ToolExecutionService({
      toolHost: opts.toolHost,
      inflight: opts.inflight,
      turns: opts.turns,
      events: opts.events,
      nowIso: opts.nowIso,
      ...(opts.onPlanWritten ? { onPlanWritten: opts.onPlanWritten } : {})
    })
    this.toolCallDispatcher = new ToolCallDispatcher(this.toolExecution)
    this.roundOutcome = new RoundOutcomeCoordinator({
      sessionStore: opts.sessionStore,
      turns: opts.turns,
      events: opts.events,
      ids: opts.ids,
      dispatchToolCalls: (input) => this.dispatchToolCalls(input),
      rememberFailure: (turnId, failure) => this.rememberTurnFailure(turnId, failure),
      hasTurnMadeProgress: (turnId) => this.goalTurns.hasMadeProgress(turnId),
      suppressGoalResume: (turnId) => this.goalTurns.suppressResume(turnId)
    })
    this.turnContextResolver = new TurnContextResolver({
      toolHost: opts.toolHost,
      resolveAttachments: (input) => this.turnAttachments.resolveTurnAttachments(input),
      ...(opts.skillRuntime ? { skillRuntime: opts.skillRuntime } : {}),
      ...(opts.instructionRuntime ? { instructionRuntime: opts.instructionRuntime } : {}),
      getMemoryStore: () => opts.memoryStore,
      interactiveToolBridge: this.interactiveToolBridge,
      ...(opts.forcedAllowedToolNames ? { forcedAllowedToolNames: opts.forcedAllowedToolNames } : {}),
      ...(opts.blockedProviderIds ? { blockedProviderIds: opts.blockedProviderIds } : {}),
      ...(opts.blockedToolNames ? { blockedToolNames: opts.blockedToolNames } : {}),
      ...(opts.blockedSkillIds ? { blockedSkillIds: opts.blockedSkillIds } : {}),
      ...(opts.runtimeDataDir ? { runtimeDataDir: opts.runtimeDataDir } : {})
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

  /**
   * Resume goals stranded by a runtime restart (path A). `threadIds` are the
   * threads whose in-flight turn was just reconciled to `failed`; only those
   * with a still-`active` goal are relaunched, so dormant goals on unrelated
   * threads are never auto-started on boot.
   */
  async resumeInterruptedGoals(threadIds: readonly string[]): Promise<number> {
    return this.goalTurns.resumeInterruptedGoals(threadIds)
  }

  /**
   * Run a turn end-to-end. The loop returns the final turn status
   * (completed, failed, or aborted). All errors are caught and
   * surfaced through the `error` runtime event.
  */
  runTurn(threadId: string, turnId: string): Promise<TurnExecutionStatus> {
    const key = activeTurnRunKey(threadId, turnId)
    const existing = this.activeTurnRuns.get(key)
    if (existing) return existing
    const run = this.runTurnOwned(threadId, turnId)
    this.activeTurnRuns.set(key, run)
    void run.then(
      () => { if (this.activeTurnRuns.get(key) === run) this.activeTurnRuns.delete(key) },
      () => { if (this.activeTurnRuns.get(key) === run) this.activeTurnRuns.delete(key) }
    )
    return run
  }

  private async runTurnOwned(threadId: string, turnId: string): Promise<TurnExecutionStatus> {
    const finalizer = new TurnFinalizer(this.opts.turns)
    const settle = (input: Omit<TurnFinalizationRequest, 'threadId' | 'turnId'>) =>
      finalizer.settle({ threadId, turnId, ...input })
    const statusFromSettlement = (
      settlement: TurnSettlement,
      fallback: TurnExecutionStatus
    ): TurnExecutionStatus => settlement.kind === 'missing' ? fallback : settlement.status
    const errorFromSettlement = (settlement: TurnSettlement): string | undefined =>
      settlement.kind === 'missing' ? undefined : settlement.error
    const signal = this.opts.turns.getAbortController(turnId)
    if (!signal) {
      const settlement = await settle({ status: 'failed', error: 'no abort controller for turn' })
      return statusFromSettlement(settlement, 'failed')
    }
    if (signal.aborted) {
      const settlement = await settle({ status: 'aborted' })
      return statusFromSettlement(settlement, 'aborted')
    }
    const owningThread = await this.opts.threadStore.get(threadId)
    // Subscription engine dispatch: if a Claude Agent SDK runtime owns this
    // thread's provider, delegate the whole turn to it (the SDK runs the loop on
    // the user's subscription; kun's brain is injected). All other providers
    // fall through to kun's native loop below.
    const sdkRuntime = this.opts.sdkRuntime
    let delegatedSdkRuntime: AgentSdkRuntime | undefined
    if (sdkRuntime) {
      const turn = owningThread?.turns.find((candidate) => candidate.id === turnId)
      const providerId = turn?.providerId?.trim() || owningThread?.providerId?.trim()
      if (sdkRuntime.handlesProvider(providerId)) {
        delegatedSdkRuntime = sdkRuntime
      }
    }
    // The Agent SDK owns its own wall-clock timeout so it can distinguish a
    // runtime deadline from a user cancellation. Starting this native timer
    // for the delegated path races that SDK timer and turns deadline failures
    // into misleading `aborted` turns.
    const configuredWallTimeMs = normalizeTurnLimits(this.opts.turnLimits).maxWallTimeMs
    const maxWallTimeMs = owningThread?.extensionBudget
      ? Math.min(configuredWallTimeMs, owningThread.extensionBudget.maxElapsedMs)
      : configuredWallTimeMs
    let wallTimeExceeded = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    if (!delegatedSdkRuntime && this.opts.disableWallTimeLimit !== true) {
      deadline = setTimeout(() => {
        wallTimeExceeded = true
        this.opts.turns.abortTurnExecution(turnId)
      }, maxWallTimeMs)
      if (typeof (deadline as { unref?: () => void }).unref === 'function') {
        ;(deadline as { unref: () => void }).unref()
      }
    }
    let goalTimer: GoalElapsedTimer | null = null
    let finalStatus: 'completed' | 'failed' | 'aborted' | undefined
    let finalError: string | undefined
    const failWallTimeLimit = async (): Promise<TurnExecutionStatus> => {
      const extensionLimited = Boolean(
        owningThread?.extensionBudget && owningThread.extensionBudget.maxElapsedMs <= configuredWallTimeMs
      )
      const code = extensionLimited ? 'extension_budget_exhausted' : 'turn_wall_time_limit'
      const message = extensionLimited
        ? `Extension elapsed-time budget exhausted after ${maxWallTimeMs}ms.`
        : `turn exceeded ${maxWallTimeMs}ms wall time`
      this.rememberTurnFailure(turnId, {
        error: message,
        code,
        severity: 'warning'
      })
      await this.recordTurnLimitExceeded(threadId, turnId, code, message)
      const settlement = await settle({
        status: 'failed',
        error: message,
        code,
        severity: 'warning'
      })
      finalStatus = statusFromSettlement(settlement, 'failed')
      finalError = errorFromSettlement(settlement)
      return finalStatus
    }
    try {
      goalTimer = await this.goalTurns.begin(threadId)
      await this.recordPipelineStage(threadId, turnId, 'setup')
      if (!delegatedSdkRuntime && this.opts.toolStorm?.enabled !== false) {
        this.toolStormBreakers.set(turnId, new ToolStormBreaker(this.opts.toolStorm))
      }
      await this.recordPipelineStage(threadId, turnId, 'pre_start')
      const denial = await runTurnStartLifecycleHooks(this.lifecycleHookDeps(), { threadId, turnId })
      if (denial) {
        await this.opts.events.record({
          kind: 'error',
          threadId,
          turnId,
          message: denial,
          code: 'hook_denied',
          severity: 'error'
        })
        await this.opts.turns.applyItem(
          threadId,
          makeErrorItem({
            id: this.opts.ids.next('item_error'),
            turnId,
            threadId,
            message: denial,
            code: 'hook_denied',
            severity: 'error'
          })
        )
        const settlement = await settle({ status: 'failed', error: denial })
        finalStatus = statusFromSettlement(settlement, 'failed')
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      await this.drainSteering(threadId, turnId, signal)
      await this.recordPipelineStage(threadId, turnId, 'post_start')
      if (delegatedSdkRuntime) {
        // The delegated SDK owns its model stream and cannot consume Kun's
        // native mid-turn queue. Drain anything that arrived before startup,
        // then seal admission so later guidance remains renderer-owned.
        await this.drainAndSealSteering(threadId, turnId, signal)
        const reportedStatus = await delegatedSdkRuntime.runTurn(threadId, turnId, signal)
        const settlement = await finalizer.observeExternal({ threadId, turnId })
        finalStatus = statusFromSettlement(settlement, reportedStatus)
        finalError = errorFromSettlement(settlement)
        if (finalStatus === 'completed') {
          void this.threadTitle.generateAfterTurn(threadId, turnId, signal).catch(() => {})
        }
        return finalStatus
      }
      const status = await this.loop(threadId, turnId, signal)
      if (wallTimeExceeded) return failWallTimeLimit()
      const failure = status === 'failed' ? this.turnFailures.get(turnId) : undefined
      const settlement = await settle({
        status,
        ...(failure ?? {})
      })
      finalStatus = statusFromSettlement(settlement, status)
      finalError = errorFromSettlement(settlement)
      if (finalStatus === 'completed') {
        // Fire-and-forget: generate an LLM title after the FIRST assistant
        // reply completes, only when the thread still has a default title.
        void this.threadTitle.generateAfterTurn(threadId, turnId, signal).catch(() => {})
      }
      return finalStatus
    } catch (error) {
      if (wallTimeExceeded) return failWallTimeLimit()
      if (signal.aborted) {
        const settlement = await settle({ status: 'aborted' })
        finalStatus = statusFromSettlement(settlement, 'aborted')
        finalError = errorFromSettlement(settlement)
        return finalStatus
      }
      const raw = error instanceof Error ? error.message : String(error)
      // Best-effort enrichment so the renderer can show "what failed where"
      // instead of the bare "Kun turn failed" string. See issue #26.
      const thread = await this.opts.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      const modelName = turn?.model?.trim() || thread?.model?.trim() || this.opts.model.model || 'unknown'
      const providerId = turn?.providerId?.trim() || thread?.providerId?.trim()
      const diagnostics = modelClientDiagnostics(this.opts.model, providerId)
      const stack = error instanceof Error
        ? (error.stack?.split('\n').slice(0, 3).join(' | ') ?? '')
        : ''
      const message = [
        '[Kun turn failed]',
        `turn=${turnId}`,
        `thread=${threadId}`,
        `model=${modelName}`,
        `providerId=${providerId || 'default'}`,
        diagnostics.providerBaseUrl ? `baseUrl=${diagnostics.providerBaseUrl}` : '',
        diagnostics.endpointFormat ? `endpointFormat=${diagnostics.endpointFormat}` : '',
        `error=${raw}`,
        stack ? `stack=${stack}` : ''
      ].filter(Boolean).join(' ')
      const settlement = await settle({ status: 'failed', error: message })
      finalStatus = statusFromSettlement(settlement, 'failed')
      finalError = errorFromSettlement(settlement)
      return finalStatus
    } finally {
      if (deadline !== undefined) clearTimeout(deadline)
      try {
        // Accounting/resume are post-settlement conveniences. A late store or
        // event failure must not hide an already durable terminal outcome, nor
        // skip the unconditional transient-state cleanup below.
        await this.goalTurns.afterTerminal({
          threadId,
          turnId,
          finalStatus: finalStatus ?? 'failed',
          timer: goalTimer
        })
      } finally {
        this.modelRouting.clear(threadId, turnId)
        this.toolStormBreakers.delete(turnId)
        this.roundOutcome.clearTurn(turnId)
        this.goalTurns.clearTurn(turnId)
        if (typeof this.opts.skillRuntime?.clearTurnActivation === 'function') {
          this.opts.skillRuntime.clearTurnActivation(threadId, turnId)
        }
        this.turnFailures.delete(turnId)
        this.telemetry.clearPromptPressure(threadId)
        await runTurnEndLifecycleHooks(this.lifecycleHookDeps(), {
          threadId,
          turnId,
          status: finalStatus ?? 'failed',
          ...(finalError ? { error: finalError } : {})
        })
      }
    }
  }

  private lifecycleHookDeps(): TurnLifecycleHookDeps {
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
  private async maybeGenerateThreadTitle(
    threadId: string,
    turnId: string,
    signal?: AbortSignal
  ): Promise<void> {
    await this.threadTitle.generateAfterTurn(threadId, turnId, signal)
  }

  private rememberTurnFailure(turnId: string, failure: TurnExecutionFailure): void {
    if (!failure.error.trim()) return
    this.turnFailures.set(turnId, failure)
  }


  private async drainSteering(threadId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const pending = this.opts.steering.drain(turnId)
    if (pending.length === 0) return
    for (const entry of pending) {
      const item = makeUserItem({
        id: this.opts.ids.next('item_steered'),
        turnId,
        threadId,
        text: entry.text,
        ...(entry.displayText ? { displayText: entry.displayText } : {}),
        ...(entry.messageSource ? { messageSource: entry.messageSource } : {})
      })
      await this.opts.turns.applyItem(threadId, item)
    }
    void signal
  }

  /** Persist already accepted guidance, then close admission for a terminal path. */
  private async drainAndSealSteering(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<void> {
    while (!this.opts.steering.sealIfEmpty(turnId)) {
      await this.drainSteering(threadId, turnId, signal)
    }
  }

  private async loop(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<TurnExecutionStatus> {
    const configuredLimits = normalizeTurnLimits(this.opts.turnLimits)
    const thread = await this.opts.threadStore.get(threadId)
    const limits = thread?.extensionBudget
      ? {
          ...configuredLimits,
          maxSteps: Math.min(configuredLimits.maxSteps, thread.extensionBudget.maxModelRequests),
          maxWallTimeMs: Math.min(configuredLimits.maxWallTimeMs, thread.extensionBudget.maxElapsedMs)
        }
      : configuredLimits
    const startedAt = this.opts.nowMs?.() ?? Date.now()
    for (let step = 0; ; step += 1) {
      if (signal.aborted) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        return 'aborted'
      }
      if (step >= limits.maxSteps) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        const extensionLimited = Boolean(
          thread?.extensionBudget && thread.extensionBudget.maxModelRequests <= configuredLimits.maxSteps
        )
        await this.recordTurnLimitExceeded(
          threadId,
          turnId,
          extensionLimited ? 'extension_budget_exhausted' : 'turn_step_limit',
          extensionLimited
            ? `Extension model-request budget exhausted after ${limits.maxSteps} requests.`
            : `turn exceeded ${limits.maxSteps} model steps`
        )
        return 'failed'
      }
      if (
        this.opts.disableWallTimeLimit !== true &&
        (this.opts.nowMs?.() ?? Date.now()) - startedAt >= limits.maxWallTimeMs
      ) {
        await this.drainAndSealSteering(threadId, turnId, signal)
        const extensionLimited = Boolean(
          thread?.extensionBudget && thread.extensionBudget.maxElapsedMs <= configuredLimits.maxWallTimeMs
        )
        await this.recordTurnLimitExceeded(
          threadId,
          turnId,
          extensionLimited ? 'extension_budget_exhausted' : 'turn_wall_time_limit',
          extensionLimited
            ? `Extension elapsed-time budget exhausted after ${limits.maxWallTimeMs}ms.`
            : `turn exceeded ${limits.maxWallTimeMs}ms wall time`
        )
        return 'failed'
      }
      await this.drainSteering(threadId, turnId, signal)
      const stepResult = await this.modelStep(threadId, turnId, signal, step, limits.maxToolCallsPerStep)
      if (stepResult === 'stop') {
        // Either accepted guidance wins and forces another model interaction,
        // or the synchronous seal wins and late steer requests are rejected.
        if (this.opts.steering.sealIfEmpty(turnId)) return 'completed'
        continue
      }
      if (stepResult === 'failed' || stepResult === 'aborted') {
        await this.drainAndSealSteering(threadId, turnId, signal)
        return stepResult
      }
    }
  }

  private async recordTurnLimitExceeded(
    threadId: string,
    turnId: string,
    code: 'turn_step_limit' | 'turn_wall_time_limit' | 'tool_call_limit_exceeded' | 'extension_budget_exhausted',
    message: string
  ): Promise<void> {
    await this.opts.events.record({ kind: 'error', threadId, turnId, message, code, severity: 'warning' })
  }

  private async modelStep(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex = 0,
    maxToolCallsPerStep = normalizeTurnLimits(this.opts.turnLimits).maxToolCallsPerStep
  ): Promise<ModelRoundOutcome> {
    return this.modelSteps.run(threadId, turnId, signal, stepIndex, maxToolCallsPerStep)
  }

  private async dispatchToolCalls(input: ToolDispatchInput): Promise<ToolDispatchOutcome> {
    const context = createToolExecutionContext(input, {
      memoryEnabled: Boolean(this.opts.memoryStore),
      ...(this.opts.blockedProviderIds ? { blockedProviderIds: this.opts.blockedProviderIds } : {}),
      ...(this.opts.blockedToolNames ? { blockedToolNames: this.opts.blockedToolNames } : {}),
      ...(this.opts.blockedSkillIds ? { blockedSkillIds: this.opts.blockedSkillIds } : {}),
      ...(this.opts.runtimeDataDir ? { runtimeDataDir: this.opts.runtimeDataDir } : {}),
      ...(this.opts.artifactStore ? { artifactStore: this.opts.artifactStore } : {}),
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

  private async recordTokenEconomySavings(input: {
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

  private async recordPipelineStage(
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

  private async recordToolCatalogDrift(input: {
    threadId: string
    turnId: string
    fingerprint: string
    toolCount: number
    toolNames: string[]
    changeKind: 'additive' | 'breaking'
    message: string
  }): Promise<void> {
    await this.opts.turns.applyItem(input.threadId, makeErrorItem({
      id: `item_${input.turnId}_tool_catalog_changed_${input.fingerprint}`,
      threadId: input.threadId,
      turnId: input.turnId,
      message: input.message,
      code: 'tool_catalog_changed',
      severity: 'info'
    }))
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

  private async recordGoalUsage(threadId: string, tokenDelta: number): Promise<void> {
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

function activeTurnRunKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}
