/**
 * ACP `session/update` → Kun runtime event drafts (docs/ade/03 §7).
 * The mapper is pure: it accumulates per-turn text/reasoning and the
 * tool-call state machine, and returns `RuntimeEventDraft[]` for
 * `acp-runtime.ts` to persist — no I/O, no process.
 *
 * Tool calls can arrive out of order (`tool_call_update` before
 * `tool_call`) or duplicate terminal states; state lives in `toolCalls`
 * and `flush()` interrupts anything left open at turn end.
 */
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadTodoList } from '../../contracts/threads.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem
} from '../../domain/item.js'
import type { AcpDebugLog } from './acp-jsonrpc.js'
import {
  acpConfigOptionValues,
  type AcpConfigOption,
  type AcpSessionModes,
  type SessionUpdate
} from './acp-schema.js'
import {
  acpToolName,
  toKunToolCallItem,
  toKunToolResult,
  type AcpToolCallWire
} from './acp-tool-call-mapper.js'

export type AcpEventMapperContext = {
  threadId: string
  turnId: string
  /** Harness id for harness_session_state events. */
  harnessId?: string
  /** Monotonic id generator, e.g. `(p) => `${p}_${++n}``. */
  nextId: (prefix: string) => string
  nowIso?: () => string
  /** Model id for usage/context drafts. */
  model?: string
  debug?: AcpDebugLog
}

type ToolCallPhase = 'seen' | 'started' | 'finished'

type ToolCallState = {
  phase: ToolCallPhase
  itemId: string
  /** Latest wire payload — result content is accumulated from updates. */
  call: AcpToolCallWire
}

/** Facts the runtime folds into capability derivation (03 §10). */
export type AcpObservedFacts = {
  sawAvailableCommands: boolean
  sawUsageTelemetry: boolean
  sawUsageTokens: boolean
  configOptions?: AcpConfigOption[] | null
  modes?: AcpSessionModes | null
  currentModeId?: string
}

export class AcpEventMapper {
  private textAccum = ''
  private reasoningAccum = ''
  private textItemId?: string
  private reasoningItemId?: string
  private readonly toolCalls = new Map<string, ToolCallState>()
  private toolReadyCount = 0
  private readonly facts: AcpObservedFacts = {
    sawAvailableCommands: false,
    sawUsageTelemetry: false,
    sawUsageTokens: false
  }

  constructor(private readonly ctx: AcpEventMapperContext) {}

  get observedFacts(): AcpObservedFacts {
    return this.facts
  }

