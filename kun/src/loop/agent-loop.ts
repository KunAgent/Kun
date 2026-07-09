import { isAbsolute, join, relative, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { ModelClient, ModelRequest, ModelToolSpec } from '../ports/model-client.js'
import type { AgentSdkRuntime } from '../runtime/agent-sdk/agent-sdk-runtime.js'
import type {
  ToolHost,
  ToolCallLike,
  ToolHostContext,
  ToolHostResult,
  GuiPlanContext,
  ToolProviderKind
} from '../ports/tool-host.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { DEFAULT_APPROVAL_POLICY, DEFAULT_SANDBOX_MODE } from '../contracts/policy.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { UserInputGate, UserInputResolution } from '../ports/user-input-gate.js'
import type { UsageService } from '../services/usage-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { PipelineStage } from '../contracts/events.js'
import type { RuntimeErrorSeverity } from '../contracts/errors.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { CacheRequestSignature } from '../cache/cache-diagnostics.js'
import { ContextCompactor } from './context-compactor.js'
import {
  effectiveHistoryAfterLatestCompaction,
  insertCompactionIntoVisibleHistory,
  placeCompactionsAtTurnEnd
} from './compaction-history.js'
import { resolveCompactionModel, summarizeCompactionWithModel } from './compaction-summary.js'
import { generateThreadTitle, resolveRoleModel } from './title-generator.js'
import type { RolesConfig } from '../config/kun-config.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'
import {
  createImmutablePrefix,
  shouldVerifyImmutablePrefix,
  verifyImmutablePrefix
} from '../cache/immutable-prefix.js'
import {
  detectVolatilePrefixContent,
  type PrefixVolatilityFinding
} from '../cache/prefix-volatility.js'
import { buildToolCatalogFingerprint } from '../cache/tool-catalog-fingerprint.js'
import {
  makeUserItem,
  makeAssistantTextItem,
  makeAssistantReasoningItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeErrorItem
} from '../domain/item.js'
import { touchThread } from '../domain/thread.js'
import { memoryPreview } from '../shared/memory-preview.js'
import { repairModelHistoryItems } from '../domain/model-history-repair.js'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadGoal } from '../contracts/threads.js'
import { modelCapabilitiesForModel, type ContextCompactionConfig } from './model-context-profile.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import type { InstructionRuntime } from '../instructions/instruction-runtime.js'
import type { AttachmentContent, AttachmentStore } from '../attachments/attachment-store.js'
import { detectImage } from '../attachments/attachment-store.js'
import type { ModelDocumentAttachment, ModelInputAttachment, ModelTextAttachmentFallback } from '../ports/model-client.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import {
  hasHooksForPhase,
  runObserverHooks,
  runUserPromptSubmitHooks,
  type ResolvedHook
} from '../hooks/hook-engine.js'
import {
  applyTokenEconomyToRequest,
  normalizeTokenEconomyConfig,
  type TokenEconomyConfig
} from './token-economy.js'
import { applyRequestHistoryHygiene } from './request-history-hygiene.js'
import {
  capToolResultImages,
  rehydrateGeneratedImagesForForward,
  MAX_FORWARDED_GENERATED_IMAGES,
  type ToolResultImage
} from './tool-result-image.js'
import { estimateModelRequestInputTokens, estimateRequestOverheadTokens } from './model-request-estimator.js'
import {
  recentAutoRouterContext,
  resolveAutoModelRoute,
  type AutoModelRouteSelection
} from './auto-model-router.js'
import { ToolStormBreaker, type ToolStormBreakerOptions } from './tool-storm-breaker.js'
import { healLoadedHistoryItems } from './history-healing.js'
import { repairDispatchToolArguments } from './tool-call-repair.js'
import { CREATE_PLAN_TOOL_NAME } from '../adapters/tool/create-plan-tool.js'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '../adapters/tool/goal-tools.js'
import { TODO_LIST_TOOL_NAME, TODO_WRITE_TOOL_NAME } from '../adapters/tool/todo-tools.js'
import { shellRuntimeInstruction } from '../adapters/tool/builtin-tool-utils.js'
import { VERIFY_CHANGES_TOOL_NAME } from '../adapters/tool/builtin-verify-tool.js'
import { buildToolPreferenceInstruction } from '../prompt/kun-system-prompt.js'
import {
  GoalResumeCoordinator,
  DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS,
  type GoalResumeCoordinatorDeps
} from './goal-resume-coordinator.js'
import {
  PLAN_MODE_INSTRUCTION,
  isPlanClarifyingQuestion,
  isStalePlanContext,
  resolvePlanModeToolSpecs,
  turnHasUnverifiedSourceChanges,
  verificationSuggestionInstruction
} from './plan-mode.js'
import {
  buildRuntimeContextInstruction,
  shouldInjectInitialRuntimeContext
} from './runtime-context.js'
import {
  EMPTY_POST_TOOL_MAX_RECOVERY_STEPS,
  GOAL_NO_TOOL_REPEAT_MAX_RECOVERY_STEPS,
  allowedToolNamesWithGuiStateTools,
  emptyPostToolRecoveryInstruction,
  goalContinuationInstruction,
  goalNoToolRecoveryInstruction,
  hasSuccessfulCreatePlanResult,
  intersectAllowedToolNames,
  isRepeatedNoToolAssistantText,
  latestUserMessageText,
  todoContinuationInstruction,
  userInputUnavailableInstruction
} from './continuation-instructions.js'
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
  goalContinuationInstruction,
  todoContinuationInstruction
} from './continuation-instructions.js'

const PARALLEL_READ_ONLY_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls'])
const DELEGATE_TASK_TOOL_NAME = 'delegate_task'
const MAX_PARALLEL_TOOL_CALLS = 3
// Number of most-recent tool-result screenshots/images kept inline in a
// request. Older ones collapse to a text note (Anthropic-style "keep last
// N images"), bounding context growth for long computer-use sessions.
const MAX_FORWARDED_TOOL_IMAGES = 3

/**
 * Tools that, on their own, do not count as "progress" toward a goal when
 * deciding whether to keep auto-resuming after a failed goal turn. A turn
 * that only inspects/updates goal state (and then fails) made no real
 * advancement, so it should burn the no-progress budget; a turn that edits
 * files, runs commands, advances todos, etc. resets it.
 */
const GOAL_NON_PROGRESS_TOOL_NAMES = new Set<string>([
  GET_GOAL_TOOL_NAME,
  UPDATE_GOAL_TOOL_NAME
])

/**
 * Prompt seeded into an auto-resumed goal continuation turn. The active-goal
 * continuation instruction is injected separately (the goal is still
 * `active`); this user message just nudges the model to pick the work back up
 * where the interrupted turn left off.
 */
const GOAL_RESUME_PROMPT = [
  'Continue working toward the active goal.',
  'The previous attempt stopped before the goal was complete (it was interrupted, truncated, or the runtime restarted, or it simply stopped early).',
  'Review the current state, pick up where the work left off, and keep going until the goal is genuinely achieved or blocked.'
].join(' ')

/**
 * Stable identity for the resume coordinator. Changing the objective (or
 * starting a brand-new goal) yields a new key, so a pending backoff resume
 * for an old goal is discarded rather than relaunched against the new one.
 */
function goalResumeKey(threadId: string, goal: ThreadGoal): string {
  return `${threadId}::${goal.createdAt}::${goal.objective}`
}

/**
 * Placeholder titles the GUI assigns to a fresh thread. When a thread still
 * carries one of these (or an empty title), the title is considered
 * auto-generatable; a user-set title never matches and is preserved. Mirrors
 * the renderer's `shouldAutoTitleThread` placeholder set so backend title
 * generation only fills in genuinely-default titles.
 */
const PLACEHOLDER_THREAD_TITLES = new Set(['New Thread', '新会话', 'Untitled', '未命名'])
const CODEX_PLACEHOLDER_TITLE = /^__codex_[a-z0-9_]+__$/i

function isAutoTitleableThreadTitle(title: string | null | undefined): boolean {
  const raw = title?.trim() ?? ''
  if (!raw) return true
  if (PLACEHOLDER_THREAD_TITLES.has(raw)) return true
  if (CODEX_PLACEHOLDER_TITLE.test(raw)) return true
  return false
}

/**
 * Whether the backend LLM titler may (re)generate a thread's title.
 *
 * - `titleAuto === false` → user renamed it manually; never overwrite.
 * - `titleAuto === true`  → client set a provisional first-message title; upgrade it.
 * - absent (legacy)       → only upgrade placeholder titles, never a real one.
 */
export function canUpgradeThreadTitle(thread: { title?: string | null; titleAuto?: boolean }): boolean {
  if (thread.titleAuto === false) return false
  if (thread.titleAuto === true) return true
  return isAutoTitleableThreadTitle(thread.title)
}
const MAX_TOOL_CATALOG_SNAPSHOTS = 256

type TurnFailure = {
  error: string
  code?: string
  details?: unknown
  severity?: RuntimeErrorSeverity
}

type ModelClientDiagnostics = {
  provider?: string
  providerBaseUrl?: string
  endpointFormat?: string
  configuredModel?: string
}

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

type ToolCatalogSnapshot = {
  fingerprint: string
  toolNames: string[]
  toolHashes: Record<string, string>
}

type GoalElapsedTimer = {
  startedAtMs: number
  createdAt: string
  objective: string
}

