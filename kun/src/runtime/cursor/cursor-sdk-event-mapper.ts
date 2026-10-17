import type { SDKMessage, TokenUsage } from '@cursor/sdk'
import { takeSdkToolResultMeta } from '../agent-sdk/sdk-tool-result-meta.js'
import { DEFAULT_MODEL_STREAM_LIMITS } from '../../adapters/model/model-stream-resource-budget.js'
import type { TurnItem } from '../../contracts/items.js'
import {
  SetThreadTodosRequest as SetThreadTodosRequestSchema,
  type SetThreadTodosRequest
} from '../../contracts/threads.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { utf8PrefixWithinBytes } from '../../shared/utf8-text-blocks.js'

export type CursorSdkStreamLimits = {
  maxEvents: number
  maxEventBytes: number
  maxTotalEventBytes: number
  maxOutputBytes: number
  maxToolCalls: number
}

export const DEFAULT_CURSOR_SDK_STREAM_LIMITS: CursorSdkStreamLimits = {
  maxEvents: DEFAULT_MODEL_STREAM_LIMITS.maxFrames,
  maxEventBytes: DEFAULT_MODEL_STREAM_LIMITS.maxFrameBytes,
  maxTotalEventBytes: DEFAULT_MODEL_STREAM_LIMITS.maxTotalBytes,
  maxOutputBytes: DEFAULT_MODEL_STREAM_LIMITS.maxOutputBytes,
  maxToolCalls: DEFAULT_MODEL_STREAM_LIMITS.maxCompletedToolCalls
}

export class CursorSdkResourceLimitError extends Error {
  readonly code = 'cursor_sdk_stream_resource_limit'

  constructor(message: string) {
    super(message)
    this.name = 'CursorSdkResourceLimitError'
  }
}

export interface CursorSdkEventMapperContext {
  threadId: string
  turnId: string
  providerId: string
  model: string
  nextId: (prefix: string) => string
  limits?: Partial<CursorSdkStreamLimits>
}

type ToolState = {
  itemId: string
  name: string
  kind: 'tool_call' | 'command_execution' | 'file_change'
  args: Record<string, unknown>
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.trunc(value as number)
    : fallback
}

function normalizeLimits(input: Partial<CursorSdkStreamLimits> | undefined): CursorSdkStreamLimits {
  return {
    maxEvents: positiveInteger(input?.maxEvents, DEFAULT_CURSOR_SDK_STREAM_LIMITS.maxEvents),
    maxEventBytes: positiveInteger(input?.maxEventBytes, DEFAULT_CURSOR_SDK_STREAM_LIMITS.maxEventBytes),
    maxTotalEventBytes: positiveInteger(
      input?.maxTotalEventBytes,
      DEFAULT_CURSOR_SDK_STREAM_LIMITS.maxTotalEventBytes
    ),
    maxOutputBytes: positiveInteger(input?.maxOutputBytes, DEFAULT_CURSOR_SDK_STREAM_LIMITS.maxOutputBytes),
    maxToolCalls: positiveInteger(input?.maxToolCalls, DEFAULT_CURSOR_SDK_STREAM_LIMITS.maxToolCalls)
  }
}

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value))
  } catch {
    throw new CursorSdkResourceLimitError('Cursor SDK emitted a non-serializable event')
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toolKindFor(name: string): ToolState['kind'] {
  if (/^(shell|bash)$/i.test(name)) return 'command_execution'
  if (/^(write|edit|delete)$/i.test(name)) return 'file_change'
  return 'tool_call'
}

function boundedOutput(value: unknown, maxBytes: number): unknown {
  let serialized: string
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return { truncated: true, preview: '[non-serializable Cursor tool output]' }
  }
  if (Buffer.byteLength(serialized) <= maxBytes) return value
  const prefix = utf8PrefixWithinBytes(serialized, 0, maxBytes)
  return {
    truncated: true,
    preview: serialized.slice(0, prefix.end)
  }
}