  apply(update: SessionUpdate | { sessionUpdate: string }): RuntimeEventDraft[] {
    // The passthrough union member (`sessionUpdate: string`) defeats
    // discriminated narrowing, so each case casts to its validated variant.
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        // Kun writes user messages itself; replayed/echoed chunks are dropped.
        return []
      case 'agent_message_chunk':
        return this.mapMessageChunk(
          update as Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }>,
          'text'
        )
      case 'agent_thought_chunk':
        return this.mapMessageChunk(
          update as Extract<SessionUpdate, { sessionUpdate: 'agent_thought_chunk' }>,
          'reasoning'
        )
      case 'tool_call':
        return this.mapToolCall(update as Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>)
      case 'tool_call_update':
        return this.mapToolCallUpdate(
          update as Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }>
        )
      case 'plan':
        return [this.mapPlan(update as Extract<SessionUpdate, { sessionUpdate: 'plan' }>)]
      case 'available_commands_update':
        return this.mapCommands(
          update as Extract<SessionUpdate, { sessionUpdate: 'available_commands_update' }>
        )
      case 'current_mode_update':
        return this.mapCurrentMode(
          update as Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }>
        )
      case 'config_option_update':
        return this.mapConfigOptions(
          update as Extract<SessionUpdate, { sessionUpdate: 'config_option_update' }>
        )
      case 'session_info_update':
        this.debug('session_info_update ignored (Kun owns thread titles)')
        return []
      case 'usage_update':
        return this.mapUsageUpdate(
          update as Extract<SessionUpdate, { sessionUpdate: 'usage_update' }>
        )
      default:
        this.debug(`ignoring unknown sessionUpdate '${update.sessionUpdate}'`)
        return []
    }
  }

  /**
   * End-of-turn finalize: completed full text/reasoning items (replace
   * semantics on the GUI side) and `interrupted` results for tool calls
   * that never reached a terminal status.
   */
  flush(): RuntimeEventDraft[] {
    const drafts: RuntimeEventDraft[] = []
    if (this.textAccum) {
      this.textItemId ||= this.ctx.nextId('item_text')
      drafts.push(this.itemCreated(
        this.textItemId,
        makeAssistantTextItem({
          id: this.textItemId,
          turnId: this.ctx.turnId,
          threadId: this.ctx.threadId,
          text: this.textAccum,
          status: 'completed'
        })
      ))
    }
    if (this.reasoningAccum) {
      this.reasoningItemId ||= this.ctx.nextId('item_reasoning')
      drafts.push(this.itemCreated(
        this.reasoningItemId,
        makeAssistantReasoningItem({
          id: this.reasoningItemId,
          turnId: this.ctx.turnId,
          threadId: this.ctx.threadId,
          text: this.reasoningAccum,
          status: 'completed'
        })
      ))
    }
    for (const [callId, state] of this.toolCalls) {
      if (state.phase === 'finished') continue
      state.phase = 'finished'
      drafts.push(this.toolFinished(
        callId,
        toKunToolResult({
          call: state.call,
          itemId: this.resultItemId(callId),
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          outcome: 'interrupted'
        })
      ))
    }
    return drafts
  }

  // ---- messages ------------------------------------------------------------

  private mapMessageChunk(
    update: Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }> |
      Extract<SessionUpdate, { sessionUpdate: 'agent_thought_chunk' }>,
    channel: 'text' | 'reasoning'
  ): RuntimeEventDraft[] {
    const content = (update as { content?: { type?: string } }).content
    if (!content) return []
    if (content.type === 'text') {
      const text = (content as { text: string }).text
      if (!text) return []
      if (channel === 'text') {
        this.textAccum += text
        this.textItemId ||= this.ctx.nextId('item_text')
        return [this.delta('assistant_text_delta', this.textItemId, text)]
      }
      this.reasoningAccum += text
      this.reasoningItemId ||= this.ctx.nextId('item_reasoning')
      return [this.delta('assistant_reasoning_delta', this.reasoningItemId, text)]
    }
    if (content.type === 'resource_link' && channel === 'text') {
      const link = content as { uri: string; name: string }
      const text = `[${link.name || link.uri}](${link.uri})`
      this.textAccum += text
      this.textItemId ||= this.ctx.nextId('item_text')
      return [this.delta('assistant_text_delta', this.textItemId, text)]
    }
    // Binary/embedded content: attachment persistence is a runtime concern
    // (P1-05); record a note so the update is not silently lost.
    this.debug(`agent_message_chunk content '${content.type}' not yet mapped`)
    return []
  }

  // ---- tool calls ----------------------------------------------------------

  private mapToolCall(update: AcpToolCallWire): RuntimeEventDraft[] {
    const callId = update.toolCallId
    const existing = this.toolCalls.get(callId)
    if (existing?.phase === 'finished') return []
    const drafts: RuntimeEventDraft[] = []
    let state = existing
    if (!state) {
      const itemId = this.ctx.nextId('item_tool')
      state = { phase: 'seen', itemId, call: update }
      this.toolCalls.set(callId, state)
      this.toolReadyCount += 1
      drafts.push(
        this.itemCreated(
          itemId,
          toKunToolCallItem({
            call: update,
            itemId,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId
          })
        ),
        this.toolReady(callId)
      )
    } else {
      state.call = mergeCallWire(state.call, update)
      drafts.push(
        this.itemUpdated(
          state.itemId,
          toKunToolCallItem({
            call: state.call,
            itemId: state.itemId,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId
          })
        )
      )
    }
    drafts.push(...this.applyToolStatus(callId, state, update))
    return drafts
  }

  private mapToolCallUpdate(update: AcpToolCallWire): RuntimeEventDraft[] {
    const callId = update.toolCallId
    const existing = this.toolCalls.get(callId)
    if (existing?.phase === 'finished') return []
    const drafts: RuntimeEventDraft[] = []
    let state = existing
    if (!state) {
      // Out-of-order update: create the placeholder first (03 §7.2).
      const itemId = this.ctx.nextId('item_tool')
      state = { phase: 'seen', itemId, call: update }
      this.toolCalls.set(callId, state)
      this.toolReadyCount += 1
      drafts.push(
        this.itemCreated(
          itemId,
          toKunToolCallItem({
            call: update,
            itemId,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId
          })
        ),
        this.toolReady(callId)
      )
    } else {
      state.call = mergeCallWire(state.call, update)
    }
    drafts.push(...this.applyToolStatus(callId, state, update))
    return drafts
  }

  private applyToolStatus(
    callId: string,
    state: ToolCallState,
    update: AcpToolCallWire
  ): RuntimeEventDraft[] {
    const status = update.status
    const drafts: RuntimeEventDraft[] = []
    if (status === 'in_progress' && state.phase === 'seen') {
      state.phase = 'started'
      drafts.push(this.toolStarted(
        toKunToolCallItem({
          call: state.call,
          itemId: state.itemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId
        })
      ))
    } else if (
      (status === 'completed' || status === 'failed') &&
      state.phase !== 'finished'
    ) {
      // state.call already carries this update's content — the caller merged
      // it before dispatching here; merging again would duplicate content.
      state.phase = 'finished'
      drafts.push(this.toolFinished(
        callId,
        toKunToolResult({
          call: state.call,
          itemId: this.resultItemId(callId),
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          outcome: status
        })
      ))
    }
    return drafts
  }

  // ---- plan / session state / usage -----------------------------------------

  private mapPlan(
    update: Extract<SessionUpdate, { sessionUpdate: 'plan' }>
  ): RuntimeEventDraft {
    const now = this.nowIso()
    const todos: ThreadTodoList = {
      threadId: this.ctx.threadId,
      items: (update.entries ?? []).map((entry, index) => ({
        id: `acp_plan_${index}`,
        content: entry.content.slice(0, 1_000),
        status:
          entry.status === 'in_progress'
            ? 'in_progress'
            : entry.status === 'completed'
              ? 'completed'
              : 'pending',
        createdAt: now,
        updatedAt: now
      })),
      updatedAt: now
    }
    return {
      kind: 'todos_updated',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      todos
    }
  }

  private mapCommands(
    update: Extract<SessionUpdate, { sessionUpdate: 'available_commands_update' }>
  ): RuntimeEventDraft[] {
    this.facts.sawAvailableCommands = true
    return [this.sessionState({
      commands: update.availableCommands.slice(0, 200).map((command) => ({
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
        ...(command.input?.hint ? { inputHint: command.input.hint } : {})
      }))
    })]
  }

  private mapCurrentMode(
    update: Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }>
  ): RuntimeEventDraft[] {
    this.facts.currentModeId = update.currentModeId
    return [this.sessionState({ currentModeId: update.currentModeId })]
  }

  private mapConfigOptions(
    update: Extract<SessionUpdate, { sessionUpdate: 'config_option_update' }>
  ): RuntimeEventDraft[] {
    this.facts.configOptions = update.configOptions as AcpConfigOption[]
    return [this.sessionState({
      configOptions: (update.configOptions as AcpConfigOption[]).slice(0, 32).map((option) => ({
        id: option.id,
        ...(option.name ? { name: option.name } : {}),
        ...(option.category ? { category: option.category } : {}),
        currentValue: option.currentValue,
        ...(option.type === 'select'
          ? { values: acpConfigOptionValues(option) }
          : {})
      }))
    })]
  }

  private mapUsageUpdate(
    update: Extract<SessionUpdate, { sessionUpdate: 'usage_update' }>
  ): RuntimeEventDraft[] {
    const drafts: RuntimeEventDraft[] = []
    const size = Math.max(0, Math.trunc(update.size ?? 0))
    const used = Math.max(0, Math.trunc(update.used ?? 0))
    const cost = update.cost?.amount
    if (size > 0) {
      this.facts.sawUsageTelemetry = true
      drafts.push({
        kind: 'context_snapshot',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        model: this.ctx.model ?? 'acp',
        stepIndex: 0,
        contextWindowTokens: Math.max(1, size),
        softThresholdTokens: Math.max(1, size),
        hardThresholdTokens: Math.max(1, size),
        estimatedInputTokens: used,
        breakdown: { tools: 0, system: 0, skills: 0, messages: used, other: 0 },
        toolCount: this.toolCalls.size,
        activeSkillIds: [],
        contextManagement: 'sdk-managed',
        nativeHistory: 'known'
      })
    }
    if (used > 0 || typeof cost === 'number') {
      this.facts.sawUsageTokens ||= used > 0
      drafts.push({
        kind: 'usage',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        model: this.ctx.model,
        usage: {
          promptTokens: used,
          completionTokens: 0,
          totalTokens: used,
          cacheHitRate: null,
          turns: 0,
          ...(typeof cost === 'number' ? { costUsd: cost } : {})
        }
      })
    }
    return drafts
  }

  /** Prompt-result usage (session/prompt response) → usage event + fact. */
  applyPromptResult(usage: {
    totalTokens?: number
    inputTokens?: number
    outputTokens?: number
    thoughtTokens?: number | null
    cachedReadTokens?: number | null
    cachedWriteTokens?: number | null
  } | null | undefined): RuntimeEventDraft[] {
    if (!usage) return []
    const prompt = Math.max(0, Math.trunc(usage.inputTokens ?? 0))
    const completion = Math.max(0, Math.trunc(usage.outputTokens ?? 0))
    const total = Math.max(
      0,
      Math.trunc(usage.totalTokens ?? prompt + completion)
    )
    if (prompt + completion + total <= 0) return []
    this.facts.sawUsageTokens = true
    const snapshot: UsageSnapshot = {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      cacheHitRate: null,
      turns: 0,
      ...(usage.thoughtTokens
        ? { reasoningTokens: Math.trunc(usage.thoughtTokens) }
        : {}),
      ...(usage.cachedReadTokens
        ? {
            cachedTokens: Math.trunc(usage.cachedReadTokens),
            cacheHitTokens: Math.trunc(usage.cachedReadTokens)
          }
        : {}),
      ...(usage.cachedWriteTokens
        ? { cacheWriteTokens: Math.trunc(usage.cachedWriteTokens) }
        : {})
    }
    return [{
      kind: 'usage',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      model: this.ctx.model,
      usage: snapshot
    }]
  }

  // ---- draft constructors ----------------------------------------------------

  private delta(
    kind: 'assistant_text_delta' | 'assistant_reasoning_delta',
    itemId: string,
    chunk: string
  ): RuntimeEventDraft {
    return {
      kind,
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId,
      deltaOffset:
        kind === 'assistant_text_delta'
          ? this.textAccum.length - chunk.length
          : this.reasoningAccum.length - chunk.length,
      item:
        kind === 'assistant_text_delta'
          ? makeAssistantTextItem({
              id: itemId,
              turnId: this.ctx.turnId,
              threadId: this.ctx.threadId,
              text: chunk,
              status: 'running'
            })
          : makeAssistantReasoningItem({
              id: itemId,
              turnId: this.ctx.turnId,
              threadId: this.ctx.threadId,
              text: chunk,
              status: 'running'
            })
    }
  }

  private itemCreated(itemId: string, item: TurnItem): RuntimeEventDraft {
    return {
      kind: 'item_created',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId,
      item
    }
  }

  private itemUpdated(itemId: string, item: TurnItem): RuntimeEventDraft {
    return {
      kind: 'item_updated',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId,
      item
    }
  }

  private toolReady(callId: string): RuntimeEventDraft {
    const toolName = acpToolName(this.toolCalls.get(callId)?.call.kind ?? undefined)
    return {
      kind: 'tool_call_ready',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      toolName,
      callId,
      readyCount: this.toolReadyCount
    }
  }

  private toolStarted(item: TurnItem): RuntimeEventDraft {
    return {
      kind: 'tool_call_started',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: item.id,
      item
    }
  }

  private toolFinished(callId: string, item: TurnItem): RuntimeEventDraft {
    return {
      kind: 'tool_call_finished',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: item.id,
      item
    }
  }

  private resultItemId(callId: string): string {
    return `item_toolresult_${this.ctx.turnId}_${sanitizeId(callId)}`
  }

  private sessionState(fields: {
    commands?: Array<{ name: string; description?: string; inputHint?: string }>
    configOptions?: Array<{
      id: string
      name?: string
      category?: string
      currentValue?: string | boolean
      values?: string[]
    }>
    currentModeId?: string
  }): RuntimeEventDraft {
    return {
      kind: 'harness_session_state',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      harnessId: this.ctx.harnessId ?? 'kun',
      ...fields
    }
  }

  private nowIso(): string {
    return this.ctx.nowIso?.() ?? new Date().toISOString()
  }

  private debug(summary: string): void {
    this.ctx.debug?.({ direction: 'note', summary })
  }
}

function mergeCallWire(base: AcpToolCallWire, next: AcpToolCallWire): AcpToolCallWire {
  const merged = { ...base, ...next }
  // Content arrays accumulate: an update's content augments the call's.
  const baseContent = 'content' in base ? base.content ?? undefined : undefined
  const nextContent = 'content' in next ? next.content ?? undefined : undefined
  if (baseContent?.length || nextContent?.length) {
    ;(merged as { content?: unknown }).content = [
      ...(baseContent ?? []),
      ...(nextContent ?? [])
    ]
  }
  return merged
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
}
