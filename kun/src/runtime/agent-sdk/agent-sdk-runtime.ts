/**
 * The subscription engine. When a thread's provider is the `agent-sdk` kind,
 * the agent loop delegates the whole turn here: we drive the official Claude
 * Agent SDK's `query()` (which bills the user's Claude subscription via the
 * bundled Claude Code binary) while injecting kun's brain — persona, exclusive
 * tools, permissions — and re-projecting the SDK's stream onto kun's events.
 *
 * The orchestration depends only on the injected `SdkRuntimeDeps` seam, so it is
 * fully unit-testable with a fake SDK + fake deps. The concrete binding to kun's
 * real services lives in the runtime factory (a thin adapter).
 */
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ApprovalPolicy } from '../../contracts/policy.js'
import { SdkEventMapper } from './sdk-event-mapper.js'
import {
  assembleSdkOptions,
  buildCanUseTool,
  type ToolApprovalDecision
} from './sdk-options-builder.js'
import {
  bridgedToolModelNames,
  buildBridgedToolSpecs,
  selectBridgeableTools,
  toSdkMcpServer,
  type BridgeableTool,
  type KunToolResult
} from './sdk-tool-bridge.js'
import type { SdkApi } from './sdk-protocol.js'

export type TurnStatus = 'completed' | 'failed' | 'aborted'

export interface SdkTurnContext {
  /** Workspace root the SDK runs in (cwd). */
  workspace: string
  /** The user's prompt for this turn. */
  userText: string
  /** Thread-level persona appended to the system prompt. */
  threadPersona?: string
  approvalPolicy: ApprovalPolicy
  planMode?: boolean
  model?: string
  /** Prior SDK session id for multi-turn continuity. */
  resumeSessionId?: string
  /** Subscription OAuth token; absent => rely on the host's Claude Code login. */
  oauthToken?: string
  /** Image attachments to forward to the model (base64 + media type). */
  images?: Array<{ mediaType: string; base64: string }>
  /** kun tool catalog to consider bridging (overlap/excluded are filtered here). */
  bridgeableTools: BridgeableTool[]
}

/**
 * When the turn has images, the prompt must be a structured user message (text +
 * image content blocks) rather than a plain string. We yield a single message in
 * the SDK's streaming-input form; the generator ending runs exactly one turn.
 */
function userMessageStream(
  text: string,
  images: ReadonlyArray<{ mediaType: string; base64: string }>
): AsyncIterable<unknown> {
  const content: Array<Record<string, unknown>> = []
  if (text.trim()) content.push({ type: 'text', text })
  for (const image of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 }
    })
  }
  const message = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  return {
    [Symbol.asyncIterator]: async function* () {
      yield message
    }
  }
}

