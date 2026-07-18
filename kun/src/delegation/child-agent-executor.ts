import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { setSystemPrompt, type ImmutablePrefix } from '../cache/immutable-prefix.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES, type ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { TurnItem } from '../contracts/items.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { AgentLoop } from '../loop/agent-loop.js'
import { normalizeRoleReasoningEffort } from '../loop/reasoning-effort.js'
import type { ContextCompactionConfig, ModelConfig } from '../loop/model-context-profile.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { ModelClient } from '../ports/model-client.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHost } from '../ports/tool-host.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import type { InstructionRuntime } from '../instructions/instruction-runtime.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import type { ChildRunExecutor } from './delegation-runtime.js'

export type ChildAgentExecutorOptions = {
  model: ModelClient
  toolHost: ToolHost
  prefix: ImmutablePrefix
  defaultModel: string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  nowIso?: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  instructionRuntime?: InstructionRuntime
  memoryStore?: MemoryStore
  artifactStore?: ArtifactStore
  /**
   * Persistence wiring. When the main runtime's stores + event recorder are
   * supplied, the child runs as a persisted `relation: 'side'` thread on the
   * shared event bus: its full session (reasoning, tool calls, results) is
   * queryable via `getThreadDetail(childId)` and streams live to UI
   * subscribers. The thread is hidden from the default thread list (the store
   * filters `side`). When omitted (e.g. in unit tests) the child falls back to
   * throwaway in-memory stores, preserving full isolation.
   */
  sessionStore?: SessionStore
  threadStore?: ThreadStore
  events?: RuntimeEventRecorder
}