type ToolCatalogDrift =
  | { kind: 'none' }
  | { kind: 'additive'; previous: ToolCatalogSnapshot }
  | { kind: 'breaking'; previous: ToolCatalogSnapshot }

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
  toolArgumentRepair?: {
    maxStringBytes?: number
  }
  /**
   * Tuning + test seams for goal auto-resume (KunAgent/Kun#370). Defaults
   * back off exponentially and bound consecutive no-progress retries; tests
   * inject a synchronous timer and small caps for determinism.
   */
  goalResume?: Pick<
    GoalResumeCoordinatorDeps,
    'setTimer' | 'maxNoProgressAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'log'
  >
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
  private readonly autoModelRoutes = new Map<string, AutoModelRouteSelection>()
  private readonly promptTokenPressure = new Map<string, { model: string; promptTokens: number }>()
  /** Threads for which a one-time pressure hydration from persisted usage was already attempted. */
  private readonly hydratedPressureThreads = new Set<string>()
  private readonly toolStormBreakers = new Map<string, ToolStormBreaker>()
  private readonly toolCatalogSnapshots = new Map<string, ToolCatalogSnapshot>()
  private readonly lastNoToolTextByTurn = new Map<string, string>()
  private readonly goalNoToolRecoveryStepsByTurn = new Map<string, number>()
  private readonly emptyPostToolRecoveryStepsByTurn = new Map<string, number>()
  private readonly turnFailures = new Map<string, TurnFailure>()
  /** Turns that executed at least one real (non-goal-status) tool call. */
  private readonly turnMadeProgress = new Set<string>()
  /**
   * Turns whose stop was a deliberate cap rather than an unfinished-goal
   * interruption (cost-budget exhaustion, or a repetition stall that made no
   * real progress). These must not drive goal auto-resume even though the goal
   * is still `active`.
   */
  private readonly goalResumeSuppressedByTurn = new Set<string>()
  private readonly goalResume: GoalResumeCoordinator

  constructor(opts: AgentLoopOptions) {
    this.opts = opts
    this.goalResume = new GoalResumeCoordinator({
      launch: (threadId) => this.launchGoalResumeTurn(threadId),
      getActiveGoalKey: async (threadId) => {
        const goal = (await this.opts.threadStore.get(threadId))?.goal
        return goal && goal.status === 'active' ? goalResumeKey(threadId, goal) : null
      },
      isThreadBusy: async (threadId) =>
        (await this.opts.threadStore.get(threadId))?.status === 'running',
      ...this.opts.goalResume
    })
  }

  /** Cancel any pending goal auto-resume timers (called on runtime shutdown). */
  shutdownGoalResume(): void {
    this.goalResume.shutdown()
  }

  /**
   * Resume goals stranded by a runtime restart (path A). `threadIds` are the
   * threads whose in-flight turn was just reconciled to `failed`; only those
   * with a still-`active` goal are relaunched, so dormant goals on unrelated
   * threads are never auto-started on boot.
   */
  async resumeInterruptedGoals(threadIds: readonly string[]): Promise<number> {
    let resumed = 0
    for (const threadId of threadIds) {
      if (await this.goalResume.resumeInterrupted(threadId)) resumed += 1
    }
    return resumed
  }

  /**
   * Run a turn end-to-end. The loop returns the final turn status
   * (completed, failed, or aborted). All errors are caught and
   * surfaced through the `error` runtime event.
   */
  async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'> {
    const signal = this.opts.turns.getAbortController(turnId)
    if (!signal) {
      await this.failTurn(threadId, turnId, 'no abort controller for turn')
      return 'failed'
    }
    if (signal.aborted) {
      await this.opts.turns.finishTurn({ threadId, turnId, status: 'aborted' })
      return 'aborted'
    }
    // Subscription engine dispatch: if a Claude Agent SDK runtime owns this
    // thread's provider, delegate the whole turn to it (the SDK runs the loop on
    // the user's subscription; kun's brain is injected). All other providers
    // fall through to kun's native loop below.
    const sdkRuntime = this.opts.sdkRuntime
    if (sdkRuntime) {
      const thread = await this.opts.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      const providerId = turn?.providerId?.trim() || thread?.providerId?.trim()
      if (sdkRuntime.handlesProvider(providerId)) {
        return sdkRuntime.runTurn(threadId, turnId, signal)
      }
    }
    let goalTimer: GoalElapsedTimer | null = null
    let finalStatus: 'completed' | 'failed' | 'aborted' | undefined
    let finalError: string | undefined
    try {
      goalTimer = await this.startGoalElapsedTimer(threadId)
      await this.recordPipelineStage(threadId, turnId, 'setup')
      if (this.opts.toolStorm?.enabled !== false) {
        this.toolStormBreakers.set(turnId, new ToolStormBreaker(this.opts.toolStorm))
      }
      await this.recordPipelineStage(threadId, turnId, 'pre_start')
      const denial = await this.runTurnStartLifecycleHooks(threadId, turnId)
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
        await this.opts.turns.finishTurn({ threadId, turnId, status: 'failed', error: denial })
        finalStatus = 'failed'
        finalError = denial
        return 'failed'
      }
      await this.drainSteering(threadId, turnId, signal)
      await this.recordPipelineStage(threadId, turnId, 'post_start')
      const status = await this.loop(threadId, turnId, signal)
      const failure = status === 'failed' ? this.turnFailures.get(turnId) : undefined
      await this.opts.turns.finishTurn({
        threadId,
        turnId,
        status,
        ...(failure ?? {})
      })
      finalStatus = status
      finalError = failure?.error
      if (status === 'completed') {
        // Fire-and-forget: generate an LLM title after the FIRST assistant
        // reply completes, only when the thread still has a default title.
        void this.maybeGenerateThreadTitle(threadId, turnId, signal).catch(() => {})
      }
      return status
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      // Best-effort enrichment so the renderer can show "what failed where"
      // instead of the bare "Kun turn failed" string. See issue #26.
      const modelInfo = this.opts.model && 'config' in this.opts.model
        ? (this.opts.model as { config: { model?: string; baseUrl?: string } }).config
        : undefined
      const modelName = modelInfo?.model ?? 'unknown'
      const provider = modelInfo?.baseUrl ?? 'unknown'
      const stack = error instanceof Error
        ? (error.stack?.split('\n').slice(0, 3).join(' | ') ?? '')
        : ''
      const message = [
        '[Kun turn failed]',
        `turn=${turnId}`,
        `thread=${threadId}`,
        `model=${modelName}`,
        `provider=${provider}`,
        `error=${raw}`,
        stack ? `stack=${stack}` : ''
      ].filter(Boolean).join(' ')
      await this.failTurn(threadId, turnId, message)
      finalStatus = 'failed'
      finalError = message
      return 'failed'
    } finally {
      await this.finishGoalElapsedTimer(threadId, goalTimer)
      // Decide cross-turn goal resume before clearing the per-turn progress
      // marker it reads.
      await this.evaluateGoalResume(threadId, turnId, finalStatus ?? 'failed')
      this.autoModelRoutes.delete(autoModelRouteKey(threadId, turnId))
      this.toolStormBreakers.delete(turnId)
      this.lastNoToolTextByTurn.delete(turnId)
      this.goalNoToolRecoveryStepsByTurn.delete(turnId)
      this.turnMadeProgress.delete(turnId)
      this.goalResumeSuppressedByTurn.delete(turnId)
      this.emptyPostToolRecoveryStepsByTurn.delete(turnId)
      this.turnFailures.delete(turnId)
      await this.runTurnEndHooks(threadId, turnId, finalStatus ?? 'failed', finalError)
    }
  }

  /**
   * TurnStart (observe-only) then UserPromptSubmit hooks. Returns the
   * denial message when a UserPromptSubmit hook blocks the turn.
   * Accepted `additionalContext` is persisted as an extra user message
   * so replays and the prompt cache see a stable history.
   */
  private async runTurnStartLifecycleHooks(threadId: string, turnId: string): Promise<string | undefined> {
    const hooks = this.opts.hooks
    const hasStart = hasHooksForPhase(hooks, 'TurnStart')
    const hasSubmit = hasHooksForPhase(hooks, 'UserPromptSubmit')
    if (!hasStart && !hasSubmit) return undefined
    const turn = await this.opts.turns.getTurn(threadId, turnId)
    const thread = await this.opts.threadStore.get(threadId)
    const payload = {
      threadId,
      turnId,
      prompt: turn?.prompt ?? '',
      ...(thread?.workspace ? { workspace: thread.workspace } : {})
    }
    if (hasStart) {
      const started = await runObserverHooks(hooks, { phase: 'TurnStart', ...payload })
      await this.recordHookWarnings(threadId, turnId, started.warnings)
    }
    if (!hasSubmit) return undefined
    const submit = await runUserPromptSubmitHooks(hooks, payload)
    await this.recordHookWarnings(threadId, turnId, submit.warnings)
    if (submit.denied) return submit.denied
    if (submit.additionalContext.length > 0) {
      const now = this.opts.nowIso()
      const item: TurnItem = {
        id: this.opts.ids.next('item_hook'),
        turnId,
        threadId,
        role: 'user',
        status: 'completed',
        createdAt: now,
        finishedAt: now,
        kind: 'user_message',
        text: `<hook-context>\n${submit.additionalContext.join('\n\n')}\n</hook-context>`
      }
      await this.opts.turns.applyItem(threadId, item)
    }
    return undefined
  }

  /** Observe-only TurnEnd hooks; run after the turn is finalized and must never throw. */
  private async runTurnEndHooks(
    threadId: string,
    turnId: string,
    status: 'completed' | 'failed' | 'aborted',
    error?: string
  ): Promise<void> {
    if (!hasHooksForPhase(this.opts.hooks, 'TurnEnd')) return
    try {
      const outcome = await runObserverHooks(this.opts.hooks, {
        phase: 'TurnEnd',
        threadId,
        turnId,
        status,
        ...(error ? { error } : {})
      })
      await this.recordHookWarnings(threadId, turnId, outcome.warnings)
    } catch {
      // Observe-only: a TurnEnd hook must never break turn cleanup.
    }
  }

  private async recordHookWarnings(
    threadId: string,
    turnId: string,
    warnings: readonly string[]
  ): Promise<void> {
    for (const message of warnings) {
      await this.opts.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'hook_warning',
        severity: 'warning'
      })
    }
  }

  private async failTurn(threadId: string, turnId: string, message: string): Promise<void> {
    await this.opts.turns.finishTurn({ threadId, turnId, status: 'failed', error: message })
  }

  /**
   * After the FIRST assistant reply completes, generate a concise LLM title for
   * the thread — but only when the thread still carries a default/placeholder
   * title (so a user-set or already-generated title is never overwritten) and
   * only on the first completed turn. Model precedence: titleModel -> smallModel
   * -> main conversation model. Persists the title to the thread store and emits
   * a `thread_updated` event so the renderer's list refreshes. Best-effort: any
   * failure is swallowed by the fire-and-forget caller.
   */
  private async maybeGenerateThreadTitle(threadId: string, turnId: string, signal?: AbortSignal): Promise<void> {
    const thread = await this.opts.threadStore.get(threadId)
    if (!thread) return
    // Only on the first completed turn so we don't re-title on every reply.
    const completedTurns = thread.turns.filter((t) => t.status === 'completed').length
    if (completedTurns > 1) return
    if (!canUpgradeThreadTitle(thread)) return

    const items = await this.opts.sessionStore.loadItems(threadId)
    const userText = items.find((item) => item.kind === 'user_message')?.text ?? ''
    if (!userText.trim()) return
    const assistantText = items.find((item) => item.kind === 'assistant_text')?.text

    const resolved = resolveRoleModel({
      roleModel: this.opts.roles?.titleModel,
      roleProviderId: this.opts.roles?.titleProviderId,
      roles: this.opts.roles,
      mainModel: thread.model || this.opts.model.model,
      mainProviderId: thread.providerId
    })
    if (!resolved) return

    const title = await generateThreadTitle({
      threadId,
      turnId,
      modelClient: this.opts.model,
      model: resolved.model,
      ...(resolved.providerId ? { providerId: resolved.providerId } : {}),
      userText,
      ...(assistantText ? { assistantText } : {}),
      ...(this.opts.roles?.titleReasoningEffort
        ? { reasoningEffort: this.opts.roles.titleReasoningEffort }
        : {}),
      ...(signal ? { abortSignal: signal } : {})
    })
    if (!title) return

    // Re-check the title is still upgradeable (no user rename raced us).
    const latest = await this.opts.threadStore.get(threadId)
    if (!latest || !canUpgradeThreadTitle(latest)) return
    // Keep titleAuto:true — the LLM title is still auto-generated, so a later
    // user rename can still lock it, but we won't re-title (gated by turn count).
    const updated = touchThread({ ...latest, title, titleAuto: true }, this.opts.nowIso())
    await this.opts.threadStore.upsert(updated)
    await this.opts.events.record({
      kind: 'thread_updated',
      threadId,
      title: updated.title,
      titleAuto: true,
      status: updated.status
    })
  }

  private rememberTurnFailure(turnId: string, failure: TurnFailure): void {
    if (!failure.error.trim()) return
    this.turnFailures.set(turnId, failure)
  }

  private modelClientDiagnostics(providerId?: string): ModelClientDiagnostics {
    const client = this.opts.model as ModelClient & {
      config?: {
        baseUrl?: string
        endpointFormat?: string
        model?: string
      }
      configFor?: (providerId?: string) => {
        baseUrl?: string
        endpointFormat?: string
        model?: string
      } | undefined
    }
    const config = client.configFor?.(providerId) ?? client.config
    return {
      provider: client.provider,
      ...(config?.baseUrl ? { providerBaseUrl: sanitizeProviderBaseUrl(config.baseUrl) } : {}),
      ...(config?.endpointFormat ? { endpointFormat: config.endpointFormat } : {}),
      ...(config?.model ? { configuredModel: config.model } : {})
    }
  }

  private nowMs(): number {
    return this.opts.nowMs?.() ?? Date.now()
  }

  private async startGoalElapsedTimer(threadId: string): Promise<GoalElapsedTimer | null> {
    const thread = await this.opts.threadStore.get(threadId)
    const goal = thread?.goal
    if (!goal || goal.status !== 'active') return null
    return {
      startedAtMs: this.nowMs(),
      createdAt: goal.createdAt,
      objective: goal.objective
    }
  }

  private async finishGoalElapsedTimer(
    threadId: string,
    timer: GoalElapsedTimer | null
  ): Promise<void> {
    if (!timer) return
    const elapsedSeconds = Math.floor(Math.max(0, this.nowMs() - timer.startedAtMs) / 1000)
    if (elapsedSeconds <= 0) return

    const current = await this.opts.threadStore.get(threadId)
    const currentGoal = current?.goal
    if (!current || !currentGoal) return
    if (currentGoal.createdAt !== timer.createdAt || currentGoal.objective !== timer.objective) {
      return
    }

    const now = this.opts.nowIso()
    const goal: ThreadGoal = {
      ...currentGoal,
      timeUsedSeconds: (currentGoal.timeUsedSeconds ?? 0) + elapsedSeconds,
      updatedAt: now
    }
    const updated = touchThread({ ...current, goal }, now)
    await this.opts.threadStore.upsert(updated)
    await this.opts.events.record({
      kind: 'goal_updated',
      threadId,
      goal
    })
  }

  /**
   * Decide whether to auto-resume the goal after a turn settles (path B).
   *
   * A goal still `active` once the turn ends means the model never marked it
   * complete or blocked, so the objective is unfinished and nothing is running
   * (KunAgent/Kun#370). Mirroring codex's idle-relaunch-while-active policy, we
   * drive a fresh continuation turn — routed through the backoff coordinator —
   * not only after a `failed` turn (error / step-budget) but also after a
   * `completed` turn that left the goal active (e.g. the model stopped early or
   * its output was truncated). Without this, such a clean stop stranded the
   * goal with the banner still showing "in progress" until the user nudged it.
   *
   * Deliberate stops are never relaunched: a plan turn, a user interrupt or
   * shutdown (`aborted`), and the caps that set `goalResumeSuppressedByTurn`
   * (cost-budget exhaustion, or a repetition stall that made no real progress
   * — relaunching those would just re-hit the budget or reproduce the filler).
   * A repetition stall that *did* make progress first (e.g. edited files, then
   * trailed off) is not suppressed: it resumes like any other unfinished turn.
   * When the consecutive no-progress budget is exhausted the goal is moved to
   * `blocked` so the banner reflects reality.
   */
  private async evaluateGoalResume(
    threadId: string,
    turnId: string,
    finalStatus: 'completed' | 'failed' | 'aborted'
  ): Promise<void> {
    const thread = await this.opts.threadStore.get(threadId)
    const goal = thread?.goal
    if (!thread || !goal || goal.status !== 'active') {
      this.goalResume.clear(threadId)
      return
    }
    const turn = thread.turns.find((t) => t.id === turnId)
    const wasPlanTurn = turn?.mode === 'plan' || Boolean(turn?.guiPlan)
    const deliberateStop = this.goalResumeSuppressedByTurn.has(turnId)
    if (finalStatus === 'aborted' || wasPlanTurn || deliberateStop) {
      this.goalResume.clear(threadId)
      return
    }
    const outcome = this.goalResume.noteGoalTurnSettled({
      threadId,
      goalKey: goalResumeKey(threadId, goal),
      madeProgress: this.turnMadeProgress.has(turnId)
    })
    if (outcome === 'exhausted') {
      await this.transitionGoalStatus(
        threadId,
        turnId,
        'blocked',
        `Goal auto-resume stopped: ${DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS} consecutive attempts made no progress. Set the goal active again to retry.`
      )
    }
  }

  /** Start and drive a fresh continuation turn for the thread's active goal. */
  private async launchGoalResumeTurn(threadId: string): Promise<void> {
    const thread = await this.opts.threadStore.get(threadId)
    const goal = thread?.goal
    if (!thread || !goal || goal.status !== 'active') return
    // Inherit headless/IM gating from the most recent turn so a resumed turn
    // doesn't deadlock awaiting user input that will never arrive.
    const lastTurn = thread.turns[thread.turns.length - 1]
    const started = await this.opts.turns.startTurn({
      threadId,
      request: {
        prompt: GOAL_RESUME_PROMPT,
        mode: 'agent',
        ...(lastTurn?.disableUserInput ? { disableUserInput: true } : {})
      }
    })
    await this.opts.events.record({
      kind: 'error',
      threadId,
      turnId: started.turnId,
      message: 'Auto-resuming the active goal after an interrupted turn.',
      code: 'goal_auto_resume',
      severity: 'warning'
    })
    // Fire-and-forget: the new turn drives its own lifecycle and re-enters
    // evaluateGoalResume when it settles.
    void this.runTurn(threadId, started.turnId)
  }

  /** Move a goal out of `active` (e.g. to `blocked`) and surface why. */
  private async transitionGoalStatus(
    threadId: string,
    turnId: string,
    status: ThreadGoal['status'],
    message?: string
  ): Promise<void> {
    const current = await this.opts.threadStore.get(threadId)
    const goal = current?.goal
    if (!current || !goal || goal.status === status) return
    const now = this.opts.nowIso()
    const next: ThreadGoal = { ...goal, status, updatedAt: now }
    await this.opts.threadStore.upsert(touchThread({ ...current, goal: next }, now))
    await this.opts.events.record({ kind: 'goal_updated', threadId, goal: next })
    if (message) {
      await this.opts.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'goal_auto_resume_exhausted',
        severity: 'warning'
      })
    }
  }

  private async drainSteering(threadId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const pending = this.opts.steering.drain()
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

  private async loop(
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<'completed' | 'failed' | 'aborted'> {
    for (let step = 0; ; step += 1) {
      if (signal.aborted) return 'aborted'
      await this.drainSteering(threadId, turnId, signal)
      const stepResult = await this.modelStep(threadId, turnId, signal, step)
      if (stepResult === 'stop') return 'completed'
      if (stepResult === 'failed') return 'failed'
      if (stepResult === 'aborted') return 'aborted'
    }
  }

  private async modelStep(
    threadId: string,
    turnId: string,
    signal: AbortSignal,
    stepIndex = 0
  ): Promise<'continue' | 'stop' | 'failed' | 'aborted'> {
    if (shouldVerifyImmutablePrefix()) {
      verifyImmutablePrefix(this.opts.prefix)
    }
    const [thread, turn] = await Promise.all([
      this.opts.threadStore.get(threadId),
      this.opts.turns.getTurn(threadId, turnId)
    ])
    await this.recordPipelineStage(threadId, turnId, 'input_received', { stepIndex })
    const candidatePlanContext = turn?.guiPlan
      ? { ...turn.guiPlan, turnId }
      : this.opts.activePlanContext
    // A plan context whose workspace doesn't match this thread is stale — e.g.
    // carried in by a conversation fork. Drop it so the turn runs as a normal
    // agent turn instead of hard-failing create_plan on the workspace mismatch
    // or forcing a plan-only tool set the cloned history can't satisfy.
    const planContextStale = isStalePlanContext(candidatePlanContext, thread?.workspace ?? '')
    const activePlanContext = planContextStale ? undefined : candidatePlanContext
    const budgetGate = await this.checkBudgetGate(thread, threadId, turnId)
    if (budgetGate === 'blocked') {
      // A cost-budget stop is a deliberate cap, not an interrupted goal turn:
      // suppress goal auto-resume so it isn't relaunched straight back into
      // the same exhausted budget.
      this.goalResumeSuppressedByTurn.add(turnId)
      return 'stop'
    }
    const loadedItems = await this.opts.sessionStore.loadItems(threadId)
    // Heal (and possibly rewrite) on-disk history once per turn: within a
    // turn the loop only appends well-formed items, and healing's deep
    // change detection costs two full-history stringifies per call.
    let historyItems: TurnItem[] = loadedItems
    if (stepIndex === 0) {
      const healed = healLoadedHistoryItems(loadedItems)
      if (healed.changed) {
        await this.opts.sessionStore.rewriteItems(threadId, healed.items)
      }
      historyItems = healed.items
    }
    await this.recordPipelineStage(
      threadId,
      turnId,
      'input_cached',
      prefixVolatilityStageDetails(detectVolatilePrefixContent(this.opts.prefix))
    )
    if (stepIndex > 0) {
      const toolResultCount = historyItems.filter(
        (item) => item.turnId === turnId && item.kind === 'tool_result'
      ).length
      await this.opts.events.record({
        kind: 'tool_result_upload_wait',
        threadId,
        turnId,
        status: 'waiting',
        toolResultCount
      })
    }
    const items = repairModelHistoryItems(
      effectiveHistoryAfterLatestCompaction(historyItems)
    )
    const approvalPolicy = normalizeApprovalPolicy(thread?.approvalPolicy)
    const sandboxMode = normalizeSandboxMode(thread?.sandboxMode)
    // Per-turn mode overrides the thread mode so the GUI can toggle
    // Plan/agent (and run Build as agent) without recreating the thread.
    const effectiveMode = turn?.mode ?? thread?.mode
    const modelRoute = await this.resolveTurnModel({
      threadId,
      turnId,
      latestRequest: turn?.prompt ?? '',
      items,
      signal,
      reasoningEffort: turn?.reasoningEffort,
      candidates: [turn?.model, thread?.model, this.opts.model.model]
    })
    await this.recordPipelineStage(threadId, turnId, 'input_routed', {
      model: modelRoute.model,
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {})
    })
    const model = modelRoute.model
    const modelCapabilities = this.opts.modelCapabilities?.(model) ?? modelCapabilitiesForModel(model)
    const attachments = await this.resolveAttachments({
      attachmentIds: turn?.attachmentIds ?? [],
      threadId,
      workspace: thread?.workspace ?? '',
      modelCapabilities
    })
    const skillResolution = await this.opts.skillRuntime?.resolveTurn({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? '',
      ...(this.opts.blockedSkillIds ? { blockedSkillIds: this.opts.blockedSkillIds } : {})
    }) ?? {
      activeSkillIds: [],
      activations: [],
      instructions: [],
      injectedBytes: 0
    }
    const instructionResolution = await this.opts.instructionRuntime?.resolveTurn({
      workspace: thread?.workspace ?? ''
    }) ?? {
      instruction: undefined,
      sources: [],
      injectedBytes: 0
    }
    const memories = await this.retrieveMemories({
      prompt: turn?.prompt ?? '',
      workspace: thread?.workspace ?? ''
    })
    const planTurnActive = !planContextStale && (effectiveMode === 'plan' || Boolean(activePlanContext))
    const activeGoalInstruction = planTurnActive
      ? null
      : goalContinuationInstruction(thread?.goal)
    const goalRecoveryInstruction = activeGoalInstruction
      ? goalNoToolRecoveryInstruction(this.goalNoToolRecoveryStepsByTurn.get(turnId) ?? 0)
      : null
    const activeTodoInstruction = planTurnActive
      ? null
      : todoContinuationInstruction(thread?.todos)
    const allowedToolNames = intersectAllowedToolNames(
      allowedToolNamesWithGuiStateTools(
        skillResolution.allowedToolNames,
        activeGoalInstruction !== null
      ),
      this.opts.forcedAllowedToolNames
    )
    // IM/headless turns run without the user-input gate. The tools stay
    // advertised so GUI/IM transitions keep a stable provider tool
    // catalog; execution returns a tool error if the model calls them.
    const userInputDisabled = turn?.disableUserInput === true
    const toolContext: ToolHostContext = {
      threadId,
      turnId,
      workspace: thread?.workspace ?? '',
      threadMode: effectiveMode,
      ...(activePlanContext ? { guiPlan: activePlanContext } : {}),
      ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(turn?.imContext ? { imContext: true } : {}),
      model: modelCapabilities,
      activeSkillIds: skillResolution.activeSkillIds,
      memoryPolicy: { enabled: Boolean(this.opts.memoryStore) },
      delegationPolicy: { enabled: false },
      ...(allowedToolNames ? { allowedToolNames } : {}),
      ...(this.opts.blockedProviderIds ? { blockedProviderIds: this.opts.blockedProviderIds } : {}),
      ...(this.opts.blockedToolNames ? { blockedToolNames: this.opts.blockedToolNames } : {}),
      ...(this.opts.blockedSkillIds ? { blockedSkillIds: this.opts.blockedSkillIds } : {}),
      approvalPolicy,
      sandboxMode,
      ...(this.opts.runtimeDataDir ? { runtimeDataDir: this.opts.runtimeDataDir } : {}),
      abortSignal: signal,
      awaitApproval: async () => 'allow',
      ...(userInputDisabled
        ? {}
        : { awaitUserInput: (input) => this.awaitUserInput(threadId, turnId, input, signal) })
    }
    const tools = await this.opts.toolHost.listTools(toolContext)
    const toolSpecs: ModelToolSpec[] = tools
    const toolProviderMetadata = new Map(
      tools.map((tool) => [tool.name, { providerId: tool.providerId, providerKind: tool.providerKind }])
    )
    const toolCatalog = buildToolCatalogFingerprint(toolSpecs)
    const toolCatalogDrift = this.recordToolCatalogFingerprint({
      threadId,
      workspace: thread?.workspace ?? '',
      mode: effectiveMode ?? 'agent',
      model: modelCapabilities.id,
      activeSkillIds: skillResolution.activeSkillIds,
      allowedToolNames,
      userInputDisabled,
      guiDesignCanvas: turn?.guiDesignCanvas === true,
      fingerprint: toolCatalog.fingerprint,
      toolNames: toolCatalog.toolNames,
      toolHashes: toolCatalog.toolHashes
    })
    const toolCatalogDriftMessage = toolCatalogDrift.kind !== 'none'
      ? buildToolCatalogDriftMessage(toolCatalog, toolCatalogDrift.kind)
      : undefined
    if (toolCatalogDrift.kind !== 'none' && toolCatalogDriftMessage) {
      await this.recordToolCatalogDrift({
        threadId,
        turnId,
        fingerprint: toolCatalog.fingerprint,
        toolCount: toolCatalog.toolCount,
        toolNames: toolCatalog.toolNames,
        changeKind: toolCatalogDrift.kind,
        message: toolCatalogDriftMessage
      })
    }
    if (turn) {
      await this.opts.turns.updateTurnMetadata(threadId, turnId, {
        activeSkillIds: skillResolution.activeSkillIds,
        skillInjectionBytes: skillResolution.injectedBytes,
        injectedMemoryIds: memories.map((memory) => memory.id),
        injectedMemorySummaries: memories.map((memory) => ({
          id: memory.id,
          content: memoryPreview(memory.content)
        })),
        injectedInstructionSources: instructionResolution.sources,
        instructionInjectionBytes: instructionResolution.injectedBytes,
        toolCatalogFingerprint: toolCatalog.fingerprint,
        toolCatalogToolCount: toolCatalog.toolCount,
        toolCatalogDrift: toolCatalogDrift.kind !== 'none'
      })
    }
    if (toolCatalogDrift.kind === 'breaking') return 'stop'
    const toolKinds = new Map(toolSpecs.map((tool) => [tool.name, tool.toolKind]))
    const createPlanSatisfied = planTurnActive
      ? hasSuccessfulCreatePlanResult(historyItems, turnId)
      : false
    const requiredToolName =
      planTurnActive &&
      !createPlanSatisfied &&
      toolSpecs.some((tool) => tool.name === CREATE_PLAN_TOOL_NAME)
        ? CREATE_PLAN_TOOL_NAME
        : undefined
    const suggestVerification =
      !planTurnActive &&
      toolSpecs.some((tool) => tool.name === VERIFY_CHANGES_TOOL_NAME) &&
      turnHasUnverifiedSourceChanges(historyItems, turnId)
    const effectiveToolSpecs = resolvePlanModeToolSpecs(toolSpecs, {
      planTurnActive,
      createPlanSatisfied,
      stepIndex
    })
    const history = await this.compactIfNeeded(items, model, signal, {
      threadId,
      turnId,
      visibleItems: historyItems,
      toolSpecs: effectiveToolSpecs
    })
    if (signal.aborted) return 'aborted'
    await this.recordPipelineStage(threadId, turnId, 'input_compressed', {
      historyItems: history.length
    })
    // Forward the just-generated image(s) back to a vision-capable model so it can
    // self-review and regenerate if the result is off. Bytes come from the
    // already-persisted attachment/file; the persisted tool output keeps NO base64
    // (only this transient request copy carries it).
    const forwardHistory = await rehydrateGeneratedImagesForForward(
      history,
      (output) => this.resolveGeneratedImageForForward(output, threadId, thread?.workspace),
      MAX_FORWARDED_GENERATED_IMAGES
    )
    const runtimeContextInstruction = shouldInjectInitialRuntimeContext({
      stepIndex,
      turnId,
      historyItems
    })
      ? buildRuntimeContextInstruction({
          workspace: thread?.workspace,
          nowIso: this.opts.nowIso()
        })
      : null
    const toolPreferenceInstruction = buildToolPreferenceInstruction(tools)
    const contextInstructions = [
      ...(runtimeContextInstruction ? [runtimeContextInstruction] : []),
      ...(instructionResolution.instruction ? [instructionResolution.instruction] : []),
      ...(activeGoalInstruction ? [activeGoalInstruction] : []),
      ...(goalRecoveryInstruction && (this.goalNoToolRecoveryStepsByTurn.get(turnId) ?? 0) > 0
        ? [goalRecoveryInstruction]
        : []),
      ...(activeTodoInstruction ? [activeTodoInstruction] : []),
      ...((this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0) > 0
        ? [emptyPostToolRecoveryInstruction()]
        : []),
      ...imageGenerationReferenceInstructions({
        imageAttachments: attachments.imageAttachments,
        textFallbacks: attachments.textFallbacks,
        workspace: thread?.workspace ?? '',
        tools: effectiveToolSpecs
      }),
      ...memoryInstructions(memories),
      ...(skillResolution.catalogInstruction ? [skillResolution.catalogInstruction] : []),
      ...skillResolution.instructions,
      ...(userInputDisabled ? [userInputUnavailableInstruction()] : []),
      ...(toolPreferenceInstruction ? [toolPreferenceInstruction] : []),
      ...(effectiveToolSpecs.some((tool) => tool.name === 'bash') ? [shellRuntimeInstruction()] : []),
      ...(suggestVerification ? [verificationSuggestionInstruction()] : []),
      ...(toolCatalogDriftMessage ? [toolCatalogDriftMessage] : [])
    ]
    await this.recordPipelineStage(threadId, turnId, 'input_remembered', {
      memoryCount: memories.length,
      contextInstructionCount: contextInstructions.length
    })
    const tokenEconomy = normalizeTokenEconomyConfig(this.opts.tokenEconomy)
    const providerId = turn?.providerId?.trim() || thread?.providerId?.trim()
    const baseRequest: ModelRequest = {
      threadId,
      turnId,
      model,
      ...(providerId ? { providerId } : {}),
      // Thread-level systemPrompt (primary-agent persona snapshot) is
      // appended to the runtime base — same augment strategy as child agents
      // (child-agent-executor) — so the agent keeps kun's tool/safety
      // conventions and skill catalog instead of losing them to the persona.
      // Empty/whitespace falls back to the immutable prefix verbatim so
      // unbound threads keep the prompt-cache fingerprint.
      systemPrompt: thread?.systemPrompt?.trim()
        ? `${this.opts.prefix.systemPrompt}\n\n${thread.systemPrompt.trim()}`
        : this.opts.prefix.systemPrompt,
      ...(planTurnActive ? { modeInstruction: PLAN_MODE_INSTRUCTION } : {}),
      ...(contextInstructions.length ? { contextInstructions } : {}),
      prefix: this.opts.prefix.fewShots,
      history: capToolResultImages(forwardHistory, MAX_FORWARDED_TOOL_IMAGES),
      ...(attachments.imageAttachments.length ? { attachments: attachments.imageAttachments } : {}),
      ...(attachments.textFallbacks.length ? { attachmentTextFallbacks: attachments.textFallbacks } : {}),
      ...(attachments.documents.length ? { attachmentDocuments: attachments.documents } : {}),
      tools: effectiveToolSpecs,
      ...(requiredToolName ? { requiredToolName } : {}),
      ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
      abortSignal: signal
    }
    const rawInputTokens = tokenEconomy.enabled
      ? estimateModelRequestInputTokens(baseRequest)
      : 0
    const economyRequest = applyTokenEconomyToRequest(baseRequest, tokenEconomy)
    const request: ModelRequest = {
      ...economyRequest,
      history: applyRequestHistoryHygiene(economyRequest.history, tokenEconomy.historyHygiene, {
        currentTurnId: turnId
      })
    }
    if (tokenEconomy.enabled) {
      await this.recordTokenEconomySavings({
        threadId,
        turnId,
        model,
        rawInputTokens,
        sentInputTokens: estimateModelRequestInputTokens(request)
      })
    }
    const textAccumulator: { value: string } = { value: '' }
    const reasoningAccumulator: { value: string } = { value: '' }
    let textItemId = ''
    let reasoningItemId = ''
    const completedToolCalls: ToolCallLike[] = []
    let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
    const modelClientDiagnostics = this.modelClientDiagnostics(request.providerId)
    const cacheSignature: CacheRequestSignature = {
      model: request.model,
      providerId: request.providerId?.trim() || modelClientDiagnostics.provider || 'default',
      endpointFormat: modelClientDiagnostics.endpointFormat || 'unknown',
      prefixFingerprint: this.opts.prefix.fingerprint,
      toolCatalogFingerprint: toolCatalog.fingerprint,
      activeSkillIds: skillResolution.activeSkillIds
    }
    let persistedReasoning = false
    let persistedText = false
    const persistAccumulatedResponse = async (): Promise<void> => {
      if (!persistedReasoning && reasoningAccumulator.value) {
        persistedReasoning = true
        const itemId = reasoningItemId || this.opts.ids.next('item_reasoning')
        await this.opts.turns.applyItem(
          threadId,
          makeAssistantReasoningItem({
            id: itemId,
            turnId,
            threadId,
            text: reasoningAccumulator.value,
            status: 'completed'
          })
        )
      }
      if (!persistedText && textAccumulator.value) {
        persistedText = true
        const itemId = textItemId || this.opts.ids.next('item_text')
        await this.opts.turns.applyItem(
          threadId,
          makeAssistantTextItem({
            id: itemId,
            turnId,
            threadId,
            text: textAccumulator.value,
            status: 'completed'
          })
        )
      }
    }
    await this.recordPipelineStage(threadId, turnId, 'pre_send', {
      model: request.model,
      ...modelClientDiagnostics,
      historyItems: request.history.length,
      toolCount: request.tools.length,
      ...(request.requiredToolName ? { requiredToolName: request.requiredToolName } : {}),
      ...attachmentRequestPipelineDetails({
        attachmentIds: turn?.attachmentIds ?? [],
        imageAttachments: attachments.imageAttachments,
        textFallbacks: attachments.textFallbacks,
        documents: attachments.documents,
        modelCapabilities
      })
    })
    await this.recordPipelineStage(threadId, turnId, 'post_send', {
      model: request.model,
      ...modelClientDiagnostics
    })
    for await (const chunk of this.opts.model.stream(request)) {
      if (signal.aborted) {
        await persistAccumulatedResponse()
        return 'aborted'
      }
      switch (chunk.kind) {
        case 'assistant_text_delta':
          textItemId ||= this.opts.ids.next('item_text')
          textAccumulator.value += chunk.text
          await this.opts.events.record({
            kind: 'assistant_text_delta',
            threadId,
            turnId,
            itemId: textItemId,
            item: makeAssistantTextItem({
              id: textItemId,
              turnId,
              threadId,
              text: chunk.text,
              status: 'running'
            })
          })
          break
        case 'assistant_reasoning_delta':
          reasoningItemId ||= this.opts.ids.next('item_reasoning')
          reasoningAccumulator.value += chunk.text
          await this.opts.events.record({
            kind: 'assistant_reasoning_delta',
            threadId,
            turnId,
            itemId: reasoningItemId,
            item: makeAssistantReasoningItem({
              id: reasoningItemId,
              turnId,
              threadId,
              text: chunk.text,
              status: 'running'
            })
          })
          break
        case 'tool_call_delta':
          break
        case 'retrying':
          await this.opts.events.record({
            kind: 'model_request_retry',
            threadId,
            turnId,
            status: chunk.status,
            attempt: chunk.attempt,
            maxAttempts: chunk.maxAttempts,
            delayMs: chunk.delayMs
          })
          break
        case 'tool_call_complete': {
          const provider = toolProviderMetadata.get(chunk.toolName)
          const toolKind = toolKinds.get(chunk.toolName)
          const repaired = repairDispatchToolArguments(chunk.arguments, {
            toolName: chunk.toolName,
            ...(toolKind ? { toolKind } : {}),
            ...(this.opts.toolArgumentRepair?.maxStringBytes !== undefined
              ? { maxStringBytes: this.opts.toolArgumentRepair.maxStringBytes }
              : {})
          })
          completedToolCalls.push({
            callId: chunk.callId,
            toolName: chunk.toolName,
            ...(provider?.providerId ? { providerId: provider.providerId } : {}),
            toolKind,
            arguments: repaired.arguments
          })
          const itemId = `item_tool_${turnId}_${chunk.callId}`
          await this.opts.turns.applyItem(
            threadId,
            makeToolCallItem({
              id: itemId,
              turnId,
              threadId,
              callId: chunk.callId,
              toolName: chunk.toolName,
              toolKind,
              arguments: repaired.arguments,
              ...(repaired.notes.length
                ? { summary: `Repaired tool arguments: ${repaired.notes.join('; ')}` }
                : {})
            })
          )
          await this.opts.events.record({
            kind: 'tool_call_ready',
            threadId,
            turnId,
            itemId,
            callId: chunk.callId,
            toolName: chunk.toolName,
            readyCount: completedToolCalls.length
          })
          break
        }
        case 'image_generation_complete': {
          const imgDir = '.deepseekgui-images'
          const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
          const fileName = `img-${stamp}-${randomBytes(2).toString('hex')}.png`
          const relativePath = `${imgDir}/${fileName}`
          const workspace = thread?.workspace ?? ''
          const absolutePath = join(workspace, imgDir, fileName)
          await mkdir(join(workspace, imgDir), { recursive: true })
          await writeFile(absolutePath, Buffer.from(chunk.imageBase64, 'base64'))
          const imageMarkdown = `\n![generated image](${relativePath})\n`
          textItemId ||= this.opts.ids.next('item_text')
          textAccumulator.value += imageMarkdown
          await this.opts.events.record({
            kind: 'assistant_text_delta',
            threadId,
            turnId,
            itemId: textItemId,
            item: makeAssistantTextItem({
              id: textItemId,
              turnId,
              threadId,
              text: imageMarkdown,
              status: 'running'
            })
          })
          break
        }
        case 'usage': {
          this.recordPromptPressure(threadId, request.model, chunk.usage.promptTokens)
          const usage = this.opts.usage.record(threadId, chunk.usage, cacheSignature)
          await this.opts.events.record({
            kind: 'usage',
            threadId,
            turnId,
            model: request.model,
            usage
          })
          break
        }
        case 'completed':
          if (stopReason !== 'error') stopReason = chunk.stopReason
          break
        case 'error':
          this.rememberTurnFailure(turnId, {
            error: chunk.message,
            ...(chunk.code ? { code: chunk.code } : {}),
            severity: 'error'
          })
          await this.opts.events.record({
            kind: 'error',
            threadId,
            turnId,
            message: chunk.message,
            code: chunk.code,
            severity: 'error'
          })
          stopReason = 'error'
          break
      }
    }
    if (signal.aborted) {
      await persistAccumulatedResponse()
      return 'aborted'
    }
    await this.recordPipelineStage(threadId, turnId, 'response_received', {
      stopReason,
      toolCallCount: completedToolCalls.length
    })
    await persistAccumulatedResponse()
    if (stopReason === 'error') return 'failed'
    if (completedToolCalls.length === 0) {
      if (request.requiredToolName) {
        if (
          request.requiredToolName === CREATE_PLAN_TOOL_NAME &&
          textAccumulator.value.trim()
        ) {
          // The model asked the user to decide instead of producing a plan
          // (ambiguous request). Don't materialize a question into a bogus
          // plan — end the turn so the user can answer; the next plan turn
          // produces a real plan once the scope is settled.
          if (isPlanClarifyingQuestion(textAccumulator.value)) {
            return 'stop'
          }
          const callId = this.opts.ids.next('call_plan')
          const provider = toolProviderMetadata.get(CREATE_PLAN_TOOL_NAME)
          const toolKind = toolKinds.get(CREATE_PLAN_TOOL_NAME)
          const sourceRequest = activePlanContext?.sourceRequest ||
            latestUserMessageText(historyItems, turnId) ||
            turn?.prompt ||
            ''
          const argumentsForFallback: Record<string, unknown> = activePlanContext
            ? {
                markdown: textAccumulator.value.trim(),
                operation: activePlanContext.operation,
                plan_id: activePlanContext.planId,
                plan_relative_path: activePlanContext.relativePath,
                ...(sourceRequest ? { source_request: sourceRequest } : {}),
                ...(activePlanContext.title ? { title: activePlanContext.title } : {})
              }
            : {
                markdown: textAccumulator.value.trim(),
                operation: 'draft',
                ...(sourceRequest ? { source_request: sourceRequest } : {})
              }
          const call: ToolCallLike = {
            callId,
            toolName: CREATE_PLAN_TOOL_NAME,
            ...(provider?.providerId ? { providerId: provider.providerId } : {}),
            toolKind,
            arguments: argumentsForFallback
          }
          const itemId = `item_tool_${turnId}_${callId}`
          await this.opts.turns.applyItem(
            threadId,
            makeToolCallItem({
              id: itemId,
              turnId,
              threadId,
              callId,
              toolName: CREATE_PLAN_TOOL_NAME,
              toolKind,
              arguments: argumentsForFallback,
              summary: 'Materialized assistant plan text into the required GUI plan.'
            })
          )
          await this.opts.events.record({
            kind: 'tool_call_ready',
            threadId,
            turnId,
            itemId,
            callId,
            toolName: CREATE_PLAN_TOOL_NAME,
            readyCount: 1
          })
          const dispatched = await this.dispatchToolCalls({
            calls: [call],
            threadId,
            turnId,
            workspace: thread?.workspace ?? '',
            threadMode: effectiveMode,
            activePlanContext,
            guiDesignCanvas: turn?.guiDesignCanvas === true,
            modelProviderId: providerId,
            modelCapabilities,
            activeSkillIds: skillResolution.activeSkillIds,
            allowedToolNames,
            toolProviderKinds: new Map(tools.map((tool) => [tool.name, tool.providerKind])),
            approvalPolicy,
            sandboxMode,
            signal
          })
          if (dispatched === 'aborted') return 'aborted'
          if (dispatched === 'all_suppressed') return 'stop'
          return 'continue'
        }
        const message = `Model did not call the required \`${request.requiredToolName}\` tool for this GUI plan turn.`
        await this.opts.events.record({
          kind: 'error',
          threadId,
          turnId,
          message,
          code: 'required_tool_missing'
        })
        await this.opts.turns.applyItem(
          threadId,
          makeErrorItem({
            id: this.opts.ids.next('item_error'),
            turnId,
            threadId,
            message,
            code: 'required_tool_missing'
          })
        )
        return 'failed'
      }
      const hasCurrentTurnFileChange = historyItems.some(
        (item) =>
          item.turnId === turnId &&
          item.kind === 'tool_call' &&
          item.toolKind === 'file_change' &&
          item.toolName !== CREATE_PLAN_TOOL_NAME
      )
      if (
        stopReason === 'stop' &&
        !textAccumulator.value.trim() &&
        hasCurrentTurnFileChange
      ) {
        const recoverySteps = (this.emptyPostToolRecoveryStepsByTurn.get(turnId) ?? 0) + 1
        if (recoverySteps <= EMPTY_POST_TOOL_MAX_RECOVERY_STEPS) {
          this.emptyPostToolRecoveryStepsByTurn.set(turnId, recoverySteps)
          return 'continue'
        }

        const message =
          'Model stopped without a final answer after tool execution, including after a recovery retry.'
        this.rememberTurnFailure(turnId, {
          error: message,
          code: 'empty_post_tool_continuation',
          severity: 'error'
        })
        await this.opts.events.record({
          kind: 'error',
          threadId,
          turnId,
          message,
          code: 'empty_post_tool_continuation',
          severity: 'error'
        })
        await this.opts.turns.applyItem(
          threadId,
          makeErrorItem({
            id: this.opts.ids.next('item_error'),
            turnId,
            threadId,
            message,
            code: 'empty_post_tool_continuation',
            severity: 'error'
          })
        )
        return 'failed'
      }
      if (stopReason === 'stop' && activeGoalInstruction) {
        const previousText = this.lastNoToolTextByTurn.get(turnId)
        if (isRepeatedNoToolAssistantText(previousText, textAccumulator.value)) {
          const recoverySteps = (this.goalNoToolRecoveryStepsByTurn.get(turnId) ?? 0) + 1
          if (recoverySteps <= GOAL_NO_TOOL_REPEAT_MAX_RECOVERY_STEPS) {
            this.goalNoToolRecoveryStepsByTurn.set(turnId, recoverySteps)
            this.lastNoToolTextByTurn.set(turnId, textAccumulator.value)
            return 'continue'
          }
          const message =
            'Goal continuation stopped: the model kept repeating near-identical replies without calling tools or updating the goal.'
          await this.opts.turns.applyItem(
            threadId,
            makeErrorItem({
              id: this.opts.ids.next('item_error'),
              turnId,
              threadId,
              message,
              code: 'goal_repetition_stop',
              severity: 'warning'
            })
          )
          await this.opts.events.record({
            kind: 'error',
            threadId,
            turnId,
            message,
            code: 'goal_repetition_stop',
            severity: 'warning'
          })
          this.lastNoToolTextByTurn.delete(turnId)
          this.goalNoToolRecoveryStepsByTurn.delete(turnId)
          // A repetition stall on a turn that never made real progress would
          // just be reproduced by a fresh resume turn, so suppress auto-resume.
          // But a turn that edited files (etc.) and only then trailed off into
          // "I'm done" filler IS advancing the goal — the common "stops right
          // after editing files" case — so let the normal resume path carry it
          // forward instead of stranding it.
          if (!this.turnMadeProgress.has(turnId)) {
            this.goalResumeSuppressedByTurn.add(turnId)
          }
          return 'stop'
        }
        this.goalNoToolRecoveryStepsByTurn.delete(turnId)
        this.lastNoToolTextByTurn.set(turnId, textAccumulator.value)
        return 'continue'
      }
      if (stopReason === 'length') {
        // The model hit its output-token ceiling and was cut off without a tool
        // call. Don't report this as a clean completion — surface a warning so
        // the truncation is visible instead of looking like the model "gave up".
        const message =
          'The model reached its maximum output length and the response was truncated. ' +
          'Raise the model’s max output tokens, or ask it to continue or split the work into smaller steps.'
        await this.opts.events.record({
          kind: 'error',
          threadId,
          turnId,
          message,
          code: 'output_truncated',
          severity: 'warning'
        })
        await this.opts.turns.applyItem(
          threadId,
          makeErrorItem({
            id: this.opts.ids.next('item_error'),
            turnId,
            threadId,
            message,
            code: 'output_truncated',
            severity: 'warning'
          })
        )
        return 'stop'
      }
      return 'stop'
    }
    // Tool calls mean the turn is making progress again; reset the no-tool
    // repetition window so unrelated later status texts are not compared.
    this.lastNoToolTextByTurn.delete(turnId)
    this.goalNoToolRecoveryStepsByTurn.delete(turnId)
    this.emptyPostToolRecoveryStepsByTurn.delete(turnId)
    const dispatched = await this.dispatchToolCalls({
      calls: completedToolCalls,
      threadId,
      turnId,
      workspace: thread?.workspace ?? '',
      threadMode: effectiveMode,
      activePlanContext,
      guiDesignCanvas: turn?.guiDesignCanvas === true,
      modelProviderId: providerId,
      modelCapabilities,
      activeSkillIds: skillResolution.activeSkillIds,
      allowedToolNames,
      userInputDisabled,
      imContext: turn?.imContext === true,
      toolProviderKinds: new Map(tools.map((tool) => [tool.name, tool.providerKind])),
      approvalPolicy,
      sandboxMode,
      signal
    })
    if (dispatched === 'aborted') return 'aborted'
    if (dispatched === 'all_suppressed') return 'stop'
    return 'continue'
  }

  private async dispatchToolCalls(input: {
    calls: ToolCallLike[]
    threadId: string
    turnId: string
    workspace: string
    threadMode?: 'agent' | 'plan'
    activePlanContext?: GuiPlanContext
    guiDesignCanvas?: boolean
    modelProviderId?: string
    modelCapabilities: ModelCapabilityMetadata
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    userInputDisabled?: boolean
    imContext?: boolean
    toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
    approvalPolicy: ToolHostContext['approvalPolicy']
    sandboxMode: NonNullable<ToolHostContext['sandboxMode']>
    signal: AbortSignal
  }): Promise<'continue' | 'aborted' | 'all_suppressed'> {
    const context = this.createToolContext(input)
    let index = 0
    let executedAny = false
    const markProgress = (toolName: string): void => {
      if (!GOAL_NON_PROGRESS_TOOL_NAMES.has(toolName)) {
        this.turnMadeProgress.add(input.turnId)
      }
    }

    while (index < input.calls.length) {
      if (input.signal.aborted) return 'aborted'

      const call = input.calls[index]
      if (!call) break

      const storm = this.toolStormBreakers.get(input.turnId)?.inspect(call)
      if (storm?.suppress) {
        await this.persistSuppressedToolCall({
          threadId: input.threadId,
          turnId: input.turnId,
          call,
          reason: storm.reason
        })
        index += 1
        continue
      }

      if (!this.isParallelSafeToolCall(call, input.approvalPolicy, input.toolProviderKinds)) {
        const result = await this.executeToolCallSafely({
          threadId: input.threadId,
          turnId: input.turnId,
          call,
          context
        })
        executedAny = true
        markProgress(call.toolName)
        await this.persistToolCallResult(input.threadId, input.turnId, call, result)
        index += 1
        continue
      }

      // Keep batches homogeneous: delegation children fan out together (the
      // runtime semaphore bounds real concurrency), while built-in read-only
      // tools stay capped at MAX_PARALLEL_TOOL_CALLS.
      const headIsDelegation = this.isParallelDelegationCall(call, input.toolProviderKinds)
      const batchCap = headIsDelegation ? input.calls.length : MAX_PARALLEL_TOOL_CALLS
      const batch: ToolCallLike[] = [call]
      index += 1
      let suppressedAfterBatch: { call: ToolCallLike; reason?: string } | undefined

      while (batch.length < batchCap && index < input.calls.length) {
        const next = input.calls[index]
        if (!next) break
        if (!this.isParallelSafeToolCall(next, input.approvalPolicy, input.toolProviderKinds)) break
        if (this.isParallelDelegationCall(next, input.toolProviderKinds) !== headIsDelegation) break

        const nextStorm = this.toolStormBreakers.get(input.turnId)?.inspect(next)
        if (nextStorm?.suppress) {
          suppressedAfterBatch = { call: next, reason: nextStorm.reason }
          index += 1
          break
        }

        batch.push(next)
        index += 1
      }

      const settled = await Promise.allSettled(
        batch.map((entry) =>
          this.executeToolCallSafely({
            threadId: input.threadId,
            turnId: input.turnId,
            call: entry,
            context
          })
        )
      )
      executedAny = true
      for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
        const result = settled[batchIndex]
        const batchCall = batch[batchIndex]
        if (!result || !batchCall) continue
        if (result.status === 'rejected') throw result.reason
        markProgress(batchCall.toolName)
        await this.persistToolCallResult(input.threadId, input.turnId, batchCall, result.value)
      }

      if (suppressedAfterBatch) {
        await this.persistSuppressedToolCall({
          threadId: input.threadId,
          turnId: input.turnId,
          call: suppressedAfterBatch.call,
          reason: suppressedAfterBatch.reason
        })
      }
    }

    return executedAny ? 'continue' : 'all_suppressed'
  }

  private isParallelSafeToolCall(
    call: ToolCallLike,
    approvalPolicy: ToolHostContext['approvalPolicy'],
    toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  ): boolean {
    // always / untrusted / never 会触发审批或阻断工具调用，不能并发扇出。
    if (approvalPolicy === 'always' || approvalPolicy === 'untrusted' || approvalPolicy === 'never') return false
    // Delegated children are isolated runs; multiple in one assistant message
    // are independent and safe to fan out. The delegation runtime caps real
    // concurrency at maxParallel and queues the overflow.
    if (this.isParallelDelegationCall(call, toolProviderKinds)) return true
    if (!PARALLEL_READ_ONLY_TOOL_NAMES.has(call.toolName)) return false
    if (call.toolKind && call.toolKind !== 'tool_call') return false
    return toolProviderKinds.get(call.toolName) === 'built-in'
  }

  private isParallelDelegationCall(
    call: ToolCallLike,
    toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  ): boolean {
    return (
      call.toolName === DELEGATE_TASK_TOOL_NAME &&
      toolProviderKinds.get(call.toolName) === 'delegation'
    )
  }

  private createToolContext(input: {
    threadId: string
    turnId: string
    workspace: string
    threadMode?: 'agent' | 'plan'
    activePlanContext?: GuiPlanContext
    guiDesignCanvas?: boolean
    modelProviderId?: string
    modelCapabilities: ModelCapabilityMetadata
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    userInputDisabled?: boolean
    imContext?: boolean
    approvalPolicy: ToolHostContext['approvalPolicy']
    sandboxMode: NonNullable<ToolHostContext['sandboxMode']>
    signal: AbortSignal
  }): ToolHostContext {
    return {
      threadId: input.threadId,
      turnId: input.turnId,
      workspace: input.workspace,
      threadMode: input.threadMode,
      ...(input.activePlanContext ? { guiPlan: input.activePlanContext } : {}),
      ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(input.imContext ? { imContext: true } : {}),
      model: input.modelCapabilities,
      ...(input.modelProviderId ? { modelProviderId: input.modelProviderId } : {}),
      activeSkillIds: input.activeSkillIds,
      memoryPolicy: { enabled: Boolean(this.opts.memoryStore) },
      delegationPolicy: { enabled: false },
      ...(input.allowedToolNames ? { allowedToolNames: input.allowedToolNames } : {}),
      ...(this.opts.blockedProviderIds ? { blockedProviderIds: this.opts.blockedProviderIds } : {}),
      ...(this.opts.blockedToolNames ? { blockedToolNames: this.opts.blockedToolNames } : {}),
      ...(this.opts.blockedSkillIds ? { blockedSkillIds: this.opts.blockedSkillIds } : {}),
      approvalPolicy: input.approvalPolicy,
      sandboxMode: input.sandboxMode,
      ...(this.opts.runtimeDataDir ? { runtimeDataDir: this.opts.runtimeDataDir } : {}),
      ...(this.opts.artifactStore ? { artifactStore: this.opts.artifactStore } : {}),
      abortSignal: input.signal,
      awaitApproval: async (approval) => {
        await this.opts.events.record({
          kind: 'approval_requested',
          threadId: approval.threadId,
          turnId: approval.turnId,
          approvalId: approval.id,
          toolName: approval.toolName,
          status: 'pending',
          approvalPolicy: input.approvalPolicy,
          sandboxMode: input.sandboxMode,
          summary: approval.summary
        })
        return this.opts.approvalGate.request(approval)
      },
      ...(input.userInputDisabled
        ? {}
        : {
            awaitUserInput: (inputRequest) =>
              this.awaitUserInput(input.threadId, input.turnId, inputRequest, input.signal)
          })
    }
  }

  private async executeToolCall(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    context: ToolHostContext
  }): Promise<ToolHostResult> {
    return this.opts.inflight.run(
      {
        id: `inflight_${input.call.callId}`,
        kind: 'tool',
        threadId: input.threadId,
        turnId: input.turnId,
        callId: input.call.callId
      },
      async () => {
        try {
          return await this.opts.toolHost.execute(input.call, input.context, async (item) => {
            const existing = await this.opts.turns.updateItem(input.threadId, item.id, {
              output: item.kind === 'tool_result' ? item.output : undefined,
              isError: item.kind === 'tool_result' ? item.isError : undefined,
              status: 'running'
            } as Partial<TurnItem>)
            if (existing) return
            await this.opts.turns.applyItem(input.threadId, item)
          })
        } catch (error) {
          if (input.context.abortSignal.aborted || !this.isRecoverableToolDispatchError(error)) {
            throw error
          }
          const message = error instanceof Error ? error.message : String(error)
          const planActive =
            input.context.threadMode === 'plan' || Boolean(input.context.guiPlan)
          const guidance = planActive
            ? `\`${input.call.toolName}\` is not available in Plan mode. Do NOT try to write deliverable files now. Call \`create_plan\` and put a COMPLETE implementation plan in its \`markdown\` argument — concrete steps, the files to create with their intended contents, and how to verify. Do NOT copy this message into the plan; write the actual plan. If the request is still ambiguous, ask the user a clarifying question and wait instead.`
            : 'Use only tools advertised in the current turn context.'
          await this.opts.events.record({
            kind: 'error',
            threadId: input.threadId,
            turnId: input.turnId,
            message: `Tool call ${input.call.toolName} was rejected: ${message}`,
            code: 'tool_dispatch_rejected',
            severity: 'warning'
          })
          return {
            item: makeToolResultItem({
              id: `item_${input.call.callId}`,
              turnId: input.turnId,
              threadId: input.threadId,
              callId: input.call.callId,
              toolName: input.call.toolName,
              toolKind: input.call.toolKind ?? 'tool_call',
              output: {
                code: 'tool_dispatch_rejected',
                error: message,
                guidance
              },
              isError: true
            }),
            approved: false
          }
        }
      }
    )
  }

  /**
   * A crashing tool handler must surface as an error tool_result the
   * model can react to, not kill the whole turn. Only turn aborts are
   * allowed to propagate.
   */
  private async executeToolCallSafely(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    context: ToolHostContext
  }): Promise<ToolHostResult> {
    try {
      return await this.executeToolCall(input)
    } catch (error) {
      if (input.context.abortSignal.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      await this.opts.events.record({
        kind: 'error',
        threadId: input.threadId,
        turnId: input.turnId,
        message: `Tool call ${input.call.toolName} failed: ${message}`,
        code: 'tool_execution_failed',
        severity: 'warning'
      })
      return {
        item: makeToolResultItem({
          id: `item_${input.call.callId}`,
          turnId: input.turnId,
          threadId: input.threadId,
          callId: input.call.callId,
          toolName: input.call.toolName,
          toolKind: input.call.toolKind ?? 'tool_call',
          output: {
            code: 'tool_execution_failed',
            error: message,
            guidance:
              'The tool crashed while executing. Adjust the arguments or take a different approach instead of retrying the identical call.'
          },
          isError: true
        }),
        approved: false
      }
    }
  }

  private isRecoverableToolDispatchError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      message.startsWith('unknown tool:') ||
      message.includes(' is not provided by ') ||
      message.includes(' is not advertised') ||
      message.includes(' is disabled by policy')
    )
  }

  private async persistToolCallResult(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    await this.opts.turns.updateItem(threadId, `item_tool_${turnId}_${call.callId}`, {
      status: result.item.kind === 'tool_result' && result.item.isError ? 'failed' : 'completed',
      finishedAt: this.opts.nowIso()
    } as Partial<TurnItem>)
    await this.opts.turns.applyItem(threadId, result.item)
    await this.afterToolResultPersisted(threadId, turnId, call, result)
  }

  private async afterToolResultPersisted(
    threadId: string,
    turnId: string,
    call: ToolCallLike,
    result: ToolHostResult
  ): Promise<void> {
    if (call.toolName !== CREATE_PLAN_TOOL_NAME) return
    if (result.item.kind !== 'tool_result' || result.item.isError === true) return
    const output = result.item.output
    if (!output || typeof output !== 'object') return
    const record = output as Record<string, unknown>
    const planId = typeof record.plan_id === 'string' ? record.plan_id : ''
    const relativePath = typeof record.relative_path === 'string' ? record.relative_path : ''
    const markdown = typeof call.arguments.markdown === 'string' ? call.arguments.markdown : ''
    if (!planId || !relativePath || !markdown) return
    try {
      await this.opts.onPlanWritten?.({
        threadId,
        turnId,
        planId,
        relativePath,
        markdown
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.opts.events.record({
        kind: 'error',
        threadId,
        turnId,
        message: `Failed to sync plan checklist to thread todos: ${message}`,
        code: 'todo_plan_sync_failed',
        severity: 'warning'
      })
    }
  }

  private async persistSuppressedToolCall(input: {
    threadId: string
    turnId: string
    call: ToolCallLike
    reason?: string
  }): Promise<void> {
    const item = makeToolResultItem({
      id: `item_${input.call.callId}_storm`,
      turnId: input.turnId,
      threadId: input.threadId,
      callId: input.call.callId,
      toolName: input.call.toolName,
      toolKind: input.call.toolKind ?? 'tool_call',
      output: { error: input.reason ?? 'duplicate tool call suppressed by repeat-loop guard' },
      isError: true
    })
    const message = input.reason ?? 'duplicate tool call suppressed by repeat-loop guard'
    await this.opts.turns.updateItem(input.threadId, `item_tool_${input.turnId}_${input.call.callId}`, {
      status: 'failed',
      finishedAt: this.opts.nowIso()
    } as Partial<TurnItem>)
    await this.opts.turns.applyItem(input.threadId, item)
    await this.opts.events.record({
      kind: 'tool_storm_suppressed',
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: item.id,
      toolName: input.call.toolName,
      callId: input.call.callId,
      message
    })
  }

  private async awaitUserInput(
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ): Promise<UserInputResolution> {
    const item = makeUserInputItem({
      id: input.itemId,
      threadId,
      turnId,
      inputId: input.id,
      prompt: input.prompt,
      questions: input.questions
    })
    await this.opts.turns.applyItem(threadId, item)
    await this.opts.events.record({
      kind: 'user_input_requested',
      threadId,
      turnId,
      itemId: item.id,
      inputId: input.id,
      status: 'pending',
      prompt: input.prompt,
      questions: input.questions
    })

    const resolution = await this.waitForUserInput(threadId, turnId, input, signal)
    await this.opts.turns.updateItem(threadId, item.id, {
      status: resolution.status,
      finishedAt: this.opts.nowIso()
    } as Partial<TurnItem>)
    await this.opts.events.record({
      kind: 'user_input_resolved',
      threadId,
      turnId,
      itemId: item.id,
      inputId: input.id,
      status: resolution.status,
      prompt: input.prompt,
      questions: input.questions
    })
    return resolution
  }

  private async waitForUserInput(
    threadId: string,
    turnId: string,
    input: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ): Promise<UserInputResolution> {
    const pending = this.opts.userInputGate.request({
      id: input.id,
      threadId,
      turnId,
      itemId: input.itemId,
      prompt: input.prompt,
      questions: input.questions
    })
    if (!signal.aborted) {
      return new Promise<UserInputResolution>((resolve, reject) => {
        const onAbort = (): void => {
          this.opts.userInputGate.resolve(input.id, { status: 'cancelled' })
          signal.removeEventListener('abort', onAbort)
          reject(new Error('cancelled while awaiting user input'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        pending
          .then((resolution) => {
            signal.removeEventListener('abort', onAbort)
            resolve(resolution)
          })
          .catch((error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          })
      })
    }
    this.opts.userInputGate.resolve(input.id, { status: 'cancelled' })
    throw new Error('cancelled while awaiting user input')
  }

  private async compactIfNeeded(
    items: TurnItem[],
    model: string,
    signal: AbortSignal,
    context: {
      threadId: string
      turnId: string
      visibleItems: TurnItem[]
      toolSpecs?: readonly ModelToolSpec[]
    }
  ): Promise<TurnItem[]> {
    // Restore the accurate provider token count after a process restart,
    // when the in-memory pressure map is empty. Without this the next
    // line falls back to the item-only estimator, which under-counts and
    // can silently skip compaction until the context overruns the window.
    await this.hydratePromptPressureIfCold(context.threadId, model)
    const pressure = this.consumePromptPressure(context.threadId, model)
    const thresholdModel = pressure?.model || model
    const overheadTokens = estimateRequestOverheadTokens({
      systemPrompt: this.opts.prefix.systemPrompt,
      prefix: this.opts.prefix.fewShots,
      tools: context.toolSpecs
    })
    const plan = this.opts.compactor.planCompaction(items, {
      model: thresholdModel,
      promptTokens: pressure?.promptTokens,
      overheadTokens
    })
    if (!plan) return items
    const threadId = context.threadId
    const turnId = context.turnId
    if (hasHooksForPhase(this.opts.hooks, 'PreCompact')) {
      const observed = await runObserverHooks(this.opts.hooks, {
        phase: 'PreCompact',
        threadId,
        turnId,
        reason: String(plan.reason),
        mode: String(plan.mode)
      })
      await this.recordHookWarnings(threadId, turnId, observed.warnings)
    }
    let result = this.opts.compactor.compact({
      threadId,
      turnId,
      history: items,
      prefix: this.opts.prefix,
      reason: plan.reason,
      mode: plan.mode,
      keepRecent: plan.keepRecent
    })
    if (result.replacedTokens > 0 && this.opts.contextCompaction?.summaryMode === 'model') {
      const compactionModel = resolveCompactionModel({
        contextCompaction: this.opts.contextCompaction,
        fallbackModel: model
      })
      const modelSummary = await summarizeCompactionWithModel({
        threadId,
        turnId,
        model: compactionModel.model,
        ...(compactionModel.providerId ? { providerId: compactionModel.providerId } : {}),
        modelClient: this.opts.model,
        prefix: this.opts.prefix,
        contextCompaction: this.opts.contextCompaction,
        items,
        heuristicSummary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        signal,
        recordUsage: async (usageSnapshot) => {
          const usage = this.opts.usage.record(threadId, usageSnapshot)
          await this.opts.events.record({
            kind: 'usage',
            threadId,
            turnId,
            model: compactionModel.model,
            usage
          })
        },
        recordFallback: async (message) => {
          await this.opts.events.record({
            kind: 'error',
            threadId,
            turnId,
            message,
            code: 'compaction_summary_fallback',
            severity: 'warning'
          })
        }
      })
      if (signal.aborted) return items
      if (modelSummary) {
        result = this.opts.compactor.compact({
          threadId,
          turnId,
          history: items,
          prefix: this.opts.prefix,
          reason: plan.reason,
          mode: plan.mode,
          keepRecent: plan.keepRecent,
          summaryOverride: modelSummary
        })
      }
    }
    if (result.replacedTokens > 0) {
      const visibleItems = insertCompactionIntoVisibleHistory({
        visibleItems: context.visibleItems,
        compactedItems: result.next,
        summaryItem: result.summaryItem
      })
      this.opts.toolHost.clearReadTracker?.(threadId)
      await this.opts.sessionStore.rewriteItems(threadId, visibleItems)
      await this.rewriteThreadItemsFromSession(threadId, visibleItems)
      await this.opts.events.record({
        kind: 'compaction_completed',
        threadId,
        turnId,
        itemId: result.summaryItem.id,
        summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
        replacedTokens: result.replacedTokens,
        pinnedConstraints: this.opts.prefix.pinnedConstraints,
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
          ? { sourceDigest: result.summaryItem.sourceDigest }
          : {}),
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
          ? { digestMarker: result.summaryItem.digestMarker }
          : {}),
        ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
          ? { sourceItemIds: result.summaryItem.sourceItemIds }
          : {})
      })
    }
    return result.next
  }

  private async rewriteThreadItemsFromSession(threadId: string, items: TurnItem[]): Promise<void> {
    if (items.length === 0) return
    const current = await this.opts.threadStore.get(threadId)
    if (!current) return
    const itemsByTurn = new Map<string, TurnItem[]>()
    for (const item of items) {
      const turnItems = itemsByTurn.get(item.turnId) ?? []
      turnItems.push(item)
      itemsByTurn.set(item.turnId, turnItems)
    }
    let changed = false
    const turns = current.turns.map((turn) => {
      const sessionItems = itemsByTurn.get(turn.id)
      if (!sessionItems) return turn
      changed = true
      return { ...turn, items: placeCompactionsAtTurnEnd(sessionItems) }
    })
    if (!changed) return
    await this.opts.threadStore.upsert(touchThread({ ...current, turns }, this.opts.nowIso()))
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

  private recordPromptPressure(threadId: string, model: string, promptTokens: number): void {
    if (!threadId || promptTokens <= 0) return
    const current = this.promptTokenPressure.get(threadId)
    if (current && current.promptTokens >= promptTokens) return
    this.promptTokenPressure.set(threadId, { model, promptTokens })
  }

  /**
   * Seed `promptTokenPressure` from persisted usage the first time a thread
   * is touched in this process. The pressure map is in-memory only, so after
   * a restart the compaction trigger would otherwise rely on the item-only
   * estimator (which omits the system prompt and tool schemas) and could
   * skip compaction for an already-oversized thread. `loadUsageRecords`
   * returns per-request deltas ordered oldest-first, so the last positive
   * entry is the most recent request's prompt size — the best available
   * proxy for the current context pressure. Best-effort: any failure leaves
   * the estimator (plus overhead floor) as the fallback.
   */
  private async hydratePromptPressureIfCold(threadId: string, fallbackModel: string): Promise<void> {
    if (!threadId) return
    if (this.promptTokenPressure.has(threadId)) return
    if (this.hydratedPressureThreads.has(threadId)) return
    this.hydratedPressureThreads.add(threadId)
    const loadUsageRecords = this.opts.sessionStore.loadUsageRecords
    if (typeof loadUsageRecords !== 'function') return
    try {
      const records = await loadUsageRecords.call(this.opts.sessionStore, { threadId })
      let restored: { model: string; promptTokens: number } | undefined
      for (const record of records) {
        if (record.threadId !== threadId) continue
        const promptTokens = Math.floor(record.usage?.promptTokens ?? 0)
        if (promptTokens > 0) {
          restored = { model: record.model || fallbackModel, promptTokens }
        }
      }
      if (restored && !this.promptTokenPressure.has(threadId)) {
        this.promptTokenPressure.set(threadId, restored)
      }
    } catch {
      // Best-effort restore; the estimator + overhead floor still applies.
    }
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

  private recordToolCatalogFingerprint(input: {
    threadId: string
    workspace: string
    mode: string
    model: string
    activeSkillIds: readonly string[]
    allowedToolNames?: readonly string[]
    userInputDisabled?: boolean
    guiDesignCanvas?: boolean
    fingerprint: string
    toolNames: string[]
    toolHashes: Record<string, string>
  }): ToolCatalogDrift {
    const key = JSON.stringify({
      threadId: input.threadId,
      workspace: input.workspace,
      mode: input.mode,
      model: input.model,
      activeSkillIds: [...input.activeSkillIds].sort(),
      allowedToolNames: input.allowedToolNames ? [...input.allowedToolNames].sort() : [],
      userInputDisabled: input.userInputDisabled === true,
      guiDesignCanvas: input.guiDesignCanvas === true
    })
    const current: ToolCatalogSnapshot = {
      fingerprint: input.fingerprint,
      toolNames: input.toolNames,
      toolHashes: input.toolHashes
    }
    const previous = this.toolCatalogSnapshots.get(key)
    this.toolCatalogSnapshots.delete(key)
    this.toolCatalogSnapshots.set(key, current)
    if (this.toolCatalogSnapshots.size > MAX_TOOL_CATALOG_SNAPSHOTS) {
      const oldest = this.toolCatalogSnapshots.keys().next().value
      if (oldest !== undefined) this.toolCatalogSnapshots.delete(oldest)
    }
    if (!previous || previous.fingerprint === input.fingerprint) return { kind: 'none' }
    return isAdditiveToolCatalogChange(previous, current)
      ? { kind: 'additive', previous }
      : { kind: 'breaking', previous }
  }

  private async checkBudgetGate(
    thread: Awaited<ReturnType<ThreadStore['get']>>,
    threadId: string,
    turnId: string
  ): Promise<'allow' | 'blocked'> {
    if (!thread) return 'allow'
    const budget = thread.costBudgetUsd
    if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) return 'allow'
    const spent = this.opts.usage.forThread(threadId).costUsd ?? 0
    if (spent >= budget) {
      const message = `Cost budget exhausted for this thread: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.opts.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_limited`,
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      }))
      await this.opts.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_limited'
      })
      return 'blocked'
    }
    if (spent >= budget * 0.8 && thread.costBudgetWarningSent !== true) {
      const message = `Cost budget warning: $${spent.toFixed(4)} used of $${budget.toFixed(4)}.`
      await this.opts.threadStore.upsert({
        ...thread,
        costBudgetWarningSent: true,
        updatedAt: this.opts.nowIso()
      })
      await this.opts.turns.applyItem(threadId, makeErrorItem({
        id: `item_${turnId}_budget_warning`,
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      }))
      await this.opts.events.record({
        kind: 'error',
        threadId,
        turnId,
        message,
        code: 'budget_warning',
        severity: 'warning'
      })
    }
    return 'allow'
  }

  private consumePromptPressure(
    threadId: string,
    model: string
  ): { model: string; promptTokens: number } | undefined {
    if (!threadId) return undefined
    const pressure = this.promptTokenPressure.get(threadId)
    if (!pressure) return undefined
    this.promptTokenPressure.delete(threadId)
    return {
      model: pressure.model || model,
      promptTokens: pressure.promptTokens
    }
  }

  private async resolveTurnModel(input: {
    threadId: string
    turnId: string
    latestRequest: string
    items: readonly TurnItem[]
    signal: AbortSignal
    reasoningEffort?: string
    candidates: Array<string | undefined>
  }): Promise<{ model: string; reasoningEffort?: string }> {
    const requestedReasoningEffort = normalizeRequestedReasoningEffort(input.reasoningEffort)
    const resolved = resolveModelMode(...input.candidates)
    if (resolved.kind === 'fixed') {
      return {
        model: resolved.model,
        ...(requestedReasoningEffort ? { reasoningEffort: requestedReasoningEffort } : {})
      }
    }
    const key = autoModelRouteKey(input.threadId, input.turnId)
    const cached = this.autoModelRoutes.get(key)
    if (cached) {
      return {
        model: cached.model,
        reasoningEffort: requestedReasoningEffort ?? cached.reasoningEffort
      }
    }
    const route = await resolveAutoModelRoute({
      modelClient: this.opts.model,
      threadId: input.threadId,
      turnId: input.turnId,
      latestRequest: input.latestRequest,
      recentContext: recentAutoRouterContext(input.items, input.turnId),
      selectedModelMode: 'auto',
      abortSignal: input.signal
    })
    this.autoModelRoutes.set(key, route)
    return {
      model: route.model,
      reasoningEffort: requestedReasoningEffort ?? route.reasoningEffort
    }
  }

  private async resolveAttachments(input: {
    attachmentIds: readonly string[]
    threadId: string
    workspace: string
    modelCapabilities: ModelCapabilityMetadata
  }): Promise<{ imageAttachments: ModelInputAttachment[]; textFallbacks: ModelTextAttachmentFallback[]; documents: ModelDocumentAttachment[] }> {
    if (input.attachmentIds.length === 0) return { imageAttachments: [], textFallbacks: [], documents: [] }
    if (!this.opts.attachmentStore) {
      throw new Error('attachment store is unavailable')
    }
    const supportsImageInput = input.modelCapabilities.inputModalities.includes('image')
    const textFallbackPolicy = this.opts.attachmentStore.textFallbackPolicy()
    const imageAttachments: ModelInputAttachment[] = []
    const textFallbacks: ModelTextAttachmentFallback[] = []
    const documents: ModelDocumentAttachment[] = []
    let remainingDocumentChars = 400_000
    for (const id of input.attachmentIds) {
      const attachment = await this.opts.attachmentStore.resolveContent(id, {
        threadId: input.threadId,
        workspace: input.workspace
      })
      if (attachment.kind === 'document') {
        const fullText = attachment.documentText ?? ''
        const text = fullText.slice(0, Math.max(0, remainingDocumentChars))
        remainingDocumentChars -= text.length
        documents.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          text,
          byteSize: attachment.byteSize,
          ...(attachment.pageCount ? { pageCount: attachment.pageCount } : {}),
          ...(attachment.truncated || text.length < fullText.length ? { truncated: true } : {}),
          ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {})
        })
        if (remainingDocumentChars <= 0) break
        continue
      }
      if (supportsImageInput) {
        imageAttachments.push({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataBase64: attachment.data.toString('base64'),
          ...(attachment.width ? { width: attachment.width } : {}),
          ...(attachment.height ? { height: attachment.height } : {}),
          ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {})
        })
        continue
      }
      textFallbacks.push(buildTextAttachmentFallback(
        attachment,
        textFallbackPolicy.textFallbackMaxBase64Bytes
      ))
    }
    return { imageAttachments, textFallbacks, documents }
  }

  /**
   * Resolve the bytes of a generate_image result for transient model forwarding:
   * prefer the attachment the tool already created (authorized for this thread),
   * fall back to reading the saved file. Returns null (no image forwarded) on any
   * miss so a scope/auth error degrades gracefully rather than throwing.
   */
  private async resolveGeneratedImageForForward(
    output: Record<string, unknown>,
    threadId: string,
    workspace: string | undefined
  ): Promise<ToolResultImage | null> {
    const fromBytes = (data: Buffer, fallbackMime?: string): ToolResultImage => {
      const detected = detectImage(data)
      return {
        mimeType: detected?.mimeType ?? fallbackMime ?? 'image/png',
        dataBase64: data.toString('base64'),
        ...(detected?.width !== undefined ? { width: detected.width } : {}),
        ...(detected?.height !== undefined ? { height: detected.height } : {})
      }
    }
    const attachments = Array.isArray(output.attachments) ? output.attachments : []
    const firstAttachment = attachments[0]
    const attachmentId =
      firstAttachment && typeof firstAttachment === 'object' &&
      typeof (firstAttachment as { id?: unknown }).id === 'string'
        ? (firstAttachment as { id: string }).id
        : ''
    if (attachmentId && this.opts.attachmentStore) {
      try {
        const content = await this.opts.attachmentStore.resolveContent(attachmentId, {
          threadId,
          ...(workspace ? { workspace } : {})
        })
        return fromBytes(content.data, content.mimeType)
      } catch {
        // fall through to reading the file on disk
      }
    }
    const files = Array.isArray(output.files) ? output.files : []
    const firstFile = files[0]
    const absolutePath =
      firstFile && typeof firstFile === 'object' &&
      typeof (firstFile as { absolutePath?: unknown }).absolutePath === 'string'
        ? (firstFile as { absolutePath: string }).absolutePath
        : ''
    if (absolutePath) {
      try {
        return fromBytes(await readFile(absolutePath))
      } catch {
        // no-op
      }
    }
    return null
  }

  private async retrieveMemories(input: {
    prompt: string
    workspace: string
  }) {
    if (!this.opts.memoryStore) return []
    const memories = await this.opts.memoryStore.retrieve({
      query: input.prompt,
      workspace: input.workspace,
      limit: 8
    })
    this.opts.memoryStore.setLastInjected(memories.map((memory) => memory.id))
    return memories
  }

  /** Convenience factory for tests: builds a loop with sensible defaults. */
  static defaultPrefix(): ImmutablePrefix {
    return createImmutablePrefix({
      systemPrompt: 'You are Kun, a careful and helpful assistant.',
      pinnedConstraints: ['user: preserve recent turns', 'project: keep responses concise']
    })
  }
}

