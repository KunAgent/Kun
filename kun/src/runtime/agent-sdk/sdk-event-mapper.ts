/**
 * Translates the Claude Agent SDK message stream into kun's native runtime
 * events, so a subscription turn renders in the GUI exactly like a turn driven
 * by kun's own agent loop. This is the load-bearing half of the fusion: the SDK
 * owns the loop, but every assistant token, tool call, and tool result it emits
 * is re-projected onto kun's event contract.
 *
 * The mapper is deliberately **pure and stateful-but-deterministic**: it takes
 * SDK messages in and returns `RuntimeEventDraft[]` out (seq/timestamp are
 * stamped later by the recorder). It performs no IO, so it is fully unit
 * testable with fabricated SDK messages. The runtime that owns it is
 * responsible for (a) recording each returned event and (b) mirroring the
 * `item` carried by item-events into the turn-item store.
 *
 * Streaming model (mirrors kun's native loop exactly, or the GUI double-renders):
 * a kun `assistant_text_delta` event carries an INCREMENTAL CHUNK (the GUI
 * APPENDS each delta's `item.text`), and the authoritative full text is emitted
 * ONCE at the end as an `item_created` event (the GUI replaces/finalizes by id).
 * So: `stream_event` deltas → chunk `*_delta` events; the complete `assistant`
 * message → a single `item_created` with the full text. On the no-partials path
 * (deltas absent) the `item_created` alone carries the whole message.
 */
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { redactBrowserUseActionForPersistence } from '../../contracts/browser-use.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { DEFAULT_MODEL_STREAM_LIMITS } from '../../adapters/model/model-stream-resource-budget.js'
import {
  makeAssistantTextItem,
  makeAssistantReasoningItem,
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import type {
  SdkApiMessage,
  SdkContentBlock,
  SdkMessage,
  SdkToolResultBlock,
  SdkToolUseBlock,
  SdkUsage
} from './sdk-protocol.js'

export interface SdkEventMapperContext {
  threadId: string
  turnId: string
  /** Monotonic id generator, e.g. `(p) => `${p}_${++n}``. Injected for tests. */
  nextId: (prefix: string) => string
  /** Non-sensitive subscription attribution inherited from the selected provider. */
  billingKind?: 'subscription'
  /** Resolved provider model for subscription usage attribution. */
  model?: string
  /** Optional test/runtime overrides; production defaults mirror native model-stream limits. */
  streamLimits?: Partial<SdkStreamResourceLimits>
}

export interface SdkTurnFinal {
  status: 'completed' | 'failed'
  /** Final assistant text, when the SDK reports one. */
  text?: string
  /** Failure detail for error subtypes. */
  message?: string
  /** Stable kun error code when the SDK reports a native-equivalent limit. */
  code?: 'turn_step_limit'
}

export type SdkStreamResourceLimits = {
  maxEvents: number
  maxEventBytes: number
  maxTotalEventBytes: number
  maxOutputBytes: number
  maxToolCallsPerStep: number
  maxPendingToolCalls: number
  maxToolArgumentBytes: number
  maxToolArgumentBytesPerStep: number
}

export const DEFAULT_SDK_STREAM_RESOURCE_LIMITS: SdkStreamResourceLimits = {
  maxEvents: DEFAULT_MODEL_STREAM_LIMITS.maxFrames,
  maxEventBytes: DEFAULT_MODEL_STREAM_LIMITS.maxFrameBytes,
  maxTotalEventBytes: DEFAULT_MODEL_STREAM_LIMITS.maxTotalBytes,
  maxOutputBytes: DEFAULT_MODEL_STREAM_LIMITS.maxOutputBytes,
  maxToolCallsPerStep: DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolCalls,
  maxPendingToolCalls: DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolCalls,
  maxToolArgumentBytes: DEFAULT_MODEL_STREAM_LIMITS.maxPendingToolArgumentBytes,
  maxToolArgumentBytesPerStep: DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolArgumentBytes
}

export type SdkResourceLimitCode = 'stream_resource_limit' | 'tool_call_limit_exceeded'

/** A stable, content-free failure that the runtime can safely project to the GUI. */
export class SdkResourceLimitError extends Error {
  constructor(readonly code: SdkResourceLimitCode, message: string) {
    super(message)
    this.name = 'SdkResourceLimitError'
  }
}

/** Claude Code built-in tool names that imply a richer kun tool kind. */
function toolKindFor(name: string): 'tool_call' | 'command_execution' | 'file_change' {
  const bare = name.replace(/^mcp__[^_]+__/, '')
  if (/^(bash|shell)$/i.test(bare)) return 'command_execution'
  if (/^(edit|write|multiedit|notebookedit)$/i.test(bare)) return 'file_change'
  return 'tool_call'
}

/** Collapse an SDK tool_result content payload into a kun tool output value. */
function normalizeToolResultContent(content: SdkToolResultBlock['content']): unknown {
  if (content == null) return ''
  if (typeof content === 'string') return content
  // Array of blocks: prefer concatenated text, else hand back the raw blocks.
  const textParts = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
  if (textParts.length === content.length && textParts.length > 0) return textParts.join('')
  return content
}

function blocksOf(message: SdkApiMessage): SdkContentBlock[] {
  if (typeof message.content === 'string') {
    return message.content ? [{ type: 'text', text: message.content }] : []
  }
  return message.content
}

/**
 * Map the Agent SDK's per-request usage onto kun's UsageSnapshot. Anthropic's
 * `input_tokens` EXCLUDES cache reads/writes, so the real prompt size is
 * input + cache_read + cache_creation (see provider-cache memory).
 */
export function mapSdkUsage(
  usage: SdkUsage | undefined,
  turns: number,
  costUsd?: number,
  billing?: Pick<SdkEventMapperContext, 'billingKind' | 'model'>
): UsageSnapshot {
  const input = Math.max(0, Math.trunc(usage?.input_tokens ?? 0))
  const output = Math.max(0, Math.trunc(usage?.output_tokens ?? 0))
  const cacheRead = Math.max(0, Math.trunc(usage?.cache_read_input_tokens ?? 0))
  const cacheCreate = Math.max(0, Math.trunc(usage?.cache_creation_input_tokens ?? 0))
  const promptTokens = input + cacheRead + cacheCreate
  const completionTokens = output
  const cacheHitRate = promptTokens > 0 ? cacheRead / promptTokens : null
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedTokens: cacheRead,
    cacheHitTokens: cacheRead,
    cacheMissTokens: input + cacheCreate,
    cacheHitRate,
    turns: Math.max(0, Math.trunc(turns)),
    ...(billing?.model ? { actualModelId: billing.model } : {}),
    ...(billing?.billingKind ? { billingKind: billing.billingKind } : {}),
    ...(typeof costUsd === 'number' && costUsd >= 0 ? { costUsd } : {})
  }
}

