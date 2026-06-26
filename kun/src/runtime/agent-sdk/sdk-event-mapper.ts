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
import type { UsageSnapshot } from '../../contracts/usage.js'
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
}

export interface SdkTurnFinal {
  status: 'completed' | 'failed'
  /** Final assistant text, when the SDK reports one. */
  text?: string
  /** Failure detail for error subtypes. */
  message?: string
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
export function mapSdkUsage(usage: SdkUsage | undefined, turns: number, costUsd?: number): UsageSnapshot {
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
    ...(typeof costUsd === 'number' && costUsd >= 0 ? { costUsd } : {})
  }
}

export class SdkEventMapper {
  private sessionId?: string
  private textItemId?: string
  private reasoningItemId?: string
  private textAccum = ''
  private reasoningAccum = ''
  /** tool_use id -> the tool_call item id we minted for it. */
  private readonly toolItemIds = new Map<string, string>()
  /** tool_use id -> tool name, so a later tool_result can recover it. */
  private readonly toolNames = new Map<string, string>()
  private toolReadyCount = 0
  private final?: SdkTurnFinal

  constructor(private readonly ctx: SdkEventMapperContext) {}

  /** SDK session id captured from the `system/init` message (for resume). */
  getSessionId(): string | undefined {
    return this.sessionId
  }

  /** Final status/text once the `result` message has been seen. */
  getFinal(): SdkTurnFinal | undefined {
    return this.final
  }

  map(message: SdkMessage): RuntimeEventDraft[] {
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
      this.textAccum += delta.text
      return [this.textDeltaEvent(delta.text)]
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
      this.reasoningAccum += delta.thinking
      return [this.reasoningDeltaEvent(delta.thinking)]
    }
    return []
  }

  private mapAssistant(message: SdkApiMessage): RuntimeEventDraft[] {
    const events: RuntimeEventDraft[] = []
    let text = ''
    let thinking = ''
    for (const block of blocksOf(message)) {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        text += (block as { text: string }).text
      } else if (
        block.type === 'thinking' &&
        typeof (block as { thinking?: unknown }).thinking === 'string'
      ) {
        thinking += (block as { thinking: string }).thinking
      } else if (block.type === 'tool_use') {
        events.push(...this.toolUseEvents(block as SdkToolUseBlock))
      }
    }
    // Finalize text/thinking as item_created with the authoritative full payload.
    // (Native finalizes via applyItem -> item_created, a replace — NOT a delta —
    // so the streamed chunks above are not re-appended.)
    if (thinking) {
      this.reasoningAccum = thinking
      events.unshift(this.reasoningItemCreated())
    }
    if (text) {
      this.textAccum = text
      events.unshift(this.textItemCreated())
    } else if (this.textItemId && this.textAccum) {
      events.unshift(this.textItemCreated())
    }
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
    this.final = {
      status: isError ? 'failed' : 'completed',
      ...(resultText ? { text: resultText } : this.textAccum ? { text: this.textAccum } : {}),
      ...(isError ? { message: resultText ?? subtype } : {})
    }
    const usage = mapSdkUsage(
      message.usage as SdkUsage | undefined,
      Number(message.num_turns ?? 1),
      typeof message.total_cost_usd === 'number' ? (message.total_cost_usd as number) : undefined
    )
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
        text: this.textAccum,
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
        text: this.reasoningAccum,
        status: 'completed'
      })
    }
  }

  private toolUseEvents(block: SdkToolUseBlock): RuntimeEventDraft[] {
    const itemId = `item_tool_${this.ctx.turnId}_${block.id}`
    this.toolItemIds.set(block.id, itemId)
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
      arguments: block.input ?? {},
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