function buildTextAttachmentFallback(
  attachment: AttachmentContent,
  maxBase64Bytes: number
): ModelTextAttachmentFallback {
  const fallback = attachment.textFallback
  if (fallback) {
    const fallbackBase64Bytes = Buffer.byteLength(fallback.dataBase64, 'utf8')
    if (fallbackBase64Bytes > maxBase64Bytes) {
      throw new Error(`attachment ${attachment.id} text fallback exceeds ${maxBase64Bytes} base64 byte limit`)
    }
    return {
      id: attachment.id,
      name: attachment.name,
      mimeType: fallback.mimeType,
      dataBase64: fallback.dataBase64,
      byteSize: fallback.byteSize,
      ...(fallback.width ? { width: fallback.width } : {}),
      ...(fallback.height ? { height: fallback.height } : {}),
      ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {}),
      ...(fallback.wasCompressed !== undefined ? { wasCompressed: fallback.wasCompressed } : {})
    }
  }

  const originalBase64 = attachment.data.toString('base64')
  if (Buffer.byteLength(originalBase64, 'utf8') > maxBase64Bytes) {
    throw new Error(
      `attachment ${attachment.id} is missing a compressed text fallback and original base64 exceeds ${maxBase64Bytes} byte limit`
    )
  }
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    dataBase64: originalBase64,
    byteSize: attachment.byteSize,
    ...(attachment.width ? { width: attachment.width } : {}),
    ...(attachment.height ? { height: attachment.height } : {}),
    ...(attachment.localFilePath ? { localFilePath: attachment.localFilePath } : {}),
    wasCompressed: false
  }
}

