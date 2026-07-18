/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import { AgentSdkRuntime, type SdkRuntimeDeps, type SdkTurnContext } from './agent-sdk-runtime.js'
import type { SdkStreamResourceLimits } from './sdk-event-mapper.js'
import { resolveSdkModel, type ToolApprovalDecision } from './sdk-options-builder.js'
import type { BridgeableTool, KunToolResult } from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHost, ToolHostContext } from '../../ports/tool-host.js'
import {
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  goalContinuationInstruction,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
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
import type { TurnItem } from '../../contracts/items.js'
import type { ApprovalGate } from '../../ports/approval-gate.js'
import { createApprovalRequest, type ApprovalRequest } from '../../domain/approval.js'
import { makeUserInputItem } from '../../domain/item.js'
import { awaitAbortableGate } from '../../services/interactive-gate.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'
import { shellSpawnEnv } from '../../adapters/tool/builtin-tool-utils.js'
import type { TurnLimitsConfig } from '../../loop/turn-limits.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'

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
  ids: { next(prefix: string): string }
  prefix: { systemPrompt: string }
  /** serve.providers map; `kind:'agent-sdk'` entries carry the OAuth token in apiKey. */
  providerConfigs: Record<string, ServeProviderConfig>
  /** Provider ids whose kind is 'agent-sdk' (this runtime owns them). */
  agentSdkProviderIds: ReadonlySet<string>
  defaultApprovalPolicy: ApprovalPolicy
  defaultSandboxMode?: SandboxMode
  /** Runtime default model — used as the Claude model when a thread carries a non-Anthropic id. */
  defaultModel?: string
  /** True when the runtime's own default provider is agent-sdk (Claude sub as main model). */
  defaultIsAgentSdk?: boolean
  /** Token for the default provider (used when a turn doesn't target a specific provider). */
  defaultToken?: string
  /** Resolves a turn's image attachments so they can be forwarded to the model. */
  attachmentStore?: AttachmentStore
  /** Skill engine — injects the available-skills catalog + activated skills per turn. */
  skillRuntime?: SkillRuntime
  /** Native Kun AGENTS.md instruction engine — injects global/workspace instructions per turn. */
  instructionRuntime?: InstructionRuntime
  /** Long-term memory store — injects relevant memories per turn. */
  memoryStore?: MemoryStore
  /** Interactive-input gate — lets the bridged `user_input` tool surface kun's GUI panel. */
  userInputGate?: UserInputGate
  /** GUI approval gate shared with native tool execution. Missing means deny closed. */
  approvalGate?: ApprovalGate
  /** Clock for stamping item timestamps (falls back to Date when absent). */
  nowIso?: () => string
  /** Cap for the replayed history transcript (bytes); defaults to the assembler's. */
  historyTranscriptMaxBytes?: number
  /** Native runtime safety limits, also applied to delegated Agent SDK turns. */
  turnLimits?: TurnLimitsConfig
  /** Optional SDK stream-budget overrides; omitted in normal production wiring. */
  sdkStreamLimits?: Partial<SdkStreamResourceLimits>
  pathToClaudeCodeExecutable?: string
}

const MAX_DIAGNOSTIC_SESSION_IDS = 256

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