/**
 * Extract Cursor's authoritative built-in `updateTodos` result for Kun.
 * Cursor uses `inProgress` while Kun's public thread contract uses
 * `in_progress`. Cursor's `cancelled` state is terminal, so it is represented
 * as completed until Kun exposes a distinct cancelled todo state.
 */
export function cursorTodosRequestFromMessage(
  message: SDKMessage
): SetThreadTodosRequest | undefined {
  if (
    message.type !== 'tool_call'
    || message.status !== 'completed'
    || message.name.replace(/[^a-z0-9]/gi, '').toLowerCase() !== 'updatetodos'
  ) {
    return undefined
  }
  const result = recordOf(message.result)
  if (result.status !== 'success') return undefined
  const rawTodos = recordOf(result.value).todos
  if (!Array.isArray(rawTodos)) return undefined

  let activeSeen = false
  const todos: SetThreadTodosRequest['todos'] = []
  for (const rawTodo of rawTodos) {
    const todo = recordOf(rawTodo)
    if (typeof todo.content !== 'string' || typeof todo.status !== 'string') {
      return undefined
    }
    let status: SetThreadTodosRequest['todos'][number]['status']
    switch (todo.status) {
      case 'pending':
        status = 'pending'
        break
      case 'inProgress':
        status = activeSeen ? 'pending' : 'in_progress'
        activeSeen = true
        break
      case 'completed':
      case 'cancelled':
        status = 'completed'
        break
      default:
        return undefined
    }
    todos.push({ content: todo.content, status })
  }

  const parsed = SetThreadTodosRequestSchema.safeParse({ todos })
  return parsed.success ? parsed.data : undefined
}

export function mapCursorUsage(
  usage: TokenUsage,
  providerId: string,
  model: string
): UsageSnapshot {
  // Cursor's `inputTokens` already includes cache reads (a two-call turn of a
  // ~16k context reports ~33k input with ~32k read), but the SDK's
  // `totalTokens` adds the cache reads again; the total is recomputed here.
  const promptTokens = Math.max(0, Math.trunc(usage.inputTokens))
  const completionTokens = Math.max(0, Math.trunc(usage.outputTokens))
  const cacheHitTokens = Math.max(0, Math.trunc(usage.cacheReadTokens))
  const cacheWriteTokens = Math.max(0, Math.trunc(usage.cacheWriteTokens))
  return {
    promptTokens,
    completionTokens,
    ...(usage.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: Math.max(0, Math.trunc(usage.reasoningTokens)) }),
    totalTokens: promptTokens + completionTokens,
    cachedTokens: cacheHitTokens,
    cacheHitTokens,
    cacheMissTokens: Math.max(0, promptTokens - cacheHitTokens),
    cacheWriteTokens,
    cacheHitRate: promptTokens > 0 ? Math.min(1, cacheHitTokens / promptTokens) : null,
    actualProviderId: providerId,
    actualModelId: model,
    turns: 1
  }
}

/**
 * Cursor may redeliver cumulative assistant/thinking snapshots. Emit only the
 * unseen suffix so GUI append semantics never become Answer×N.
 */
export function cursorUnseenFragment(accumulated: string, incoming: string): string {
  if (!incoming) return ''
  if (accumulated === incoming || accumulated.startsWith(incoming)) return ''
  if (incoming.startsWith(accumulated)) return incoming.slice(accumulated.length)
  return incoming
}

/**
 * Pure, bounded projection of Cursor's public SDK stream onto Kun events.
 * Cursor executes its own built-in tools; the mapper only mirrors lifecycle
 * events and never redispatches them through Kun's tool host.
 */
export class CursorSdkEventMapper {
  private readonly limits: CursorSdkStreamLimits
  private eventCount = 0
  private totalEventBytes = 0
  private outputBytes = 0
  private toolCallCount = 0
  private textItemId?: string
  private reasoningItemId?: string
  private readonly textParts: string[] = []
  private readonly reasoningParts: string[] = []
  private textUtf16Length = 0
  private reasoningUtf16Length = 0
  private readonly tools = new Map<string, ToolState>()
  private sawUsage = false

