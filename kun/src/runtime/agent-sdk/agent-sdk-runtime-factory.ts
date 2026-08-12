/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import {
  AgentSdkCredentialUnavailableError,
  AgentSdkRuntime,
  agentSdkCapabilities,
  type SdkRuntimeDeps,
  type SdkTurnContext
} from './agent-sdk-runtime.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import {
  normalizeClaudeOAuthToken,
  resolveSdkModel,
  type ToolApprovalDecision
} from './sdk-options-builder.js'
import {
  selectBridgeableTools,
  type BridgeableTool,
  type KunToolResult
} from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { LlmDebugSink } from '../../services/llm-debug-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import {
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
import {
  filterGoalContextsForGoalKey,
  goalContextKey
} from '../../loop/continuation-instructions.js'
import {
  DESIGN_MODE_INSTRUCTION,
  SVG_ARTIFACT_ALLOWED_TOOL_NAMES,
  SVG_ARTIFACT_MODE_INSTRUCTION
} from '../../loop/design-mode.js'
import type { GuiDesignArtifactContext, GuiPlanContext } from '../../ports/tool-host.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import { goalContextTexts, type TurnItem } from '../../contracts/items.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary,
  type ApprovalRequest,
  type ApprovalResolution
} from '../../domain/approval.js'
import type { ApprovalReviewPort } from '../../ports/approval-review.js'
import type { ActingTurnModelRoute } from '../../contracts/turns.js'
import { makeUserInputItem } from '../../domain/item.js'
import { awaitAbortableGate } from '../../services/interactive-gate.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'
import { mkdir } from 'node:fs/promises'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { buildClientSurfaceInstruction } from '../../prompt/kun-prompt-context.js'
import {
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  priorItemsForDelegatedTurn,
  type DelegatedSessionCoordinator,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'
import {
  delegatedGraphCompletionCheck,
  delegatedGraphAllowedToolNames,
  delegatedGraphTurnPolicy,
  intersectDelegatedToolNames,
  parkDelegatedGraphTurnAfterRecovery
} from '../delegated-graph-turn-policy.js'

const CLAUDE_KUN_TOOL_INSTRUCTION = [
  'Kun-managed capabilities are available through the mcp__kun__ tools.',
  'Use these tools for Kun capabilities such as MCP, extensions, skills, memory, media, GUI input, and delegation.',
  'Their execution remains governed by Kun ToolHost approval and sandbox policy.'
].join(' ')

const SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'TodoWrite'
])

export interface AgentSdkRuntimeFactoryDeps {
  registry: CapabilityRegistry
  /**
   * The canonical host boundary for bridged Kun tool execution. Serve always
   * supplies this; an omitted host is denied closed rather than bypassing the
   * policy, sandbox, approval, hook, and operation-journal layers.
   */
  toolHost?: ToolHost
  turns: TurnService
  sessionStore: SessionStore
  threadStore: ThreadStore
  events: RuntimeEventRecorder
  /** Existing Agent Perspective model-request trace sink. */
  debugSink?: LlmDebugSink
  ids: { next(prefix: string): string }
  prefix: { systemPrompt: string }
  /** serve.providers map; `kind:'agent-sdk'` entries carry the OAuth token in apiKey. */
  providerConfigs: Record<string, ServeProviderConfig>
  /** Provider ids whose kind is 'agent-sdk' (this runtime owns them). */
  agentSdkProviderIds: ReadonlySet<string>
  defaultApprovalPolicy: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  defaultApprovalReviewer?: ApprovalReviewer
  /** Isolated, no-tools automatic reviewer shared with native Kun turns. */
  approvalReview?: ApprovalReviewPort
  /** Runtime default model — used as the Claude model when a thread carries a non-Anthropic id. */
  defaultModel?: string
  /** True when the runtime's own default provider is agent-sdk (Claude sub as main model). */
  defaultIsAgentSdk?: boolean
  /** Token for the default provider (used when a turn doesn't target a specific provider). */
  defaultToken?: string
  /** Protected source for the default route; resolved for every turn. */
  defaultCredentialSourceId?: string
  /**
   * Request-time credential authority. A configured source must resolve here;
   * cached providerConfig.apiKey material is never a fallback because another
   * Runtime may have installed a durable replacement fence.
   */
  resolveCredentialSource?: (sourceId: string) => Promise<{ apiKey: string } | null>
  /** Resolves a turn's image attachments so they can be forwarded to the model. */
  attachmentStore?: AttachmentStore
  /** Skill engine — injects the available-skills catalog + activated skills per turn. */
  skillRuntime?: SkillRuntime
  /** Native Kun AGENTS.md instruction engine — injects global/workspace instructions per turn. */
  instructionRuntime?: InstructionRuntime
  /** Long-term memory store — injects relevant memories per turn. */
  memoryStore?: MemoryStore
  /** Interactive-input gate rendered by whichever supported client initiated the turn. */
  userInputGate?: UserInputGate
  /** Approval gate shared with native tool execution. Missing means deny closed. */
  approvalGate?: ApprovalGate
  /** Clock for stamping item timestamps (falls back to Date when absent). */
  nowIso?: () => string
  /** Cap for the replayed history transcript (bytes); defaults to the assembler's. */
  historyTranscriptMaxBytes?: number
  /** Native runtime safety limits, also applied to delegated Agent SDK turns. */
  turnLimits?: TurnLimitsConfig
  /**
   * Static capability envelope applied to every tool discovery and execution
   * context owned by this runtime (used by delegated child turns).
   */
  toolContextBoundary?: Pick<
    ToolHostContext,
    | 'allowedProviderIds'
    | 'allowedToolNames'
    | 'allowedSkillIds'
    | 'allowedReadPaths'
    | 'allowedWritePaths'
    | 'allowedArtifactIds'
    | 'blockedProviderIds'
    | 'blockedToolNames'
    | 'blockedSkillIds'
  >
  /** Child runtimes disable SDK-native tools so all execution crosses Kun's child host. */
  allowSdkBuiltins?: boolean
  /** Optional SDK stream-budget overrides; omitted in normal production wiring. */
  sdkStreamLimits?: Partial<SdkStreamResourceLimits>
  pathToClaudeCodeExecutable?: string
  /** Shared durable provider-session coordinator. */
  sessionCoordinator?: DelegatedSessionCoordinator
  contextProfile?: (model: string) => {
    contextWindowTokens: number
    softThresholdTokens: number
    hardThresholdTokens: number
  }
}