function attachmentRequestPipelineDetails(input: {
  attachmentIds: readonly string[]
  imageAttachments: readonly ModelInputAttachment[]
  textFallbacks: readonly ModelTextAttachmentFallback[]
  documents?: readonly ModelDocumentAttachment[]
  modelCapabilities: ModelCapabilityMetadata
}): Record<string, unknown> {
  const documents = input.documents ?? []
  if (
    input.attachmentIds.length === 0 &&
    input.imageAttachments.length === 0 &&
    input.textFallbacks.length === 0 &&
    documents.length === 0
  ) {
    return {}
  }
  return {
    attachmentIds: [...input.attachmentIds],
    modelInputModalities: [...input.modelCapabilities.inputModalities],
    modelMessageParts: [...input.modelCapabilities.messageParts],
    imageAttachmentCount: input.imageAttachments.length,
    imageAttachmentBase64Bytes: input.imageAttachments.reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.dataBase64, 'base64'),
      0
    ),
    imageAttachmentMimeTypes: [...new Set(input.imageAttachments.map((attachment) => attachment.mimeType))],
    textFallbackCount: input.textFallbacks.length,
    textFallbackBase64Bytes: input.textFallbacks.reduce(
      (total, attachment) => total + Buffer.byteLength(attachment.dataBase64, 'utf8'),
      0
    ),
    textFallbackMimeTypes: [...new Set(input.textFallbacks.map((attachment) => attachment.mimeType))],
    documentCount: documents.length,
    documentTextChars: documents.reduce((total, document) => total + document.text.length, 0),
    documentMimeTypes: [...new Set(documents.map((document) => document.mimeType))]
  }
}

