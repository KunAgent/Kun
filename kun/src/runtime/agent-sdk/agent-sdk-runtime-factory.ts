/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import { AgentSdkRuntime, type SdkRuntimeDeps, type SdkTurnContext } from './agent-sdk-runtime.js'
import { resolveSdkModel, type ToolApprovalDecision } from './sdk-options-builder.js'
import type { BridgeableTool, KunToolResult } from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { ThreadStore } from '../../ports/thread-store.js'
import type { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { ApprovalPolicy } from '../../contracts/policy.js'
import type { ServeProviderConfig } from '../../config/kun-config.js'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import type { SkillRuntime } from '../../skills/skill-runtime.js'
import type { MemoryStore } from '../../memory/memory-store.js'
import {
  PLAN_MODE_INSTRUCTION,
  goalContinuationInstruction,
  todoContinuationInstruction,
  memoryInstructions,
  isStalePlanContext
} from '../../loop/agent-loop.js'
import type { GuiPlanContext } from '../../ports/tool-host.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import {
  buildHistoryTranscript,
  DEFAULT_SDK_HISTORY_TRANSCRIPT_MAX_BYTES
} from './sdk-context-assembler.js'

export interface AgentSdkRuntimeFactoryDeps {
  registry: CapabilityRegistry
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
  /** Long-term memory store — injects relevant memories per turn. */
  memoryStore?: MemoryStore
  /** Cap for the replayed history transcript (bytes); defaults to the assembler's. */
  historyTranscriptMaxBytes?: number
  pathToClaudeCodeExecutable?: string
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

export function createAgentSdkRuntime(deps: AgentSdkRuntimeFactoryDeps): AgentSdkRuntime {
  // Last SDK session id per thread, recorded for diagnostics only. We do NOT
  // resume from it: kun owns the canonical history and replays it as a transcript
  // every turn (see loadTurnContext), which — unlike the SDK's in-memory resume —
  // survives a provider switch mid-thread and a runtime restart.
  const sessionIds = new Map<string, string>()

  const toolContext = (
    threadId: string,
    turnId: string,
    workspace: string,
    plan?: { planMode?: boolean; guiPlan?: GuiPlanContext }
  ): ToolHostContext => ({
    threadId,
    turnId,
    workspace,
    approvalPolicy: deps.defaultApprovalPolicy,
    abortSignal: new AbortController().signal,
    // Expose plan state so `create_plan` is advertised (listTools) and executable
    // (executeKunTool) on plan turns — both are gated on it.
    ...(plan?.planMode ? { threadMode: 'plan' as const } : {}),
    ...(plan?.guiPlan ? { guiPlan: plan.guiPlan } : {}),
    // The SDK gates every call via canUseTool, so the bridged execution path
    // itself does not re-prompt; this stub keeps the context type satisfied.
    awaitApproval: async () => 'allow'
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
      const items = await deps.sessionStore.loadItems(threadId)
      const userItem = [...items]
        .reverse()
        .find((item) => item.turnId === turnId && item.kind === 'user_message')
      const userText =
        userItem && 'text' in userItem ? String((userItem as { text?: unknown }).text ?? '') : ''
      const attachmentIds =
        (userItem as { attachmentIds?: string[] } | undefined)?.attachmentIds ?? []
      const images = await resolveImages(threadId, thread.workspace, attachmentIds)
      if (!userText.trim() && images.length === 0) return null

      const providerCfg = thread.providerId ? deps.providerConfigs[thread.providerId] : undefined
      const token = providerCfg?.apiKey?.trim() || deps.defaultToken?.trim()
      // Plan turns expose create_plan (and narrow kun tools to the plan-allowed
      // set); resolve before listing tools so the bridge sees create_plan.
      const plan = resolveTurnPlanContext(thread, turnId)
      const ctx = toolContext(threadId, turnId, thread.workspace, plan)
      const bridgeableTools: BridgeableTool[] = deps.registry.listTools(ctx).map((spec) => ({
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

      const skillResolution = deps.skillRuntime
        ? await deps.skillRuntime.resolveTurn({ prompt: userText, workspace: thread.workspace })
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

      const contextInstructions = [
        ...(planMode ? [PLAN_MODE_INSTRUCTION] : []),
        ...(goalInstruction ? [goalInstruction] : []),
        ...(todoInstruction ? [todoInstruction] : []),
        ...memoryBlocks,
        ...(skillResolution?.catalogInstruction ? [skillResolution.catalogInstruction] : []),
        ...(skillResolution?.instructions ?? [])
      ]

      return {
        workspace: thread.workspace,
        userText,
        threadPersona: thread.systemPrompt?.trim() || undefined,
        approvalPolicy: deps.defaultApprovalPolicy,
        planMode,
        // Claude Code only accepts Anthropic models; coerce a thread's non-Claude
        // model (e.g. an old deepseek thread now routed to the subscription) to
        // the runtime default so the turn doesn't fail "model may not exist".
        model: resolveSdkModel(thread.model, deps.defaultModel),
        oauthToken: token || undefined,
        ...(images.length ? { images } : {}),
        bridgeableTools,
        ...(historyTranscript ? { historyTranscript } : {}),
        ...(contextInstructions.length ? { contextInstructions } : {})
      }
    },

    async executeKunTool(threadId, turnId, toolName, args): Promise<KunToolResult> {
      const thread = await deps.threadStore.get(threadId)
      // Re-resolve plan context so create_plan can write to its reserved path.
      const plan = thread ? resolveTurnPlanContext(thread, turnId) : undefined
      const ctx = toolContext(threadId, turnId, thread?.workspace ?? process.cwd(), plan)
      try {
        const record = deps.registry.resolveTool(toolName, ctx)
        const result = await record.tool.execute(args, ctx)
        return { output: result.output, isError: result.isError }
      } catch (err) {
        return { output: err instanceof Error ? err.message : String(err), isError: true }
      }
    },

    // MVP permission posture: honor 'never' (block all); otherwise allow. Routing
    // 'always'/'on-request' to the GUI approval panel is a follow-up.
    async decideToolApproval(): Promise<ToolApprovalDecision> {
      if (deps.defaultApprovalPolicy === 'never') {
        return { allow: false, message: 'tools are disabled for this turn (policy: never)' }
      }
      return { allow: true }
    },

    async recordEvent(draft): Promise<void> {
      await deps.events.record(draft)
    },

    async applyItem(threadId, item): Promise<void> {
      await deps.turns.applyItem(threadId, item)
    },

    async finishTurn(threadId, turnId, status, error): Promise<void> {
      await deps.turns.finishTurn({ threadId, turnId, status, ...(error ? { error } : {}) })
    },

    async saveSessionId(threadId, sessionId): Promise<void> {
      sessionIds.set(threadId, sessionId)
    },

    loadSdk: loadAgentSdk,
    baseEnv: () => process.env,
    kunSystemPrompt: () => deps.prefix.systemPrompt,
    nextId: (prefix) => deps.ids.next(prefix),
    ...(deps.pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable: deps.pathToClaudeCodeExecutable }
      : {})
  }

  return new AgentSdkRuntime(runtimeDeps)
}