export class SdkEventMapper {
  private sessionId?: string
  private textItemId?: string
  private reasoningItemId?: string
  private readonly textAccum = new StreamTextAccumulator()
  private readonly reasoningAccum = new StreamTextAccumulator()
  /** Text emitted in only the current SDK query, used to dedupe its result copy. */
  private readonly queryTextAccum = new StreamTextAccumulator()
  /** Deltas emitted since the previous authoritative assistant message. */
  private readonly currentAssistantTextAccum = new StreamTextAccumulator()
  private readonly currentAssistantReasoningAccum = new StreamTextAccumulator()
  /** tool_use id -> tool name, so a later tool_result can recover it. */
  private readonly toolNames = new Map<string, string>()
  private toolReadyCount = 0
  private final?: SdkTurnFinal
  private readonly budget: SdkStreamResourceBudget

  constructor(private readonly ctx: SdkEventMapperContext) {
    this.budget = new SdkStreamResourceBudget(normalizeSdkStreamLimits(ctx.streamLimits))
  }

  /** SDK session id captured from the `system/init` message (for resume). */
  getSessionId(): string | undefined {
    return this.sessionId
  }

  /** Final status/text once the `result` message has been seen. */
  getFinal(): SdkTurnFinal | undefined {
    return this.final
  }