function imageGenerationReferenceInstructions(input: {
  imageAttachments: readonly ModelInputAttachment[]
  textFallbacks: readonly ModelTextAttachmentFallback[]
  workspace: string
  tools: readonly Pick<ModelToolSpec, 'name'>[]
}): string[] {
  if (!input.tools.some((tool) => tool.name === 'generate_image')) return []

  const references = [...input.imageAttachments, ...input.textFallbacks]
    .filter((attachment) => attachment.mimeType.startsWith('image/'))
    .map((attachment) => ({
      name: attachment.name,
      path: workspaceRelativeAttachmentPath(attachment.localFilePath, input.workspace)
    }))
    .filter((attachment): attachment is { name: string; path: string } => Boolean(attachment.path))

  if (references.length === 0) return []
  return [[
    'Image-to-image reference images are available for this turn:',
    ...references.map((reference) => `- ${reference.name}: ${reference.path}`),
    'For image edits, restyles, redraws, or transformations, call `generate_image` with the matching workspace-relative path(s) in `reference_image_paths`.'
  ].join('\n')]
}

function workspaceRelativeAttachmentPath(
  localFilePath: string | undefined,
  workspace: string
): string | null {
  const workspaceRoot = workspace.trim()
  const rawPath = localFilePath?.trim()
  if (!workspaceRoot || !rawPath) return null

  const workspaceAbsolute = resolve(workspaceRoot)
  const fileAbsolute = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspaceAbsolute, rawPath)
  const relativePath = relative(workspaceAbsolute, fileAbsolute)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null
  return relativePath.replace(/\\/g, '/')
}

