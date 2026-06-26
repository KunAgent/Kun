/**
 * Binds the decoupled {@link AgentSdkRuntime} to kun's real runtime services.
 * This is the only place that touches the SDK package and kun's concrete stores,
 * keeping the orchestration (and its tests) free of both.
 */
import { AgentSdkRuntime, type SdkRuntimeDeps, type SdkTurnContext } from './agent-sdk-runtime.js'
import type { ToolApprovalDecision } from './sdk-options-builder.js'
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
  /** True when the runtime's own default provider is agent-sdk (Claude sub as main model). */
  defaultIsAgentSdk?: boolean
  /** Token for the default provider (used when a turn doesn't target a specific provider). */
  defaultToken?: string
  /** Resolves a turn's image attachments so they can be forwarded to the model. */
  attachmentStore?: AttachmentStore
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

export function createAgentSdkRuntime(deps: AgentSdkRuntimeFactoryDeps): AgentSdkRuntime {
  // SDK session ids per thread, for multi-turn resume. In-memory is acceptable:
  // a runtime restart simply starts a fresh SDK session (kun owns canonical history).
  const sessionIds = new Map<string, string>()

  const toolContext = (threadId: string, turnId: string, workspace: string): ToolHostContext => ({
    threadId,
    turnId,
    workspace,
    approvalPolicy: deps.defaultApprovalPolicy,
    abortSignal: new AbortController().signal,
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
      const ctx = toolContext(threadId, turnId, thread.workspace)
      const bridgeableTools: BridgeableTool[] = deps.registry.listTools(ctx).map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema
      }))

      return {
        workspace: thread.workspace,
        userText,
        threadPersona: thread.systemPrompt?.trim() || undefined,
        approvalPolicy: deps.defaultApprovalPolicy,
        model: thread.model || undefined,
        resumeSessionId: sessionIds.get(threadId),
        oauthToken: token || undefined,
        ...(images.length ? { images } : {}),
        bridgeableTools
      }
    },

    async executeKunTool(threadId, turnId, toolName, args): Promise<KunToolResult> {
      const thread = await deps.threadStore.get(threadId)
      const ctx = toolContext(threadId, turnId, thread?.workspace ?? process.cwd())
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