export function createChildAgentExecutor(options: ChildAgentExecutorOptions): ChildRunExecutor {
  return async (input) => {
    const nowIso = options.nowIso ?? (() => new Date().toISOString())
    // Persist into the main runtime's stores + event bus when supplied, so the
    // child session is queryable and streams live; otherwise stay isolated in
    // throwaway in-memory stores (preserves test behavior). The recorder is
    // shared too — events persist-before-publish to the same bus, and seq
    // allocation is per-thread (childId), so child events never bleed into the
    // parent thread's stream.
    const sessionStore: SessionStore = options.sessionStore ?? new InMemorySessionStore()
    const threadStore: ThreadStore = options.threadStore ?? new InMemoryThreadStore()
    const events =
      options.events ??
      (() => {
        const eventBus = new InMemoryEventBus()
        return new RuntimeEventRecorder({
          eventBus,
          sessionStore,
          allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
          nowIso
        })
      })()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: options.contextCompaction,
      models: options.models
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    // Tool gating, most-specific first: an explicit allow-list wins; else a
    // read-only policy restricts to investigation tools; else (inherit) the
    // child sees the parent agent's FULL tool set — no forced allow-list, so
    // it can edit/run shell exactly like the parent. The capability registry
    // enforces an explicit list twice (dropped from the model's tool schema
    // and rejected at execute), but `inherit` leaves it undefined so nothing
    // is forced. The child is not an escalation: the per-run parent security
    // snapshot below takes precedence over broader runtime defaults.
    const forcedAllowedToolNames = input.allowedTools
      ? [...input.allowedTools]
      : input.toolPolicy === 'readOnly'
        ? [...SUBAGENT_READ_ONLY_TOOL_NAMES]
        : undefined
    // GUI "custom" capability scope: deny-lists layered on top of inherit.
    // Built-in tools block by name; MCP servers block at the provider level
    // (`mcp:<serverId>`, drift-proof — new tools from a blocked server stay
    // hidden); skills block by id. All three only REMOVE access, so they
    // compose with the parent intersection and can never escalate the child.
    const blockedToolNames = input.blockedTools?.length ? [...input.blockedTools] : undefined
    const blockedProviderIds = input.blockedMcpServers?.length
      ? input.blockedMcpServers.map((serverId) => `mcp:${serverId}`)
      : undefined
    const blockedSkillIds = input.blockedSkills?.length ? [...input.blockedSkills] : undefined
    // A custom system prompt augments the base prefix (kun tool/safety
    // conventions stay) on a distinct fingerprint, so same-agent calls still
    // hit the prompt cache; cross-agent reuse is intentionally given up.
    const childPrefix = input.systemPrompt?.trim()
      ? setSystemPrompt(options.prefix, `${options.prefix.systemPrompt}\n\n${input.systemPrompt.trim()}`.trim())
      : options.prefix
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: options.model,
      toolHost: options.toolHost,
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: childPrefix,
      ids,
      nowIso,
      ...(forcedAllowedToolNames ? { forcedAllowedToolNames } : {}),
      ...(blockedToolNames ? { blockedToolNames } : {}),
      ...(blockedProviderIds ? { blockedProviderIds } : {}),
      ...(blockedSkillIds ? { blockedSkillIds } : {}),
      ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
      ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
      ...(options.instructionRuntime ? { instructionRuntime: options.instructionRuntime } : {}),
      ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
      ...(options.artifactStore ? { artifactStore: options.artifactStore } : {}),
      ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      // A delegated child settles only when it completes or an explicit
      // parent/user cancellation reaches its signal. Do not inherit the
      // generic AgentLoop wall-clock deadline.
      disableWallTimeLimit: true,
      ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
      ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {})
    })

    const model = input.model?.trim() || options.defaultModel
    const approvalPolicy = input.approvalPolicy ?? options.approvalPolicy ?? 'auto'
    const sandboxMode = input.sandboxMode ?? options.sandboxMode
    const title = childThreadTitle(input.childId, input.label, input.profile)
    const thread = await threads.create({
      title,
      workspace: input.workspace?.trim() || '~',
      model,
      mode: 'agent',
      approvalPolicy,
      ...(sandboxMode ? { sandboxMode } : {}),
      // Route the child to the profile's provider. ThreadService threads
      // providerId into every ModelRequest, and the executor's model is the
      // MultiProviderModelClient, so this single field is all routing needs.
      ...(input.providerId ? { providerId: input.providerId } : {})
    }, {
      id: input.childId,
      title,
      // Persist as a side branch of the parent: hidden from the default thread
      // list, but loadable on demand so the user can open the subagent's own
      // session from the parent's delegate_task card.
      relation: 'side',
      parentThreadId: input.parentThreadId
    })
    // A profile preamble rides in the prompt body (not the system prompt) so
    // the cached stable prefix stays byte-identical to the main agent's.
    const promptBase = input.promptPreamble?.trim()
      ? `${input.promptPreamble.trim()}\n\n${input.prompt}`
      : input.prompt
    const prompt = input.returnFormat === 'evidence'
      ? `${promptBase}\n\nReturn a concise evidence-based conclusion. Inspect the task with tools so the parent can verify the result.`
      : promptBase
    const started = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt,
        model,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        mode: 'agent',
        reasoningEffort: normalizeRoleReasoningEffort(input.reasoningEffort),
        ...(input.guiDesignCanvas ? { guiDesignCanvas: true } : {}),
        // Children have no GUI surface to answer structured input prompts.
        disableUserInput: true
      }
    })
    const abortChild = (): void => {
      console.warn(`[kun] foreground subagent parent abort received child=${thread.id} turn=${started.turnId} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      void turns.interruptTurn({
        threadId: thread.id,
        turnId: started.turnId
      }).catch(() => undefined)
    }
    if (input.signal.aborted) {
      console.warn(`[kun] foreground subagent started with aborted parent signal child=${thread.id} turn=${started.turnId}`)
      abortChild()
    } else {
      console.warn(`[kun] foreground subagent abort bridge armed child=${thread.id} turn=${started.turnId} parentThread=${input.parentThreadId} parentTurn=${input.parentTurnId}`)
      input.signal.addEventListener('abort', abortChild, { once: true })
    }
    let status: 'completed' | 'failed' | 'aborted'
    try {
      status = await loop.runTurn(thread.id, started.turnId)
    } finally {
      input.signal.removeEventListener('abort', abortChild)
    }
    console.warn(`[kun] foreground subagent turn settled child=${thread.id} turn=${started.turnId} status=${status}`)
    // Only a FATAL error fails the child. Recoverable tool errors — a tool
    // rejected by the child's read-only policy, or a tool that crashed — are
    // recorded as `severity: 'warning'` error events but the loop hands the
    // model an error tool-result it adapts to and the turn still completes.
    // Treating those as fatal wrongly marked the whole subagent "failed" for a
    // single denied `bash` call. Genuine failures are caught by the `status`
    // check below; here we only honor non-warning (fatal) error events.
    const runtimeError = (await sessionStore.loadEventsSince(thread.id, 0))
      .find(
        (event) =>
          event.kind === 'error' &&
          event.turnId === started.turnId &&
          event.severity !== 'warning' &&
          event.severity !== 'info'
      )
    if (runtimeError?.kind === 'error') {
      throw new Error(runtimeError.message)
    }
    const items = await sessionStore.loadItems(thread.id)
    const summary = summarizeChildTurn(items, started.turnId, status)
    const toolInvocations = items.filter(
      (item) => item.turnId === started.turnId && item.kind === 'tool_call'
    ).length
    const evidence = input.returnFormat === 'evidence'
      ? childToolEvidence(items, started.turnId)
      : undefined
    if (status !== 'completed') {
      throw new Error(summary || `child agent ${status}`)
    }
    return {
      summary,
      ...(evidence ? { evidence } : {}),
      usage: usage.forThread(thread.id),
      toolInvocations,
      // The child loop was constructed with the main agent's immutable
      // prefix; only the small delegation prompt is appended fresh.
      prefixReused: true,
      inheritedHistoryItems: 0
    }
  }
}

function childToolEvidence(items: readonly TurnItem[], turnId: string): string[] {
  const results = new Map(items
    .filter((item): item is Extract<TurnItem, { kind: 'tool_result' }> =>
      item.turnId === turnId && item.kind === 'tool_result')
    .map((item) => [item.callId, item]))
  return items
    .filter((item): item is Extract<TurnItem, { kind: 'tool_call' }> =>
      item.turnId === turnId && item.kind === 'tool_call')
    .slice(0, 32)
    .map((item) => {
      const result = results.get(item.callId)
      const target = toolEvidenceTarget(item.arguments)
      return `${item.toolName}${target ? ` ${target}` : ''}: ${result?.isError ? 'failed' : 'completed'}`
    })
}

function toolEvidenceTarget(args: Record<string, unknown>): string {
  for (const key of ['path', 'filePath', 'file_path', 'query', 'command']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300)
  }
  return ''
}

function childThreadTitle(childId: string, label?: string, profile?: string): string {
  const suffix = label?.trim() || profile?.trim() || childId
  return `Child agent: ${suffix}`
}

function summarizeChildTurn(
  items: readonly TurnItem[],
  turnId: string,
  status: 'completed' | 'failed' | 'aborted'
): string {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const assistantText = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (assistantText) return assistantText
  const errors = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'error' }> => item.kind === 'error')
    .map((item) => item.message.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (errors) return errors
  const toolResult = [...turnItems]
    .reverse()
    .find((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
  if (toolResult) return stringifySummary(toolResult.output)
  return status === 'completed'
    ? 'Child agent completed without a text response.'
    : `Child agent ${status}.`
}

function stringifySummary(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
