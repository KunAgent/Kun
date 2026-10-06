import { acpToolPresentation, type AcpToolEvidence } from './acp-tool-presentation.js'
import type { DelegatedTerminalPresentation } from '../../contracts/delegated-tool-presentation.js'
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
import { AcpTextSegments } from './acp-text-segments.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadTodoList } from '../../contracts/threads.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
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
  private readonly messages: AcpTextSegments
  private readonly toolCalls = new Map<string, ToolCallState>()
  private toolReadyCount = 0
  private readonly fileContents = new Map<string, string>()
  private readonly terminalSnapshots = new Map<string, DelegatedTerminalPresentation>()
  private readonly facts: AcpObservedFacts = {
    sawAvailableCommands: false,
    sawUsageTelemetry: false,
    sawUsageTokens: false
  }

  constructor(private readonly ctx: AcpEventMapperContext) {
    this.messages = new AcpTextSegments(ctx)
  }

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
    const drafts = this.messages.flush()
    for (const [callId, state] of this.toolCalls) {
      if (state.phase === 'finished') continue
      state.phase = 'finished'
      drafts.push(this.toolFinished(
        callId,
        toKunToolResult({
          call: state.call, evidence: this.evidenceFor(callId),
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
      return this.messages.append(channel, text, (update as { messageId?: string }).messageId)
    }
    if (content.type === 'resource_link' && channel === 'text') {
      const link = content as { uri: string; name: string }
      return this.messages.append(channel, `[${link.name || link.uri}](${link.uri})`)
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
    if (existing?.phase === 'finished') {
      if (!Object.keys(update).some((key) => !['sessionUpdate', 'toolCallId', 'status'].includes(key))) return []
      existing.call = mergeCallWire(existing.call, update)
      return this.refreshEvidence(callId, existing)
    }
    const drafts = existing ? [] : this.messages.flush()
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
            call: update, evidence: this.evidenceFor(callId),
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
            call: state.call, evidence: this.evidenceFor(callId),
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
    if (existing?.phase === 'finished') {
      if (!Object.keys(update).some((key) => !['sessionUpdate', 'toolCallId', 'status'].includes(key))) return []
      existing.call = mergeCallWire(existing.call, update)
      return this.refreshEvidence(callId, existing)
    }
    const drafts = existing ? [] : this.messages.flush()
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
            call: update, evidence: this.evidenceFor(callId),
            itemId,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId
          })
        ),
        this.toolReady(callId)
      )
    } else {
      state.call = mergeCallWire(state.call, update)
      drafts.push(this.itemUpdated(state.itemId, toKunToolCallItem({
        call: state.call, evidence: this.evidenceFor(callId), itemId: state.itemId, threadId: this.ctx.threadId, turnId: this.ctx.turnId
      })))
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
          call: state.call, evidence: this.evidenceFor(callId),
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
          call: state.call, evidence: this.evidenceFor(callId),
          itemId: this.resultItemId(callId),
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          outcome: status
        })
      ))
    }
    return drafts
  }

  recordFileRead(path: string, content: string): RuntimeEventDraft[] {
    const matches = [...this.toolCalls].filter(([, state]) => state.phase !== 'finished' &&
      state.call.kind === 'read' && acpToolPresentation(state.call).filePath === path)
    // ACP filesystem requests carry no toolCallId. Never guess between concurrent reads.
    if (matches.length !== 1) return []
    const [callId, state] = matches[0]
    this.fileContents.set(callId, content.slice(0, 64 * 1024 + 1))
    return this.refreshEvidence(callId, state)
  }

  recordTerminal(snapshot: DelegatedTerminalPresentation): RuntimeEventDraft[] {
    this.terminalSnapshots.set(snapshot.terminalId, snapshot)
    return [...this.toolCalls].flatMap(([callId, state]) =>
      state.call.content?.some((entry) => entry.type === 'terminal' &&
        (entry as { terminalId: string }).terminalId === snapshot.terminalId)
        ? this.refreshEvidence(callId, state) : [])
  }

  private evidenceFor(callId: string): AcpToolEvidence {
    return { fileContent: this.fileContents.get(callId), terminals: [...this.terminalSnapshots.values()] }
  }

  private refreshEvidence(callId: string, state: ToolCallState): RuntimeEventDraft[] {
    const input = { call: state.call, evidence: this.evidenceFor(callId),
      threadId: this.ctx.threadId, turnId: this.ctx.turnId }
    const drafts = [this.itemUpdated(state.itemId, toKunToolCallItem({ ...input, itemId: state.itemId }))]
    if (state.phase === 'finished') {
      const itemId = this.resultItemId(callId)
      drafts.push(this.itemUpdated(itemId, toKunToolResult({ ...input, itemId,
        outcome: state.call.status === 'failed' ? 'failed' : 'completed' })))
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
    // `used`/`size` describe context-window occupancy, not consumption, and
    // `cost` is a running session total: neither is a per-turn usage report.
    // Token accounting comes only from the prompt result (applyPromptResult).
    const size = Math.max(0, Math.trunc(update.size ?? 0))
    const used = Math.max(0, Math.trunc(update.used ?? 0))
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
    // ACP inputTokens includes cache reads (total = input + output), so the
    // miss side is the remainder; never report more hits than input.
    const cachedRead = usage.cachedReadTokens ? Math.min(prompt, Math.trunc(usage.cachedReadTokens)) : 0
    const snapshot: UsageSnapshot = {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      cacheHitRate: cachedRead > 0 && prompt > 0 ? cachedRead / prompt : null,
      turns: 0,
      ...(usage.thoughtTokens
        ? { reasoningTokens: Math.trunc(usage.thoughtTokens) }
        : {}),
      ...(cachedRead > 0
        ? {
            cachedTokens: cachedRead,
            cacheHitTokens: cachedRead,
            cacheMissTokens: Math.max(0, prompt - cachedRead)
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
      source: 'harness-reported',
      ...(this.ctx.harnessId ? { harnessId: this.ctx.harnessId } : {}),
      usage: snapshot
    }]
  }

  // ---- draft constructors ----------------------------------------------------

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
  const supplied = Object.fromEntries(Object.entries(next).filter(([, value]) => value != null))
  return { ...base, ...supplied } as AcpToolCallWire
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
}