/** Lazily load the real SDK without a static import (so kun typechecks without it). */
let sdkPromise: Promise<SdkApi> | undefined
function loadAgentSdk(): Promise<SdkApi> {
  if (!sdkPromise) {
    const specifier = '@anthropic-ai/claude-agent-sdk'
    sdkPromise = import(specifier as string).then((mod) => mod as unknown as SdkApi)
  }
  return sdkPromise
}

/**
 * Resolve the plan-tool context for a turn. When the turn carries a (non-stale)
 * GUI plan — the SDD "下一步"/Plan-mode flow — we must expose it so the kun
 * `create_plan` tool is BOTH advertised to the model and executable: its
 * `shouldAdvertise` and executor are gated on `guiPlan`/`threadMode === 'plan'`
 * (create-plan-tool.ts). Without this the model is told to call create_plan but
 * the tool was never bridged, so it writes the plan as prose and the GUI reports
 * "no matching create_plan result". Mirrors the native loop's candidate/stale
 * derivation (agent-loop.ts).
 */
export function resolveTurnPlanContext(
  thread: ThreadRecord,
  turnId: string
): { planMode: boolean; guiPlan?: GuiPlanContext } {
  const turn = thread.turns.find((entry) => entry.id === turnId)
  const candidate = turn?.guiPlan ? ({ ...turn.guiPlan, turnId } as GuiPlanContext) : undefined
  const guiPlan = candidate && !isStalePlanContext(candidate, thread.workspace) ? candidate : undefined
  const planMode = (turn?.mode ?? thread.mode) === 'plan' || Boolean(guiPlan)
  return { planMode, ...(guiPlan ? { guiPlan } : {}) }
}

/**
 * Await a user-input gate resolution, cancelling the pending request if the turn
 * aborts first. Mirrors the native loop's waitForUserInput abort handling.
 */
export function waitForGate(
  gate: UserInputGate,
  request: UserInputRequest,
  signal: AbortSignal,
  armedPending?: Promise<UserInputResolution>
): Promise<UserInputResolution> {
  const pending = armedPending ?? gate.request(request)
  if (signal.aborted) {
    gate.resolve(request.id, { status: 'cancelled' })
    return Promise.resolve({ status: 'cancelled' })
  }
  return awaitAbortableGate(
    pending,
    signal,
    () => { gate.resolve(request.id, { status: 'cancelled' }) },
    'cancelled while awaiting user input'
  )
}

function intersectAllowedToolNames(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined
): readonly string[] | undefined {
  if (!first) return second
  if (!second) return first
  const secondSet = new Set(second)
  return first.filter((name) => secondSet.has(name))
}