  /** Diagnostic/test seam proving completed tool calls release retained name state. */
  getPendingToolCallCount(): number {
    return this.toolNames.size
  }

  /** Reset query-local result/delta state while retaining turn-wide output budgets and item ids. */
  beginQuery(): void {
    this.queryTextAccum.clear()
    this.currentAssistantTextAccum.clear()
    this.currentAssistantReasoningAccum.clear()
    this.final = undefined
  }

  map(message: SdkMessage): RuntimeEventDraft[] {
    this.budget.addEvent(message, this.toolNames.size)
    switch (message.type) {
      case 'system':
        if ((message as { subtype?: string }).subtype === 'init') {
          this.sessionId = (message as { session_id?: string }).session_id ?? this.sessionId
        }
        return []
      case 'stream_event':
        return this.mapStreamEvent(message as { event?: unknown })
      case 'assistant':
        return this.mapAssistant((message as { message: SdkApiMessage }).message)
      case 'user':
        return this.mapUser((message as { message: SdkApiMessage }).message)
      case 'result':
        return this.mapResult(message as Record<string, unknown>)
      default:
        return []
    }
  }

  private mapStreamEvent(message: { event?: unknown }): RuntimeEventDraft[] {
    const event = message.event as
      | { type?: string; delta?: { type?: string; text?: string; thinking?: string } }
      | undefined
    if (!event || event.type !== 'content_block_delta' || !event.delta) return []
    const delta = event.delta
    if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
      this.budget.addOutputDelta('text', delta.text, this.toolNames.size)
      this.textAccum.append(delta.text)
      this.queryTextAccum.append(delta.text)
      this.currentAssistantTextAccum.append(delta.text)
      return [this.textDeltaEvent(delta.text)]
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
      this.budget.addOutputDelta('reasoning', delta.thinking, this.toolNames.size)
      this.reasoningAccum.append(delta.thinking)
      this.currentAssistantReasoningAccum.append(delta.thinking)
      return [this.reasoningDeltaEvent(delta.thinking)]
    }
    return []
  }

  private mapAssistant(message: SdkApiMessage): RuntimeEventDraft[] {
    const events: RuntimeEventDraft[] = []
    const blocks = blocksOf(message)
    const textParts: string[] = []
    const thinkingParts: string[] = []
    const toolUses: SdkToolUseBlock[] = []
    for (const block of blocks) {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        textParts.push((block as { text: string }).text)
      } else if (
        block.type === 'thinking' &&
        typeof (block as { thinking?: unknown }).thinking === 'string'
      ) {
        thinkingParts.push((block as { thinking: string }).thinking)
      } else if (block.type === 'tool_use') {
        toolUses.push(block as SdkToolUseBlock)
      }
    }
    const text = textParts.join('')
    const thinking = thinkingParts.join('')
    const streamedText = this.currentAssistantTextAccum.value
    const streamedThinking = this.currentAssistantReasoningAccum.value
    this.budget.completeAssistant(
      { text, thinking, toolUses },
      this.toolNames,
      { text: streamedText, thinking: streamedThinking }
    )
    for (const toolUse of toolUses) events.push(...this.toolUseEvents(toolUse))
    // Finalize text/thinking as item_created with the authoritative full payload.
    // (Native finalizes via applyItem -> item_created, a replace — NOT a delta —
    // so the streamed chunks above are not re-appended.)
    if (thinking) {
      this.reasoningAccum.replace(thinking)
      events.unshift(this.reasoningItemCreated())
    }
    if (text) {
      this.textAccum.replace(text)
      this.queryTextAccum.replace(text)
      events.unshift(this.textItemCreated())
    } else if (this.textItemId && streamedText) {
      events.unshift(this.textItemCreated())
    }
    this.currentAssistantTextAccum.clear()
    this.currentAssistantReasoningAccum.clear()
    return events
  }

  private mapUser(message: SdkApiMessage): RuntimeEventDraft[] {
    const events: RuntimeEventDraft[] = []
    for (const block of blocksOf(message)) {
      if (block.type === 'tool_result') {
        events.push(this.toolResultEvent(block as SdkToolResultBlock))
      }
    }
    return events
  }

  private mapResult(message: Record<string, unknown>): RuntimeEventDraft[] {
    const subtype = String(message.subtype ?? 'success')
    const isError = message.is_error === true || subtype !== 'success'
    const resultText = typeof message.result === 'string' ? message.result : undefined
    if (resultText) {
      this.budget.completeResult(resultText, this.queryTextAccum.value, this.toolNames.size)
    }
    this.final = {
      status: isError ? 'failed' : 'completed',
      ...(resultText ? { text: resultText } : this.textAccum.value ? { text: this.textAccum.value } : {}),
      ...(isError ? { message: resultText ?? subtype } : {}),
      ...(subtype === 'error_max_turns' ? { code: 'turn_step_limit' as const } : {})
    }
    const usage = mapSdkUsage(
      message.usage as SdkUsage | undefined,
      Number(message.num_turns ?? 1),
      typeof message.total_cost_usd === 'number' ? (message.total_cost_usd as number) : undefined,
      { billingKind: this.ctx.billingKind, model: this.ctx.model }
    )
    // A result is terminal for one SDK query. No later tool result may legally
    // refer back across an SVG recovery query boundary.
    this.toolNames.clear()
    return [
      {
        kind: 'usage',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        usage
      }
    ]
  }

  // --- event builders ------------------------------------------------------

  /** Incremental text chunk → a running delta (GUI appends item.text). */
  private textDeltaEvent(chunk: string): RuntimeEventDraft {
    this.textItemId ||= this.ctx.nextId('item_text')
    return {
      kind: 'assistant_text_delta',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: this.textItemId,
      item: makeAssistantTextItem({
        id: this.textItemId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        text: chunk,
        status: 'running'
      })
    }
  }

  /** Authoritative full text → item_created (GUI replaces/finalizes by id). */
  private textItemCreated(): RuntimeEventDraft {
    this.textItemId ||= this.ctx.nextId('item_text')
    return {
      kind: 'item_created',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: this.textItemId,
      item: makeAssistantTextItem({
        id: this.textItemId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        text: this.textAccum.value,
        status: 'completed'
      })
    }
  }

  private reasoningDeltaEvent(chunk: string): RuntimeEventDraft {
    this.reasoningItemId ||= this.ctx.nextId('item_reasoning')
    return {
      kind: 'assistant_reasoning_delta',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: this.reasoningItemId,
      item: makeAssistantReasoningItem({
        id: this.reasoningItemId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        text: chunk,
        status: 'running'
      })
    }
  }

  private reasoningItemCreated(): RuntimeEventDraft {
    this.reasoningItemId ||= this.ctx.nextId('item_reasoning')
    return {
      kind: 'item_created',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: this.reasoningItemId,
      item: makeAssistantReasoningItem({
        id: this.reasoningItemId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        text: this.reasoningAccum.value,
        status: 'completed'
      })
    }
  }

  private toolUseEvents(block: SdkToolUseBlock): RuntimeEventDraft[] {
    const itemId = `item_tool_${this.ctx.turnId}_${block.id}`
    this.toolNames.set(block.id, block.name)
    this.toolReadyCount += 1
    const toolKind = toolKindFor(block.name)
    const callItem = makeToolCallItem({
      id: itemId,
      turnId: this.ctx.turnId,
      threadId: this.ctx.threadId,
      callId: block.id,
      toolName: block.name,
      toolKind,
      arguments: isSdkBrowserUseTool(block.name)
        ? redactBrowserUseActionForPersistence(block.input ?? {}) as Record<string, unknown>
        : block.input ?? {},
      status: 'running'
    })
    return [
      {
        kind: 'item_created',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId,
        item: callItem
      },
      {
        kind: 'tool_call_ready',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId,
        toolName: block.name,
        callId: block.id,
        readyCount: this.toolReadyCount
      }
    ]
  }

  private toolResultEvent(block: SdkToolResultBlock): RuntimeEventDraft {
    const itemId = `item_toolresult_${this.ctx.turnId}_${block.tool_use_id}`
    // Recover the tool name/kind from the matching tool_use we saw earlier.
    const toolName = this.toolNames.get(block.tool_use_id) ?? 'tool'
    this.toolNames.delete(block.tool_use_id)
    return {
      kind: 'tool_call_finished',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId,
      item: makeToolResultItem({
        id: itemId,
        turnId: this.ctx.turnId,
        threadId: this.ctx.threadId,
        callId: block.tool_use_id,
        toolName,
        toolKind: toolKindFor(toolName),
        output: normalizeToolResultContent(block.content),
        isError: block.is_error === true,
        status: block.is_error === true ? 'failed' : 'completed'
      })
    }
  }
}