export interface SdkRuntimeDeps {
  /** True when this runtime owns the given provider (kind: 'agent-sdk'). */
  handlesProvider(providerId: string | undefined): boolean
  /** Resolve the turn's inputs; null aborts the turn early (e.g. no user text). */
  loadTurnContext(threadId: string, turnId: string): Promise<SdkTurnContext | null>
  /** Execute a kun tool in-process (raw — permission/hooks handled by the SDK seam). */
  executeKunTool(
    threadId: string,
    turnId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<KunToolResult>
  /** kun's per-call permission decision (routes to the GUI approval panel). */
  decideToolApproval(
    threadId: string,
    turnId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<ToolApprovalDecision>
  /** Persist + publish a runtime event (recorder.record). */
  recordEvent(draft: RuntimeEventDraft): Promise<void>
  /** Upsert a turn item into the item store (turns.applyItem). */
  applyItem(threadId: string, item: TurnItem): Promise<void>
  /** Finish the turn lifecycle (turns.finishTurn). */
  finishTurn(threadId: string, turnId: string, status: TurnStatus, error?: string): Promise<void>
  /** Persist the SDK session id on the thread for next-turn resume. */
  saveSessionId(threadId: string, sessionId: string): Promise<void>
  /** Lazy-load the real `@anthropic-ai/claude-agent-sdk`. */
  loadSdk(): Promise<SdkApi>
  /** Base process env to scope for the Claude Code subprocess. */
  baseEnv(): Record<string, string | undefined>
  /** The stable kun system prompt (persona) appended to the claude_code preset. */
  kunSystemPrompt(): string
  /** Monotonic id allocator for assistant items. */
  nextId(prefix: string): string
  /** Optional explicit path to the bundled Claude Code binary (packaging). */
  pathToClaudeCodeExecutable?: string
}

/** Persist an item only at milestones, not on every streaming delta. */
function shouldPersist(item: TurnItem): boolean {
  return item.status === 'completed' || item.status === 'failed' || item.kind === 'tool_call'
}

function itemOf(draft: RuntimeEventDraft): TurnItem | undefined {
  return 'item' in draft ? (draft.item as TurnItem) : undefined
}

export class AgentSdkRuntime {
  constructor(private readonly deps: SdkRuntimeDeps) {}

  handlesProvider(providerId: string | undefined): boolean {
    return this.deps.handlesProvider(providerId)
  }

  async runTurn(threadId: string, turnId: string, signal: AbortSignal): Promise<TurnStatus> {
    const ctx = await this.deps.loadTurnContext(threadId, turnId)
    if (!ctx) {
      await this.deps.finishTurn(threadId, turnId, 'failed', 'no input for subscription turn')
      return 'failed'
    }

    const mapper = new SdkEventMapper({ threadId, turnId, nextId: (p) => this.deps.nextId(p) })
    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    if (signal.aborted) abort.abort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      const sdk = await this.deps.loadSdk()

      // Bridge kun-exclusive tools into an in-process MCP server.
      const bridged = buildBridgedToolSpecs(selectBridgeableTools(ctx.bridgeableTools), (name, args) =>
        this.deps.executeKunTool(threadId, turnId, name, args)
      )
      const mcpServers = bridged.length ? { kun: toSdkMcpServer(sdk, bridged) } : undefined

      const options = assembleSdkOptions({
        cwd: ctx.workspace,
        kunSystemPrompt: this.deps.kunSystemPrompt(),
        threadPersona: ctx.threadPersona,
        approvalPolicy: ctx.approvalPolicy,
        planMode: ctx.planMode,
        bridgedToolModelNames: bridgedToolModelNames(bridged),
        mcpServers,
        canUseTool: buildCanUseTool((name, input) =>
          this.deps.decideToolApproval(threadId, turnId, name, input)
        ),
        baseEnv: this.deps.baseEnv(),
        oauthToken: ctx.oauthToken,
        abortController: abort,
        ...(ctx.model ? { model: ctx.model } : {}),
        ...(ctx.resumeSessionId ? { resume: ctx.resumeSessionId } : {}),
        ...(this.deps.pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable: this.deps.pathToClaudeCodeExecutable }
          : {})
      })

      const prompt =
        ctx.images && ctx.images.length > 0
          ? userMessageStream(ctx.userText, ctx.images)
          : ctx.userText
      const stream = sdk.query({ prompt, options })
      for await (const message of stream) {
        if (signal.aborted) {
          await stream.interrupt?.()
          break
        }
        for (const draft of mapper.map(message)) {
          const item = itemOf(draft)
          if (item && shouldPersist(item)) {
            // applyItem persists the item AND records its own item_created event,
            // so only ALSO record non-item_created signal events (tool_call_ready,
            // tool_call_finished) — never the item_created draft itself, or the
            // item would be published twice.
            await this.deps.applyItem(threadId, item)
            if (draft.kind !== 'item_created') await this.deps.recordEvent(draft)
          } else {
            await this.deps.recordEvent(draft)
          }
        }
      }

      const sessionId = mapper.getSessionId()
      if (sessionId) await this.deps.saveSessionId(threadId, sessionId)

      if (signal.aborted) {
        await this.deps.finishTurn(threadId, turnId, 'aborted')
        return 'aborted'
      }

      const final = mapper.getFinal()
      const status: TurnStatus = final?.status ?? 'completed'
      await this.deps.finishTurn(threadId, turnId, status, final?.message)
      return status
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.deps.recordEvent({ kind: 'error', threadId, turnId, message })
      await this.deps.finishTurn(threadId, turnId, 'failed', message)
      return 'failed'
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}