export function createAgentSdkRuntime(deps: AgentSdkRuntimeFactoryDeps): AgentSdkRuntime {
  const sessionIdsByTurn = new Map<string, string>()
  const sessionPreparationsByTurn = new Map<string, DelegatedSessionPreparation>()
  // A delegated native session must checkpoint the same goal projection that
  // its request used. The goal can be completed, cleared, or replaced while
  // the request is running; using its post-turn value here would make the
  // checkpoint digest disagree with the provider's actual transcript and
  // force every later turn to rebase.
  const sessionGoalContextKeysByTurn = new Map<string, string | null>()
  // Skill activation is turn-scoped. Keep the exact result used for the SDK
  // tool catalog so bridged execution sees the same skill-gated tools after a
  // Client-neutral structured input pause/resume.
  const activeSkillIdsByTurn = new Map<string, readonly string[]>()
  const skillPromptByTurn = new Map<string, string>()
  const skillTurnKey = (threadId: string, turnId: string): string => `${threadId}\u0000${turnId}`

  const resolveActiveSkillIds = async (
    thread: ThreadRecord,
    turn: ThreadRecord['turns'][number]
  ): Promise<readonly string[]> => {
    const key = skillTurnKey(thread.id, turn.id)
    if (!deps.skillRuntime) return activeSkillIdsByTurn.get(key) ?? []
    const resolution = await deps.skillRuntime.resolveTurn({
      prompt: skillPromptByTurn.get(key) ?? turn.prompt ?? '',
      workspace: thread.workspace,
      threadId: thread.id,
      turnId: turn.id,
      ...(deps.toolContextBoundary?.allowedSkillIds
        ? { allowedSkillIds: deps.toolContextBoundary.allowedSkillIds }
        : {}),
      ...(deps.toolContextBoundary?.blockedSkillIds
        ? { blockedSkillIds: deps.toolContextBoundary.blockedSkillIds }
        : {})
    })
    activeSkillIdsByTurn.set(key, resolution.activeSkillIds)
    return resolution.activeSkillIds
  }

  const nowIso = (): string => (deps.nowIso ? deps.nowIso() : new Date().toISOString())

  /**
   * Bridge kun's `user_input` tool to the active client: persist the request item,
   * publish the events clients render, wait on the gate,
   * then mark it resolved. Returns undefined when no gate is wired (the tool then
   * stays unadvertised — its shouldAdvertise checks for awaitUserInput).
   */
  const makeAwaitUserInput = (
    threadId: string,
    turnId: string,
    signal: AbortSignal
  ): ToolHostContext['awaitUserInput'] => {
    const gate = deps.userInputGate
    if (!gate) return undefined
    return async (input): Promise<UserInputResolution> => {
      const request: UserInputRequest = {
        id: input.id,
        threadId,
        turnId,
        itemId: input.itemId,
        prompt: input.prompt,
        questions: input.questions
      }
      // Arm first so an event subscriber can immediately submit a response.
      const pending = gate.request(request)
      const item = makeUserInputItem({
        id: input.itemId,
        threadId,
        turnId,
        inputId: input.id,
        prompt: input.prompt,
        questions: input.questions
      })
      try {
        await deps.turns.applyItem(threadId, item)
        await deps.events.record({
          kind: 'user_input_requested',
          threadId,
          turnId,
          itemId: item.id,
          inputId: input.id,
          status: 'pending',
          prompt: input.prompt,
          questions: input.questions
        })
      } catch (error) {
        gate.resolve(input.id, { status: 'cancelled' })
        void pending.catch(() => undefined)
        throw error
      }
      let resolution: UserInputResolution
      try {
        resolution = await waitForGate(gate, request, signal, pending)
      } catch {
        resolution = { status: 'cancelled' }
      }
      await deps.turns.updateItem(threadId, item.id, {
        status: resolution.status,
        finishedAt: nowIso(),
        ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
      } as Partial<TurnItem>)
      const alreadyRecorded = (await deps.sessionStore.loadEventsSince(threadId, 0)).some(
        (event) => event.kind === 'user_input_resolved' && event.inputId === input.id
      )
      if (!alreadyRecorded) {
        await deps.events.record({
          kind: 'user_input_resolved',
          threadId,
          turnId,
          itemId: item.id,
          inputId: input.id,
          status: resolution.status,
          prompt: input.prompt,
          questions: input.questions,
          ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
        })
      }
      return resolution
    }
  }

  const makeAwaitApproval = (
    approvalPolicy: ApprovalPolicy,
    sandboxMode: SandboxMode | undefined,
    approvalReviewer: ApprovalReviewer,
    actingModelRoute: ActingTurnModelRoute,
    intent: string,
    signal: AbortSignal
  ): ((approval: ApprovalRequest) => Promise<'allow' | 'deny' | ApprovalResolution>) => async (approval) => {
    if (approvalPolicy === 'auto' && sandboxMode === 'danger-full-access') return 'allow'
    if (approvalReviewer === 'agent') {
      if (!deps.approvalReview) {
        return {
          decision: 'deny',
          reviewer: 'agent',
          reason: 'Automatic approval review is unavailable.',
          reviewStatus: 'failed-closed'
        }
      }
      return deps.approvalReview.review({
        approval,
        route: actingModelRoute,
        intent,
        signal
      })
    }
    const gate = deps.approvalGate
    if (approvalPolicy === 'never' || !gate) return 'deny'
    const pending = gate.request(approval)

    // Arm cancellation before publishing approval_requested. The recorder may
    // block on durable storage or synchronous observers, but a cancelled SDK
    // turn must still stop waiting immediately.
    let resolveRequested!: () => void
    let rejectRequested!: (reason: unknown) => void
    const requested = new Promise<void>((resolve, reject) => {
      resolveRequested = resolve
      rejectRequested = reject
    })

    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      let settled = false
      let expiredResolutionScheduled = false
      const cleanup = (): void => signal.removeEventListener('abort', onAbort)
      const recordExpiredAfterRequest = (): void => {
        if (expiredResolutionScheduled) return
        expiredResolutionScheduled = true
        // Preserve the observable event order and consume every background
        // promise: requested must be durable before its expired resolution.
        void requested.then(async () => {
          await pending
          const current = gate.get(approval.id)
          if (current?.status !== 'expired') return
          await deps.events.record({
            kind: 'approval_resolved',
            threadId: approval.threadId,
            turnId: approval.turnId,
            approvalId: approval.id,
            toolName: approval.toolName,
            status: 'expired',
            approvalReviewer: 'user',
            summary: approval.summary,
            ...(approval.action ? { action: approval.action } : {}),
            ...(current.reason ? { reason: current.reason } : {})
          })
        }).catch(() => undefined)
      }
      const expirePending = (reason: string): void => {
        // InMemoryApprovalGate resolves an expiration as deny. When an HTTP
        // decision is reserved, expiration is deferred until commit/rollback;
        // the status check above prevents a false expired event if commit wins.
        if (gate.expire(approval.id, reason)) recordExpiredAfterRequest()
      }
      const onAbort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        expirePending('turn aborted while awaiting approval')
        void pending.catch(() => undefined)
        resolve('deny')
      }

      signal.addEventListener('abort', onAbort, { once: true })

      try {
        const recording = deps.events.record({
          kind: 'approval_requested',
          threadId: approval.threadId,
          turnId: approval.turnId,
          approvalId: approval.id,
          toolName: approval.toolName,
          status: 'pending',
          approvalPolicy,
          approvalReviewer: 'user',
          sandboxMode: sandboxMode ?? DEFAULT_SANDBOX_MODE,
          summary: approval.summary,
          ...(approval.action ? { action: approval.action } : {})
        })
        // Attach both handlers immediately so a recorder rejection cannot
        // surface as unhandled while abort is winning the race.
        void recording.then(resolveRequested, rejectRequested).catch(rejectRequested)
      } catch (error) {
        rejectRequested(error)
      }

      if (signal.aborted) {
        onAbort()
        return
      }

      requested.then(
        () => {
          if (settled) return
          pending.then(
            (decision) => {
              if (settled) return
              settled = true
              cleanup()
              resolve(decision)
            },
            (error) => {
              if (settled) return
              settled = true
              cleanup()
              reject(error)
            }
          )
        },
        (error) => {
          if (settled) return
          settled = true
          cleanup()
          gate.expire(approval.id, 'failed to publish approval request')
          void pending.catch(() => undefined)
          reject(error)
        }
      )
    })
  }

  const toolContext = (
    threadId: string,
    turnId: string,
    workspace: string,
    opts?: {
      planMode?: boolean
      guiPlan?: GuiPlanContext
      guiDesignCanvas?: boolean
      guiDesignMode?: boolean
      guiDesignArtifact?: GuiDesignArtifactContext
      activeSkillIds?: readonly string[]
      additionalWorkspaces?: readonly string[]
      allowedToolNames?: readonly string[]
      sandboxMode?: SandboxMode
      approvalPolicy?: ApprovalPolicy
      approvalReviewer?: ApprovalReviewer
      actingModelRoute?: ActingTurnModelRoute
      signal?: AbortSignal
      awaitUserInput?: ToolHostContext['awaitUserInput']
      awaitApproval?: ToolHostContext['awaitApproval']
      clientSurface?: ToolHostContext['clientSurface']
      orchestration?: ToolHostContext['orchestration']
    }
  ): ToolHostContext => {
    const allowedToolNames = intersectAllowedToolNames(
      deps.toolContextBoundary?.allowedToolNames,
      opts?.allowedToolNames
    )
    return {
      threadId,
      turnId,
      workspace,
      ...(opts?.additionalWorkspaces?.length ? { additionalWorkspaces: opts.additionalWorkspaces } : {}),
      approvalPolicy: opts?.approvalPolicy ?? deps.defaultApprovalPolicy,
      approvalReviewer:
        opts?.approvalReviewer ?? deps.defaultApprovalReviewer ?? DEFAULT_APPROVAL_REVIEWER,
      sandboxMode: opts?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE,
      ...(opts?.actingModelRoute ? { actingModelRoute: opts.actingModelRoute } : {}),
      abortSignal: opts?.signal ?? new AbortController().signal,
      ...deps.toolContextBoundary,
      // Expose plan state so `create_plan` is advertised (listTools) and executable
      // (executeKunTool) on plan turns — both are gated on it.
      ...(opts?.planMode ? { threadMode: 'plan' as const } : {}),
      ...(opts?.guiPlan ? { guiPlan: opts.guiPlan } : {}),
      ...(opts?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
      ...(opts?.guiDesignMode ? { guiDesignMode: true } : {}),
      ...(opts?.guiDesignArtifact ? { guiDesignArtifact: opts.guiDesignArtifact } : {}),
      ...(opts?.activeSkillIds ? { activeSkillIds: opts.activeSkillIds } : {}),
      ...(opts?.clientSurface ? { clientSurface: opts.clientSurface } : {}),
      ...(opts?.orchestration ? { orchestration: opts.orchestration } : {}),
      ...(allowedToolNames ? { allowedToolNames } : {}),
      // Presence advertises `user_input`; the active client renders the gate.
      ...(opts?.awaitUserInput ? { awaitUserInput: opts.awaitUserInput } : {}),
      // Execution supplies the real client approval callback; listing contexts stay
      // deny-closed because no tool may execute through them.
      awaitApproval: opts?.awaitApproval ?? (async () => 'deny')
    }
  }

  const resolveImages = async (
    threadId: string,
    workspace: string,
    attachmentIds: readonly string[]
  ): Promise<Array<{ mediaType: string; base64: string }>> => {
    if (!deps.attachmentStore || attachmentIds.length === 0) return []
    const images: Array<{ mediaType: string; base64: string }> = []
    for (const id of attachmentIds) {
      try {
        const attachment = await deps.attachmentStore.resolveContent(id, { threadId, workspace })
        if (typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/')) {
          images.push({ mediaType: attachment.mimeType, base64: attachment.data.toString('base64') })
        }
      } catch {
        // skip attachments that can't be resolved/authorized
      }
    }
    return images
  }

  const runtimeDeps: SdkRuntimeDeps = {
    handlesProvider: (providerId) => {
      if (providerId && deps.agentSdkProviderIds.has(providerId)) return true
      if (!deps.defaultIsAgentSdk) return false
      // The runtime default is agent-sdk: claim turns that don't target a
      // specific HTTP provider (absent providerId, or one with no http config).
      return !providerId || !deps.providerConfigs[providerId]
    },

    async loadTurnContext(threadId, turnId, signal): Promise<SdkTurnContext | null> {
      if (signal?.aborted) return null
      const thread = await deps.threadStore.get(threadId)
      if (!thread) return null
      const turn = thread.turns.find((candidate) => candidate.id === turnId)
      if (!turn) return null
      let items = await deps.sessionStore.loadItems(threadId)
      const userItem = [...items]
        .reverse()
        .find((item) => item.turnId === turnId && item.kind === 'user_message')
      const userText =
        userItem && 'text' in userItem ? String((userItem as { text?: unknown }).text ?? '') : ''
      const modelUserText = userItem?.kind === 'user_message'
        ? userMessageTextWithComposerContexts(userItem)
        : userText
      const attachmentIds =
        (userItem as { attachmentIds?: string[] } | undefined)?.attachmentIds ?? []
      const images = await resolveImages(threadId, thread.workspace, attachmentIds)
      if (!userText.trim() && images.length === 0) return null

      const requestedProviderId = turn?.providerId?.trim()
      const requestedRouteProviderId = requestedProviderId || thread.providerId?.trim()
      const explicitRouteProviderId =
        requestedRouteProviderId && requestedRouteProviderId !== 'default'
          ? requestedRouteProviderId
          : undefined
      const actingProviderId =
        explicitRouteProviderId || (deps.defaultIsAgentSdk ? 'default' : undefined)
      const requestedAccountId = turn.accountId?.trim() || (
        !requestedProviderId || requestedProviderId === thread.providerId?.trim()
          ? thread.accountId?.trim()
          : undefined
      )
      const selectedModel = resolveSdkModel(turn?.model || thread.model, deps.defaultModel)
      const actingModelRoute: ActingTurnModelRoute = turn.actingModelRoute ?? {
        model: selectedModel ?? 'claude-default',
        ...(actingProviderId ? { providerId: actingProviderId } : {}),
        ...(requestedAccountId ? { accountId: requestedAccountId } : {})
      }
      if (!turn.actingModelRoute) {
        await deps.turns.updateTurnMetadata(threadId, turnId, { actingModelRoute })
      }
      const providerId = actingModelRoute.providerId
      const accountId = actingModelRoute.accountId
      const providerCfg = explicitRouteProviderId
        ? deps.providerConfigs[explicitRouteProviderId]
        : undefined
      const model = actingModelRoute.model
      const approvalPolicy =
        turn.approvalPolicy ?? thread.approvalPolicy ?? deps.defaultApprovalPolicy
      const sandboxMode =
        turn.sandboxMode ?? thread.sandboxMode ?? deps.defaultSandboxMode
      const approvalReviewer =
        turn.approvalReviewer ??
        thread.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      // An explicit Claude provider owns its credential boundary. Empty means
      // ambient Claude Code login only when it has no managed credential
      // source. Managed sources are re-read for every turn so a fence written
      // by another Runtime fails closed before the SDK can use cached material.
      const credentialSourceId = explicitRouteProviderId
        ? providerCfg?.credentialSourceId
        : deps.defaultCredentialSourceId
      let rawToken = explicitRouteProviderId ? providerCfg?.apiKey : deps.defaultToken
      if (credentialSourceId) {
        const resolved = await deps.resolveCredentialSource?.(credentialSourceId).catch(() => null)
        rawToken = resolved?.apiKey ?? ''
        if (!rawToken.trim()) throw new AgentSdkCredentialUnavailableError()
      }
      const token = normalizeClaudeOAuthToken(rawToken)
      // Resolve skills before listing bridgeable tools. Some managed tools
      // (notably PPT Master) are deliberately advertised only for an active
      // skill, and the SDK must see the same per-turn catalog as the native
      // Kun loop.
      const skillResolution = deps.skillRuntime
        ? await deps.skillRuntime.resolveTurn({
            prompt: userText,
            workspace: thread.workspace,
            threadId,
            turnId,
            ...(deps.toolContextBoundary?.allowedSkillIds
              ? { allowedSkillIds: deps.toolContextBoundary.allowedSkillIds }
              : {}),
            ...(deps.toolContextBoundary?.blockedSkillIds
              ? { blockedSkillIds: deps.toolContextBoundary.blockedSkillIds }
              : {})
          })
        : undefined
      const activeSkillIds = skillResolution?.activeSkillIds ?? []
      const turnKey = skillTurnKey(threadId, turnId)
      activeSkillIdsByTurn.set(turnKey, activeSkillIds)
      skillPromptByTurn.set(turnKey, userText)
      // Plan turns expose create_plan (and narrow kun tools to the plan-allowed
      // set); resolve before listing tools so the bridge sees create_plan.
      // awaitUserInput presence is what advertises `user_input` (the signal here
      // is only for advertisement; the real per-call signal is set on execution).
      const dedicatedSvgTurn = turn.guiDesignArtifact?.kind === 'svg'
      const clientSurface = resolveTurnClientSurface(turn)
      const awaitUserInput = turn.disableUserInput === true
        ? undefined
        : makeAwaitUserInput(threadId, turnId, new AbortController().signal)
      const plan = dedicatedSvgTurn
        ? { planMode: false as const }
        : resolveTurnPlanContext(thread, turnId)
      if (!plan.planMode && thread.goal?.status === 'active') {
        await deps.turns.ensureGoalContext(threadId, turnId, signal)
        // Goal context is persisted by TurnService outside the public thread
        // projection. Reload canonical history before the SDK transcript and
        // delegated-session digest are assembled.
        items = await deps.sessionStore.loadItems(threadId)
      }
      if (signal?.aborted) return null
      const goalForHistory = plan.planMode
        ? undefined
        : (await deps.threadStore.get(threadId))?.goal
      const goalContextKeyForHistory = goalContextKey(goalForHistory)
      items = filterGoalContextsForGoalKey(items, goalContextKeyForHistory)
      const graphPolicy = delegatedGraphTurnPolicy(turn)
      // An Agent SDK query pins its in-process MCP schemas at startup and
      // cannot add tools after `load_skill` returns. Pre-bridge schemas gated
      // by skills visible in this workspace; executeKunTool still re-resolves
      // the real active ids for every call, so schema visibility is not
      // execution authority.
      const availableSkillIds = typeof deps.skillRuntime?.availableSkillIdsForWorkspace === 'function'
        ? await deps.skillRuntime.availableSkillIdsForWorkspace(
            thread.workspace,
            deps.toolContextBoundary?.blockedSkillIds,
            deps.toolContextBoundary?.allowedSkillIds
          )
        : activeSkillIds
      const listingOptions = {
        additionalWorkspaces: thread.additionalWorkspaces,
        ...plan,
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        activeSkillIds: [...new Set([...activeSkillIds, ...availableSkillIds])],
        clientSurface,
        sandboxMode,
        approvalPolicy,
        approvalReviewer,
        actingModelRoute,
        ...(turn.orchestration ? { orchestration: turn.orchestration } : {}),
        ...(awaitUserInput ? { awaitUserInput } : {})
      }
      const discoveryContext = toolContext(threadId, turnId, thread.workspace, {
        ...listingOptions,
        ...(!graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {})
      })
      if (deps.toolHost) {
        // Activate turn-scoped extension contributions before taking the
        // canonical registry snapshot used by the SDK MCP bridge.
        await deps.toolHost.listTools(discoveryContext)
      }
      const graphAllowedToolNames = graphPolicy
        ? delegatedGraphAllowedToolNames(
            deps.registry.listTools(discoveryContext),
            graphPolicy.phase
          )
        : undefined
      const bridgeListingContext = toolContext(threadId, turnId, thread.workspace, {
        ...listingOptions,
        ...(intersectDelegatedToolNames(
          !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
            ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
            : undefined,
          graphAllowedToolNames
        )
          ? {
              allowedToolNames: intersectDelegatedToolNames(
                !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
                  ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
                  : undefined,
                graphAllowedToolNames
              )
            }
          : {})
      })
      const bridgeableTools: BridgeableTool[] = deps.registry.listTools(bridgeListingContext).map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
        providerId: spec.providerId,
        providerKind: spec.providerKind
      }))
      const bridgedTools = selectBridgeableTools(
        bridgeableTools,
        graphPolicy ? { overlap: new Set() } : undefined
      )

      // This is the portable rebase handoff. Compatible consecutive turns use
      // the official SDK resume id and do not send this transcript again.
      const historyTranscript = buildHistoryTranscript(
        items,
        turnId,
        deps.historyTranscriptMaxBytes ?? DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
      )

      // A plan turn suppresses goal/todo continuation and injects the plan-mode
      // instruction telling the model to call create_plan (now advertised above).
      const planMode = plan.planMode

      const instructionResolution = deps.instructionRuntime
        ? await deps.instructionRuntime.resolveTurn({ workspace: thread.workspace })
        : undefined

      let memoryBlocks: string[] = []
      if (deps.memoryStore && userText.trim()) {
        const memories = await deps.memoryStore.retrieve({
          query: userText,
          workspace: thread.workspace
        })
        deps.memoryStore.setLastInjected(memories.map((memory) => memory.id))
        memoryBlocks = memoryInstructions(memories)
      }

      const todoInstruction = planMode ? null : todoContinuationInstruction(thread.todos)
      if (instructionResolution) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          injectedInstructionSources: instructionResolution.sources,
          instructionInjectionBytes: instructionResolution.injectedBytes
        })
      }

      const contextInstructions = [
        buildClientSurfaceInstruction(clientSurface),
        ...(thread.additionalWorkspaces?.length
          ? [`Additional workspace roots explicitly added by the user:\n${thread.additionalWorkspaces.map((path) => `- ${JSON.stringify(path)}`).join('\n')}`]
          : []),
        ...(graphPolicy ? [graphPolicy.instruction] : []),
        ...(planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn?.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...memoryBlocks,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? []),
        ...(bridgedTools.length ? [CLAUDE_KUN_TOOL_INSTRUCTION] : [])
      ]

      let preparation: DelegatedSessionPreparation | undefined
      let claudeConfigDir: string | undefined
      if (deps.sessionCoordinator) {
        preparation = await deps.sessionCoordinator.prepare({
          threadId,
          route: {
            providerKind: 'agent-sdk',
            providerId: providerId || 'default',
            credentialIdentity: delegatedCredentialIdentity({
              providerId: providerId || 'default',
              accountId,
              credentialSourceId: providerCfg?.credentialSourceId,
              credentialSecret: token
            }),
            workspace: thread.workspace,
            model: model ?? 'claude-default',
            capabilityFingerprint: delegatedCapabilityFingerprint({
              systemPrompt: deps.prefix.systemPrompt,
              threadPersona: thread.systemPrompt?.trim() || '',
              approvalPolicy,
              sandboxMode,
              approvalReviewer,
              planMode,
              allowSdkBuiltins:
                graphPolicy || turn?.guiDesignArtifact?.kind === 'svg'
                  ? false
                  : deps.allowSdkBuiltins ?? true,
              capabilities: agentSdkCapabilities(),
              tools: bridgedTools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                providerId: tool.providerId,
                providerKind: tool.providerKind
              }))
            }),
            continuationMode: 'native'
          },
          priorItems: priorItemsForDelegatedTurn(items, turnId)
        })
        if (token) {
          claudeConfigDir = deps.sessionCoordinator.store.providerStateDir('agent-sdk', threadId)
          await mkdir(claudeConfigDir, { recursive: true, mode: 0o700 })
        }
        sessionPreparationsByTurn.set(skillTurnKey(threadId, turnId), preparation)
        sessionGoalContextKeysByTurn.set(skillTurnKey(threadId, turnId), goalContextKeyForHistory)
      }

      return {
        workspace: thread.workspace,
        additionalWorkspaces: thread.additionalWorkspaces,
        userText: modelUserText,
        threadPersona: thread.systemPrompt?.trim() || undefined,
        approvalPolicy,
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        planMode,
        allowSdkBuiltins:
          graphPolicy || turn?.guiDesignArtifact?.kind === 'svg'
            ? false
            : deps.allowSdkBuiltins ?? true,
        ...(graphPolicy
          ? {
              bridgeKunBuiltinOverlaps: true,
              graphPhase: graphPolicy.phase
            }
          : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg' ? { requireSvgCompletion: true } : {}),
        // Claude Code only accepts Anthropic models; coerce a thread's non-Claude
        // model (e.g. an old deepseek thread now routed to the subscription) to
        // the runtime default so the turn doesn't fail "model may not exist".
        model,
        ...(turn?.reasoningEffort ? { reasoningEffort: turn.reasoningEffort } : {}),
        ...(preparation?.nativeSessionId
          ? { resumeSessionId: preparation.nativeSessionId }
          : {}),
        ...(claudeConfigDir ? { claudeConfigDir } : {}),
        ...(preparation ? { sessionPreparation: preparation } : {}),
        ...(deps.contextProfile
          ? { contextProfile: deps.contextProfile(model ?? 'claude-default') }
          : {}),
        oauthToken: token || undefined,
        ...(images.length ? { images } : {}),
        bridgeableTools,
        ...(goalContextTexts(items).length
          ? { redactedRequestValues: goalContextTexts(items) }
          : {}),
        ...(historyTranscript ? { historyTranscript } : {}),
        ...(contextInstructions.length ? { contextInstructions } : {}),
        ...(activeSkillIds.length ? { activeSkillIds: [...activeSkillIds] } : {})
      }
    },

    async executeKunTool(threadId, turnId, toolName, args, signal): Promise<KunToolResult> {
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (!thread || !turn || signal?.aborted) {
        return { output: 'turn is no longer active; tool execution was cancelled', isError: true }
      }
      if (!deps.toolHost) {
        return { output: 'Kun tool host is unavailable; tool execution was denied', isError: true }
      }
      // Re-resolve plan context so create_plan can write to its reserved path.
      const plan = turn.guiDesignArtifact?.kind === 'svg'
        ? { planMode: false as const }
        : resolveTurnPlanContext(thread, turnId)
      const approvalPolicy =
        turn.approvalPolicy ?? thread.approvalPolicy ?? deps.defaultApprovalPolicy
      const sandboxMode =
        turn.sandboxMode ?? thread.sandboxMode ?? deps.defaultSandboxMode
      const approvalReviewer =
        turn.approvalReviewer ??
        thread.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const actingModelRoute = turn.actingModelRoute
      if (!actingModelRoute) {
        return { output: 'Acting model route is unavailable; tool execution was denied', isError: true }
      }
      const toolSignal = signal ?? new AbortController().signal
      const activeSkillIds = await resolveActiveSkillIds(thread, turn)
      const clientSurface = resolveTurnClientSurface(turn)
      const graphPolicy = delegatedGraphTurnPolicy(turn)
      const executionOptions = {
        additionalWorkspaces: thread.additionalWorkspaces,
        ...(plan ?? {}),
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        ...(activeSkillIds ? { activeSkillIds } : {}),
        clientSurface,
        ...(sandboxMode ? { sandboxMode } : {}),
        approvalPolicy,
        approvalReviewer,
        actingModelRoute,
        ...(turn.orchestration ? { orchestration: turn.orchestration } : {}),
        signal: toolSignal,
        awaitApproval: makeAwaitApproval(
          approvalPolicy,
          sandboxMode,
          approvalReviewer,
          actingModelRoute,
          turn.prompt,
          toolSignal
        ),
        ...(turn.disableUserInput === true
          ? {}
          : { awaitUserInput: makeAwaitUserInput(threadId, turnId, toolSignal) })
      }
      const discoveryContext = toolContext(threadId, turnId, thread.workspace, {
        ...executionOptions,
        ...(!graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {})
      })
      const graphAllowedToolNames = graphPolicy
        ? delegatedGraphAllowedToolNames(
            deps.registry.listTools(discoveryContext),
            graphPolicy.phase
          )
        : undefined
      // Real per-call signal so an interactive user_input cancels on turn abort.
      const ctx = toolContext(threadId, turnId, thread.workspace, {
        ...executionOptions,
        ...(intersectDelegatedToolNames(
          !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
            ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
            : undefined,
          graphAllowedToolNames
        )
          ? {
              allowedToolNames: intersectDelegatedToolNames(
                !graphPolicy && turn.guiDesignArtifact?.kind === 'svg'
                  ? SVG_ARTIFACT_ALLOWED_TOOL_NAMES
                  : undefined,
                graphAllowedToolNames
              )
            }
          : {})
      })
      try {
        // The SDK's MCP handler must cross the same LocalToolHost boundary as
        // native turns. Calling CapabilityRegistry.tool.execute directly skips
        // policy/sandbox/approval gates, hooks, read-before-edit validation,
        // and the operation journal.
        const result = await deps.toolHost.execute({
          // A bridge call can be concurrent with another invocation of the
          // same tool in one turn. Keep each call's approval and operation
          // journal identity distinct so one pending approval cannot replace
          // another in the gate.
          callId: deps.ids.next('call_sdk'),
          toolName,
          arguments: args
        }, ctx)
        if (result.item.kind !== 'tool_result') {
          return {
            output: `Kun tool ${toolName} returned an invalid result item`,
            isError: true
          }
        }
        return { output: result.item.output, isError: result.item.isError }
      } catch (err) {
        return { output: err instanceof Error ? err.message : String(err), isError: true }
      }
    },

    async decideToolApproval(threadId, turnId, toolName, input, signal): Promise<ToolApprovalDecision> {
      // Bridged Kun tools perform their own per-tool policy check through the
      // LocalToolHost context above; asking here too would create two prompts.
      if (toolName.startsWith('mcp__kun__')) return { allow: true }
      const thread = await deps.threadStore.get(threadId)
      const turn = thread?.turns.find((candidate) => candidate.id === turnId)
      if (thread && turn && toolName === 'Bash') {
        const activeSkillIds = await resolveActiveSkillIds(thread, turn)
        if (activeSkillIds.includes('ppt-master')) {
          return {
            allow: false,
            message: 'Bash is unavailable while PPT Master is active; use ppt_master_run for managed presentation steps.'
          }
        }
      }
      const approvalPolicy =
        turn?.approvalPolicy ?? thread?.approvalPolicy ?? deps.defaultApprovalPolicy
      if (approvalPolicy === 'never') {
        return { allow: false, message: 'tools are disabled for this turn (policy: never)' }
      }
      // `canUseTool` runs for every SDK-native tool. Preserve the same Kun
      // boundary as LocalToolHost: bounded reads and internal todo state are
      // auto-allowed under on-request/suggest after decideSdkBuiltinSandbox has
      // validated their paths; writes, commands, and network calls still review.
      if (
        (approvalPolicy === 'on-request' || approvalPolicy === 'suggest') &&
        SDK_ON_REQUEST_AUTO_ALLOWED_TOOLS.has(toolName)
      ) {
        return { allow: true }
      }
      const sandboxMode =
        turn?.sandboxMode ?? thread?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE
      const approvalReviewer =
        turn?.approvalReviewer ??
        thread?.approvalReviewer ??
        deps.defaultApprovalReviewer ??
        DEFAULT_APPROVAL_REVIEWER
      const workspaceCommandApproval =
        toolName === 'Bash' && sandboxMode === 'workspace-write'
      if (approvalPolicy === 'auto' && !workspaceCommandApproval) return { allow: true }
      if (!thread || !turn) {
        return { allow: false, message: 'Acting turn is unavailable; approval failed closed.' }
      }
      const action = createApprovalActionEnvelope({
          toolName,
          providerId: turn.providerId ?? thread.providerId,
          toolKind: toolName === 'Bash'
            ? 'command_execution'
            : ['Write', 'Edit', 'MultiEdit'].includes(toolName)
              ? 'file_change'
              : 'tool_call',
          effects: {
            network: toolName === 'WebSearch' || toolName === 'WebFetch',
            externalWrite: ['Write', 'Edit', 'MultiEdit'].includes(toolName),
            processExecution: toolName === 'Bash',
            guiAutomation: false
          },
          arguments: input,
          workspace: thread.workspace,
          cwd: typeof input.cwd === 'string' ? input.cwd : thread.workspace,
          reason: 'Agent SDK native tool crossed the Kun approval boundary.'
      })
      const approval = createApprovalRequest({
        id: deps.ids.next('appr'),
        threadId,
        turnId,
        toolName,
        summary: safeApprovalActionSummary(action),
        action
      })
      const actingModelRoute = turn.actingModelRoute
      if (!actingModelRoute) {
        return { allow: false, message: 'Acting model route is unavailable; approval failed closed.' }
      }
      const decision = await makeAwaitApproval(
        approvalPolicy,
        sandboxMode,
        approvalReviewer,
        actingModelRoute,
        turn.prompt,
        signal ?? new AbortController().signal
      )(approval)
      const resolvedDecision = typeof decision === 'string' ? decision : decision.decision
      return resolvedDecision === 'allow'
        ? { allow: true }
        : {
            allow: false,
            message: typeof decision === 'string'
              ? 'Tool call was denied by the approval policy or user.'
              : decision.reason ?? 'Tool call was denied by the approval reviewer.'
          }
    },

    async recordEvent(draft): Promise<void> {
      await deps.events.record(draft)
    },

    async applyItem(threadId, item): Promise<void> {
      await deps.turns.applyItem(threadId, item)
    },

    async applyAssistantDelta(threadId, item, deltaText, deltaOffset): Promise<void> {
      await deps.turns.applyAssistantDelta(threadId, item, deltaText, deltaOffset)
    },

    async finishTurn(threadId, turnId, status, error, code): Promise<TurnRunOutcome> {
      const key = skillTurnKey(threadId, turnId)
      try {
        let outcome: TurnRunOutcome = status
        if (status === 'completed') {
          const graphCompletion = await parkDelegatedGraphTurnAfterRecovery(
            deps.turns,
            { threadId, turnId }
          )
          if (
            graphCompletion === 'suspended' ||
            graphCompletion === 'suspended_pending_supervision'
          ) {
            outcome = graphCompletion
          } else {
            await deps.turns.finishTurn({
              threadId,
              turnId,
              status,
              ...(error ? { error } : {}),
              ...(code ? { code } : {})
            })
          }
        } else {
          await deps.turns.finishTurn({
            threadId,
            turnId,
            status,
            ...(error ? { error } : {}),
            ...(code ? { code } : {})
          })
        }
        if (
          (
            outcome === 'completed' ||
            outcome === 'suspended' ||
            outcome === 'suspended_pending_supervision'
          ) &&
          deps.sessionCoordinator
        ) {
          const preparation = sessionPreparationsByTurn.get(key)
          if (preparation) {
            try {
              await deps.sessionCoordinator.commit({
                preparation,
                committedItems: filterGoalContextsForGoalKey(
                  await deps.sessionStore.loadItems(threadId),
                  sessionGoalContextKeysByTurn.get(key)
                ),
                lastCommittedTurnId: turnId,
                nativeSessionId: sessionIdsByTurn.get(key)
              })
            } catch {
              // Native continuation is an optimization. A failed checkpoint
              // commit must not turn a successfully persisted Kun turn into a
              // failed answer; the next history digest safely forces a rebase.
            }
          }
        }
        return outcome
      } finally {
        activeSkillIdsByTurn.delete(key)
        skillPromptByTurn.delete(key)
        sessionIdsByTurn.delete(key)
        sessionPreparationsByTurn.delete(key)
        sessionGoalContextKeysByTurn.delete(key)
        if (typeof deps.skillRuntime?.clearTurnActivation === 'function') {
          deps.skillRuntime.clearTurnActivation(threadId, turnId)
        }
      }
    },

    async checkGraphCompletion(threadId, turnId) {
      return delegatedGraphCompletionCheck(
        await deps.turns.suspendGraphLeadTurn({ threadId, turnId })
      )
    },

    async saveSessionId(threadId, turnId, sessionId): Promise<void> {
      sessionIdsByTurn.set(skillTurnKey(threadId, turnId), sessionId)
    },

    async rejectResume(threadId, turnId): Promise<void> {
      const key = skillTurnKey(threadId, turnId)
      const preparation = sessionPreparationsByTurn.get(key)
      if (!preparation) return
      sessionPreparationsByTurn.set(
        key,
        await deps.sessionCoordinator!.rejectResume(preparation)
      )
    },

    loadSdk: loadAgentSdk,
    // The embedded SDK launches a separate agent process. Give it the same
    // scrubbed base environment as native shell tools; buildScopedEnv adds the
    // selected SDK OAuth credential explicitly when it is needed.
    baseEnv: () => shellSpawnEnv(),
    kunSystemPrompt: () => deps.prefix.systemPrompt,
    nextId: (prefix) => deps.ids.next(prefix),
    getTurnLimits: () => deps.turnLimits,
    ...(deps.debugSink ? { debugSink: deps.debugSink } : {}),
    ...(deps.sdkStreamLimits
      ? { getSdkStreamLimits: () => deps.sdkStreamLimits }
      : {}),
    ...(deps.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable }
      : {}),
    ...(deps.sessionCoordinator
      ? { runExclusive: (threadId, operation) =>
          deps.sessionCoordinator!.runExclusive(threadId, operation) }
      : {})
  }

  return new AgentSdkRuntime(runtimeDeps)
}