function isSdkBrowserUseTool(name: string): boolean {
  return name === 'browser_use' || name === 'mcp__kun__browser_use'
}

/** O(1)-append, lazily joined accumulator bounded by the enclosing byte/event budget. */
class StreamTextAccumulator {
  private parts: string[] = []
  private joined: string | undefined

  append(text: string): void {
    if (!text) return
    this.parts.push(text)
    this.joined = undefined
  }

  replace(text: string): void {
    this.parts = text ? [text] : []
    this.joined = text
  }

  clear(): void {
    this.parts = []
    this.joined = ''
  }

  get value(): string {
    if (this.joined === undefined) {
      this.joined = this.parts.join('')
      this.parts = this.joined ? [this.joined] : []
    }
    return this.joined
  }
}

function normalizeSdkStreamLimits(
  overrides: Partial<SdkStreamResourceLimits> | undefined
): SdkStreamResourceLimits {
  const merged = { ...DEFAULT_SDK_STREAM_RESOURCE_LIMITS, ...overrides }
  return {
    maxEvents: positiveInt(merged.maxEvents),
    maxEventBytes: positiveInt(merged.maxEventBytes),
    maxTotalEventBytes: positiveInt(merged.maxTotalEventBytes),
    maxOutputBytes: positiveInt(merged.maxOutputBytes),
    maxToolCallsPerStep: positiveInt(merged.maxToolCallsPerStep),
    maxPendingToolCalls: positiveInt(merged.maxPendingToolCalls),
    maxToolArgumentBytes: positiveInt(merged.maxToolArgumentBytes),
    maxToolArgumentBytesPerStep: positiveInt(merged.maxToolArgumentBytesPerStep)
  }
}

function positiveInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8')
}

function authoritativeAdditionalBytes(authoritative: string, streamed: string): number {
  if (!authoritative || authoritative === streamed) return 0
  if (streamed && authoritative.startsWith(streamed)) {
    return Buffer.byteLength(authoritative.slice(streamed.length), 'utf8')
  }
  // Divergent authoritative content replaces the streamed draft, so charge
  // the full replacement instead of deduplicating by byte length alone.
  return Buffer.byteLength(authoritative, 'utf8')
}

class SdkStreamResourceBudget {
  private eventCount = 0
  private eventBytes = 0
  private outputBytes = 0

  constructor(private readonly limits: SdkStreamResourceLimits) {}

  addEvent(message: SdkMessage, pendingToolCalls: number): void {
    this.eventCount += 1
    if (this.eventCount > this.limits.maxEvents) {
      throw this.exceeded('stream_resource_limit', `${this.limits.maxEvents} SDK events`, pendingToolCalls)
    }
    let bytes: number
    try {
      bytes = serializedBytes(message)
    } catch {
      throw this.exceeded('stream_resource_limit', 'an unmeasurable SDK event', pendingToolCalls)
    }
    this.eventBytes += bytes
    if (bytes > this.limits.maxEventBytes) {
      throw this.exceeded('stream_resource_limit', `${this.limits.maxEventBytes} bytes for one SDK event`, pendingToolCalls)
    }
    if (this.eventBytes > this.limits.maxTotalEventBytes) {
      throw this.exceeded('stream_resource_limit', `${this.limits.maxTotalEventBytes} total SDK event bytes`, pendingToolCalls)
    }
  }