  constructor(private readonly ctx: CursorSdkEventMapperContext) {
    this.limits = normalizeLimits(ctx.limits)
  }

  get hasUsage(): boolean {
    return this.sawUsage
  }

  get text(): string {
    return this.textParts.join('')
  }

  get runningTextItem(): TurnItem | undefined {
    if (!this.textItemId || this.textParts.length === 0) return undefined
    return makeAssistantTextItem({
      id: this.textItemId,
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      text: this.text,
      status: 'running'
    })
  }

  get runningReasoningItem(): TurnItem | undefined {
    if (!this.reasoningItemId || this.reasoningParts.length === 0) return undefined
    return makeAssistantReasoningItem({
      id: this.reasoningItemId,
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      text: this.reasoningParts.join(''),
      status: 'running'
    })
  }

  map(message: SDKMessage): RuntimeEventDraft[] {
    this.consumeEvent(message)
    switch (message.type) {
      case 'assistant':
        return this.mapAssistant(message)
      case 'thinking':
        return this.mapThinking(message.text)
      case 'tool_call':
        return this.mapToolCall(message)
      case 'usage':
        this.sawUsage = true
        return [this.usageEvent(message.usage)]
      default:
        return []
    }
  }

  finalize(resultText?: string, usage?: TokenUsage): RuntimeEventDraft[] {
    if (resultText && resultText !== this.text) {
      this.appendText(
        resultText.startsWith(this.text) ? resultText.slice(this.text.length) : (!this.text ? resultText : '')
      )
    }
    const events: RuntimeEventDraft[] = []
    if (this.reasoningParts.length > 0) {
      this.reasoningItemId ||= this.ctx.nextId('item_cursor_reasoning')
      events.push({
        kind: 'item_created',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId: this.reasoningItemId,
        item: makeAssistantReasoningItem({
          id: this.reasoningItemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          text: this.reasoningParts.join(''),
          status: 'completed'
        })
      })
    }
    if (this.textParts.length > 0) {
      this.textItemId ||= this.ctx.nextId('item_cursor_text')
      events.push({
        kind: 'item_created',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId: this.textItemId,
        item: makeAssistantTextItem({
          id: this.textItemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          text: this.text,
          status: 'completed'
        })
      })
    }
    if (usage && !this.sawUsage) {
      this.sawUsage = true
      events.push(this.usageEvent(usage))
    }
    return events
  }

  private consumeEvent(message: SDKMessage): void {
    this.eventCount += 1
    if (this.eventCount > this.limits.maxEvents) {
      throw new CursorSdkResourceLimitError('Cursor SDK stream exceeded the event count limit')
    }
    const bytes = byteLength(message)
    if (bytes > this.limits.maxEventBytes) {
      throw new CursorSdkResourceLimitError('Cursor SDK emitted an oversized event')
    }
    this.totalEventBytes += bytes
    if (this.totalEventBytes > this.limits.maxTotalEventBytes) {
      throw new CursorSdkResourceLimitError('Cursor SDK stream exceeded the total byte limit')
    }
  }

  private appendOutput(parts: string[], text: string): void {
    if (!text) return
    this.outputBytes += Buffer.byteLength(text)
    if (this.outputBytes > this.limits.maxOutputBytes) {
      throw new CursorSdkResourceLimitError('Cursor SDK response exceeded the output byte limit')
    }
    parts.push(text)
  }

  private appendText(text: string): number {
    const deltaOffset = this.textUtf16Length
    this.appendOutput(this.textParts, text)
    this.textUtf16Length += text.length
    return deltaOffset
  }

  private appendReasoning(text: string): number {
    const deltaOffset = this.reasoningUtf16Length
    this.appendOutput(this.reasoningParts, text)
    this.reasoningUtf16Length += text.length
    return deltaOffset
  }