function normalizeApprovalPolicy(
  value: string | undefined
): ToolHostContext['approvalPolicy'] {
  switch (value) {
    case 'on-request':
    case 'always':
    case 'never':
    case 'auto':
    case 'suggest':
    case 'untrusted':
      return value
    default:
      return DEFAULT_APPROVAL_POLICY
  }
}

function normalizeSandboxMode(
  value: string | undefined
): NonNullable<ToolHostContext['sandboxMode']> {
  switch (value) {
    case 'read-only':
    case 'workspace-write':
    case 'danger-full-access':
    case 'external-sandbox':
      return value
    default:
      return DEFAULT_SANDBOX_MODE
  }
}

function isAdditiveToolCatalogChange(previous: ToolCatalogSnapshot, current: ToolCatalogSnapshot): boolean {
  let added = false
  for (const name of current.toolNames) {
    if (!previous.toolHashes[name]) added = true
  }
  if (!added) return false
  for (const name of previous.toolNames) {
    const previousHash = previous.toolHashes[name]
    const currentHash = current.toolHashes[name]
    if (!previousHash || !currentHash || previousHash !== currentHash) return false
  }
  return true
}

function buildToolCatalogDriftMessage(toolCatalog: {
  fingerprint: string
  toolCount: number
  toolNames: string[]
}, changeKind: 'additive' | 'breaking'): string {
  const sample = toolCatalog.toolNames.slice(0, 12).join(', ')
  const suffix = toolCatalog.toolNames.length > 12 ? `, +${toolCatalog.toolNames.length - 12} more` : ''
  const policy = changeKind === 'additive'
    ? 'Only additive tool changes are allowed in-place; Kun will continue with the refreshed tool list.'
    : 'Non-additive tool changes can invalidate prompt-cache assumptions; Kun stopped this turn. Start a new thread after editing, removing, or reordering tool schemas.'
  return [
    `Tool catalog changed for this thread (${toolCatalog.toolCount} tools, fingerprint ${toolCatalog.fingerprint}).`,
    policy,
    sample ? `Current tools: ${sample}${suffix}.` : ''
  ].filter(Boolean).join(' ')
}