  addOutputDelta(_kind: 'text' | 'reasoning', value: string, pendingToolCalls: number): void {
    const bytes = Buffer.byteLength(value, 'utf8')
    this.addOutputBytes(bytes, pendingToolCalls)
  }

  completeAssistant(
    response: { text: string; thinking: string; toolUses: readonly SdkToolUseBlock[] },
    pendingTools: ReadonlyMap<string, string>,
    streamed: { text: string; thinking: string }
  ): void {
    if (response.toolUses.length > this.limits.maxToolCallsPerStep) {
      throw this.exceeded(
        'tool_call_limit_exceeded',
        `${this.limits.maxToolCallsPerStep} tool calls in one model step`,
        pendingTools.size
      )
    }

    const pendingIds = new Set(pendingTools.keys())
    let argumentBytes = 0
    for (const toolUse of response.toolUses) {
      let bytes: number
      try {
        bytes = serializedBytes(toolUse.input ?? {})
      } catch {
        throw this.exceeded('stream_resource_limit', 'an unmeasurable tool argument', pendingTools.size)
      }
      if (bytes > this.limits.maxToolArgumentBytes) {
        throw this.exceeded(
          'stream_resource_limit',
          `${this.limits.maxToolArgumentBytes} bytes for one SDK tool argument (argumentBytes=${bytes})`,
          pendingTools.size
        )
      }
      argumentBytes += bytes
      pendingIds.add(toolUse.id)
    }
    if (argumentBytes > this.limits.maxToolArgumentBytesPerStep) {
      throw this.exceeded(
        'stream_resource_limit',
        `${this.limits.maxToolArgumentBytesPerStep} SDK tool-argument bytes in one model step`,
        pendingTools.size
      )
    }
    if (pendingIds.size > this.limits.maxPendingToolCalls) {
      throw this.exceeded(
        'stream_resource_limit',
        `${this.limits.maxPendingToolCalls} pending SDK tool calls`,
        pendingIds.size
      )
    }

    this.addOutputBytes(
      authoritativeAdditionalBytes(response.text, streamed.text) +
        authoritativeAdditionalBytes(response.thinking, streamed.thinking),
      pendingTools.size
    )
  }

  completeResult(resultText: string, authoritativeText: string, pendingToolCalls: number): void {
    if (!resultText || resultText === authoritativeText) return
    // The result usually repeats the final assistant item. If the SDK only
    // emitted partial deltas and the result extends them, charge just the
    // suffix; otherwise conservatively charge the standalone result payload.
    const additional = authoritativeText && resultText.startsWith(authoritativeText)
      ? resultText.slice(authoritativeText.length)
      : resultText
    this.addOutputBytes(Buffer.byteLength(additional, 'utf8'), pendingToolCalls)
  }

  private addOutputBytes(bytes: number, pendingToolCalls: number): void {
    this.outputBytes += bytes
    if (this.outputBytes > this.limits.maxOutputBytes) {
      throw this.exceeded(
        'stream_resource_limit',
        `${this.limits.maxOutputBytes} response text and reasoning bytes`,
        pendingToolCalls
      )
    }
  }

  private exceeded(
    code: SdkResourceLimitCode,
    detail: string,
    pendingToolCalls: number
  ): SdkResourceLimitError {
    return new SdkResourceLimitError(
      code,
      `agent SDK stream exceeded ${detail} (events=${this.eventCount}, eventBytes=${this.eventBytes}, outputBytes=${this.outputBytes}, pendingToolCalls=${pendingToolCalls})`
    )
  }
}