export function createAgentSdkRuntime(deps: AgentSdkRuntimeFactoryDeps): AgentSdkRuntime {
  // Last SDK session id per thread, recorded for diagnostics only. We do NOT
  // resume from it: kun owns the canonical history and replays it as a transcript
  // every turn (see loadTurnContext), which — unlike the SDK's in-memory resume —
  // survives a provider switch mid-thread and a runtime restart.
  const sessionIds = new Map<string, string>()
  // Skill activation is turn-scoped. Keep the exact result used for the SDK
  // tool catalog so bridged execution sees the same skill-gated tools after a
  // GUI input pause/resume.
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
      turnId: turn.id
    })
    activeSkillIdsByTurn.set(key, resolution.activeSkillIds)
    return resolution.activeSkillIds
  }

  const nowIso = (): string => (deps.nowIso ? deps.nowIso() : new Date().toISOString())

  /**
   * Bridge kun's `user_input` tool to its GUI panel: persist the request item +
   * publish the events the renderer renders the panel from, wait on the gate,
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
    signal: AbortSignal
  ): ((approval: ApprovalRequest) => Promise<'allow' | 'deny'>) => async (approval) => {
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
            summary: approval.summary,
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
          sandboxMode: sandboxMode ?? DEFAULT_SANDBOX_MODE,
          summary: approval.summary
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
      allowedToolNames?: readonly string[]
      sandboxMode?: SandboxMode
      approvalPolicy?: ApprovalPolicy
      signal?: AbortSignal
      awaitUserInput?: ToolHostContext['awaitUserInput']
      awaitApproval?: ToolHostContext['awaitApproval']
    }
  ): ToolHostContext => ({
    threadId,
    turnId,
    workspace,
    approvalPolicy: opts?.approvalPolicy ?? deps.defaultApprovalPolicy,
    sandboxMode: opts?.sandboxMode ?? deps.defaultSandboxMode ?? DEFAULT_SANDBOX_MODE,
    abortSignal: opts?.signal ?? new AbortController().signal,
    // Expose plan state so `create_plan` is advertised (listTools) and executable
    // (executeKunTool) on plan turns — both are gated on it.
    ...(opts?.planMode ? { threadMode: 'plan' as const } : {}),
    ...(opts?.guiPlan ? { guiPlan: opts.guiPlan } : {}),
    ...(opts?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
    ...(opts?.guiDesignMode ? { guiDesignMode: true } : {}),
    ...(opts?.guiDesignArtifact ? { guiDesignArtifact: opts.guiDesignArtifact } : {}),
    ...(opts?.activeSkillIds ? { activeSkillIds: opts.activeSkillIds } : {}),
    ...(opts?.allowedToolNames ? { allowedToolNames: opts.allowedToolNames } : {}),
    // Wire interactive input to kun's GUI panel (advertises `user_input`).
    ...(opts?.awaitUserInput ? { awaitUserInput: opts.awaitUserInput } : {}),
    // Execution supplies the real GUI approval callback; listing contexts stay
    // deny-closed because no tool may execute through them.
    awaitApproval: opts?.awaitApproval ?? (async () => 'deny')
  })

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

    async loadTurnContext(threadId, turnId): Promise<SdkTurnContext | null> {
      const thread = await deps.threadStore.get(threadId)
      if (!thread) return null
      const turn = thread.turns.find((candidate) => candidate.id === turnId)
      if (!turn) return null
      const items = await deps.sessionStore.loadItems(threadId)
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

      const providerId = turn?.providerId?.trim() || thread.providerId?.trim()
      const providerCfg = providerId ? deps.providerConfigs[providerId] : undefined
      const token = providerCfg?.apiKey?.trim() || deps.defaultToken?.trim()
      // Resolve skills before listing bridgeable tools. Some managed tools
      // (notably PPT Master) are deliberately advertised only for an active
      // skill, and the SDK must see the same per-turn catalog as the native
      // Kun loop.
      const skillResolution = deps.skillRuntime
        ? await deps.skillRuntime.resolveTurn({
            prompt: userText,
            workspace: thread.workspace,
            threadId,
            turnId
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
      const plan = dedicatedSvgTurn
        ? { planMode: false as const }
        : resolveTurnPlanContext(thread, turnId)
      const ctx = toolContext(threadId, turnId, thread.workspace, {
        ...plan,
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {}),
        activeSkillIds,
        sandboxMode: thread.sandboxMode ?? deps.defaultSandboxMode,
        awaitUserInput: makeAwaitUserInput(threadId, turnId, new AbortController().signal)
      })
      // An Agent SDK query pins its in-process MCP schemas at startup and
      // cannot add tools after `load_skill` returns. Pre-bridge schemas gated
      // by skills visible in this workspace; executeKunTool still re-resolves
      // the real active ids for every call, so schema visibility is not
      // execution authority.
      const availableSkillIds = typeof deps.skillRuntime?.availableSkillIdsForWorkspace === 'function'
        ? await deps.skillRuntime.availableSkillIdsForWorkspace(thread.workspace)
        : activeSkillIds
      const bridgeListingContext = toolContext(threadId, turnId, thread.workspace, {
        ...plan,
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {}),
        activeSkillIds: [...new Set([...activeSkillIds, ...availableSkillIds])],
        sandboxMode: thread.sandboxMode ?? deps.defaultSandboxMode,
        awaitUserInput: makeAwaitUserInput(threadId, turnId, new AbortController().signal)
      })
      const bridgeableTools: BridgeableTool[] = deps.registry.listTools(bridgeListingContext).map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema
      }))

      // The SDK doesn't see kun's history or per-turn context, so assemble both
      // here (parity with the native loop's `contextInstructions`). kun owns the
      // canonical history, so we replay it as a transcript every turn rather than
      // relying on the SDK's in-memory resume (lost on provider switch / restart).
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
          workspace: thread.workspace,
          limit: 8
        })
        deps.memoryStore.setLastInjected(memories.map((memory) => memory.id))
        memoryBlocks = memoryInstructions(memories)
      }

      const goalInstruction = planMode ? null : goalContinuationInstruction(thread.goal)
      const todoInstruction = planMode ? null : todoContinuationInstruction(thread.todos)
      if (instructionResolution) {
        await deps.turns.updateTurnMetadata(threadId, turnId, {
          injectedInstructionSources: instructionResolution.sources,
          instructionInjectionBytes: instructionResolution.injectedBytes
        })
      }

      const contextInstructions = [
        ...(planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? [SVG_ARTIFACT_MODE_INSTRUCTION]
          : turn?.guiDesignMode
            ? [DESIGN_MODE_INSTRUCTION]
            : []),
        ...(instructionResolution?.instruction ? [instructionResolution.instruction] : []),
        ...(goalInstruction ? [goalInstruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...memoryBlocks,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? [])
      ]

      return {
        workspace: thread.workspace,
        userText: modelUserText,
        threadPersona: thread.systemPrompt?.trim() || undefined,
        approvalPolicy: thread.approvalPolicy ?? deps.defaultApprovalPolicy,
        sandboxMode: thread.sandboxMode,
        planMode,
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? { allowSdkBuiltins: false, requireSvgCompletion: true }
          : {}),
        // Claude Code only accepts Anthropic models; coerce a thread's non-Claude
        // model (e.g. an old deepseek thread now routed to the subscription) to
        // the runtime default so the turn doesn't fail "model may not exist".
        model: resolveSdkModel(turn?.model || thread.model, deps.defaultModel),
        oauthToken: token || undefined,
        ...(images.length ? { images } : {}),
        bridgeableTools,
        ...(historyTranscript ? { historyTranscript } : {}),
        ...(contextInstructions.length ? { contextInstructions } : {})
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
      const approvalPolicy = thread.approvalPolicy ?? deps.defaultApprovalPolicy
      const sandboxMode = thread.sandboxMode ?? deps.defaultSandboxMode
      const toolSignal = signal ?? new AbortController().signal
      const activeSkillIds = await resolveActiveSkillIds(thread, turn)
      // Real per-call signal so an interactive user_input cancels on turn abort.
      const ctx = toolContext(threadId, turnId, thread.workspace, {
        ...(plan ?? {}),
        ...(turn?.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(turn?.guiDesignMode ? { guiDesignMode: true } : {}),
        ...(turn?.guiDesignArtifact ? { guiDesignArtifact: turn.guiDesignArtifact } : {}),
        ...(turn?.guiDesignArtifact?.kind === 'svg'
          ? { allowedToolNames: SVG_ARTIFACT_ALLOWED_TOOL_NAMES }
          : {}),
        ...(activeSkillIds ? { activeSkillIds } : {}),
        ...(sandboxMode ? { sandboxMode } : {}),
        approvalPolicy,
        signal: toolSignal,
        awaitApproval: makeAwaitApproval(approvalPolicy, sandboxMode, toolSignal),
        awaitUserInput: makeAwaitUserInput(threadId, turnId, toolSignal)
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
      const approvalPolicy = thread?.approvalPolicy ?? deps.defaultApprovalPolicy
      if (approvalPolicy === 'never') {
        return { allow: false, message: 'tools are disabled for this turn (policy: never)' }
      }
      if (approvalPolicy === 'auto') return { allow: true }
      const approval = createApprovalRequest({
        id: deps.ids.next('appr'),
        threadId,
        turnId,
        toolName,
        summary: `Run ${toolName}(${JSON.stringify(input).slice(0, 4_000)})`
      })
      const decision = await makeAwaitApproval(
        approvalPolicy,
        thread?.sandboxMode ?? deps.defaultSandboxMode,
        signal ?? new AbortController().signal
      )(approval)
      return decision === 'allow'
        ? { allow: true }
        : { allow: false, message: 'Tool call was denied by the approval policy or user.' }
    },

    async recordEvent(draft): Promise<void> {
      await deps.events.record(draft)
    },

    async applyItem(threadId, item): Promise<void> {
      await deps.turns.applyItem(threadId, item)
    },

    async finishTurn(threadId, turnId, status, error): Promise<void> {
      try {
        await deps.turns.finishTurn({ threadId, turnId, status, ...(error ? { error } : {}) })
      } finally {
        activeSkillIdsByTurn.delete(skillTurnKey(threadId, turnId))
        skillPromptByTurn.delete(skillTurnKey(threadId, turnId))
        if (typeof deps.skillRuntime?.clearTurnActivation === 'function') {
          deps.skillRuntime.clearTurnActivation(threadId, turnId)
        }
      }
    },

    async saveSessionId(threadId, sessionId): Promise<void> {
      sessionIds.delete(threadId)
      sessionIds.set(threadId, sessionId)
      if (sessionIds.size > MAX_DIAGNOSTIC_SESSION_IDS) {
        const oldest = sessionIds.keys().next().value
        if (oldest !== undefined) sessionIds.delete(oldest)
      }
    },

    loadSdk: loadAgentSdk,
    // The embedded SDK launches a separate agent process. Give it the same
    // scrubbed base environment as native shell tools; buildScopedEnv adds the
    // selected SDK OAuth credential explicitly when it is needed.
    baseEnv: () => shellSpawnEnv(),
    kunSystemPrompt: () => deps.prefix.systemPrompt,
    nextId: (prefix) => deps.ids.next(prefix),
    getTurnLimits: () => deps.turnLimits,
    ...(deps.sdkStreamLimits
      ? { getSdkStreamLimits: () => deps.sdkStreamLimits }
      : {}),
    ...(deps.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable }
      : {})
  }

  return new AgentSdkRuntime(runtimeDeps)
}