function resolveModelMode(...candidates: Array<string | undefined>): { kind: 'fixed'; model: string } | { kind: 'auto' } {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? ''
    if (!trimmed) continue
    return trimmed.toLowerCase() === 'auto'
      ? { kind: 'auto' }
      : { kind: 'fixed', model: trimmed }
  }
  return { kind: 'fixed', model: '' }
}

function normalizeRequestedReasoningEffort(effort: string | undefined): string | undefined {
  const normalized = effort?.trim().toLowerCase()
  return normalized && normalized !== 'auto' ? normalized : undefined
}

function sanitizeProviderBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '')
  }
}

function autoModelRouteKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`
}

export function memoryInstructions(memories: Array<{ id: string; content: string; scope: string }>): string[] {
  if (memories.length === 0) return []
  return [
    [
      'Relevant long-term memories for this turn:',
      ...memories.map((memory) => `- [${memory.id}] (${memory.scope}) ${memory.content}`)
    ].join('\n')
  ]
}

function prefixVolatilityStageDetails(
  findings: PrefixVolatilityFinding[]
): Record<string, unknown> | undefined {
  if (findings.length === 0) return undefined
  const kinds = [...new Set(findings.map((finding) => finding.kind))].sort()
  const fields = [...new Set(findings.map((finding) => finding.field))].sort()
  return {
    prefixVolatileTokenCount: findings.length,
    prefixVolatileTokenKinds: kinds,
    prefixVolatileFields: fields,
    noRegexDetector: true
  }
}