  private mapAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): RuntimeEventDraft[] {
    const events: RuntimeEventDraft[] = []
    for (const block of message.message.content) {
      if (block.type !== 'text' || !block.text) continue
      const fragment = cursorUnseenFragment(this.textParts.join(''), block.text)
      if (!fragment) continue
      const deltaOffset = this.appendText(fragment)
      this.textItemId ||= this.ctx.nextId('item_cursor_text')
      events.push({
        kind: 'assistant_text_delta',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId: this.textItemId,
        deltaOffset,
        item: makeAssistantTextItem({
          id: this.textItemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          text: fragment,
          status: 'running'
        })
      })
    }
    return events
  }

  private mapThinking(text: string): RuntimeEventDraft[] {
    if (!text) return []
    const fragment = cursorUnseenFragment(this.reasoningParts.join(''), text)
    if (!fragment) return []
    const deltaOffset = this.appendReasoning(fragment)
    this.reasoningItemId ||= this.ctx.nextId('item_cursor_reasoning')
    return [{
      kind: 'assistant_reasoning_delta',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: this.reasoningItemId,
      deltaOffset,
      item: makeAssistantReasoningItem({
        id: this.reasoningItemId,
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        text: fragment,
        status: 'running'
      })
    }]
  }

  private mapToolCall(
    message: Extract<SDKMessage, { type: 'tool_call' }>
  ): RuntimeEventDraft[] {
    const existing = this.tools.get(message.call_id)
    if (message.status === 'running') {
      if (existing) return []
      this.toolCallCount += 1
      if (this.toolCallCount > this.limits.maxToolCalls) {
        throw new CursorSdkResourceLimitError('Cursor SDK stream exceeded the tool-call limit')
      }
      const state: ToolState = {
        itemId: `item_cursor_tool_${this.ctx.turnId}_${message.call_id}`,
        name: message.name,
        kind: toolKindFor(message.name),
        args: recordOf(message.args)
      }
      this.tools.set(message.call_id, state)
      return [{
        kind: 'tool_call_started',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId: state.itemId,
        item: makeToolCallItem({
          id: state.itemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          callId: message.call_id,
          toolName: state.name,
          toolKind: state.kind,
          arguments: state.args,
          status: 'running'
        })
      }]
    }

    const state = existing ?? {
      itemId: `item_cursor_tool_${this.ctx.turnId}_${message.call_id}`,
      name: message.name,
      kind: toolKindFor(message.name),
      args: recordOf(message.args)
    }
    this.tools.delete(message.call_id)
    const events: RuntimeEventDraft[] = []
    if (!existing) {
      this.toolCallCount += 1
      if (this.toolCallCount > this.limits.maxToolCalls) {
        throw new CursorSdkResourceLimitError('Cursor SDK stream exceeded the tool-call limit')
      }
      events.push({
        kind: 'tool_call_started',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        itemId: state.itemId,
        item: makeToolCallItem({
          id: state.itemId,
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          callId: message.call_id,
          toolName: state.name,
          toolKind: state.kind,
          arguments: state.args,
          status: 'running'
        })
      })
    }
    const resultId = `item_cursor_result_${this.ctx.turnId}_${message.call_id}`
    const resultMeta = takeSdkToolResultMeta(this.ctx.threadId, message.call_id)
    events.push({
      kind: 'tool_call_finished',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      itemId: resultId,
      item: makeToolResultItem({
        id: resultId,
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        callId: message.call_id,
        toolName: state.name,
        toolKind: state.kind,
        output: boundedOutput(message.result, this.limits.maxEventBytes),
        isError: message.status === 'error',
        status: message.status === 'error' ? 'failed' : 'completed',
        ...(resultMeta ? { meta: resultMeta } : {})
      })
    })
    return events
  }

  private usageEvent(usage: TokenUsage): RuntimeEventDraft {
    return {
      kind: 'usage',
      threadId: this.ctx.threadId,
      turnId: this.ctx.turnId,
      usage: mapCursorUsage(usage, this.ctx.providerId, this.ctx.model)
    }
  }
}
