/**
 * Pi rpc event → Kun timeline draft mapping (P6-09).
 *
 * Pi streams assistant deltas inside `message_update.assistantMessageEvent`
 * (`text_delta` / `thinking_*`, keyed by contentIndex), ships the full message
 * on `message_end` (usage + stopReason), and wraps tool calls in
 * `tool_execution_{start,update,end}`. Turn completion is `agent_settled`
 * (NOT `agent_end`, which fires mid-turn) — the session owns that boundary;
 * this mapper only produces drafts.
 */
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem,
  makeToolResultItem
} from '../../domain/item.js'
import { PI_EVENTS, type PiEvent } from './pi-protocol.js'

export type PiMapperContext = {
  threadId: string
  turnId: string
  model?: string
  nowIso?: () => string
}

type ItemRecord = Record<string, unknown>

export class PiEventMapper {
  private readonly textOffsets = new Map<number, number>()
  private readonly reasoningOffsets = new Map<number, number>()
  private readonly toolNamesByCallId = new Map<string, string>()
  private usageDrafts: RuntimeEventDraft[] = []

  constructor(private readonly ctx: PiMapperContext) {}

  /** pi contentIndex → Kun timeline item id (stable, namespaced). */
  kunTextItemId(contentIndex: number): string {
    return `pi_msg_${contentIndex}`
  }

  kunReasoningItemId(contentIndex: number): string {
    return `pi_think_${contentIndex}`
  }

  /** Returns drafts for one pi event; [] when it carries nothing mappable. */
  mapEvent(event: PiEvent): RuntimeEventDraft[] {
    switch (event.type) {
      case PI_EVENTS.messageUpdate:
        return this.messageUpdate(event)
      case PI_EVENTS.messageEnd:
        return this.messageEnd(event)
      case PI_EVENTS.toolExecutionStart:
        return this.toolStarted(event)
      case PI_EVENTS.toolExecutionEnd:
        return this.toolEnded(event)
      default:
        return []
    }
  }

  // -- assistant message deltas -------------------------------------------------

  private messageUpdate(event: PiEvent): RuntimeEventDraft[] {
    const delta = event.assistantMessageEvent as ItemRecord | undefined
    if (!delta || typeof delta.type !== 'string') return []
    const contentIndex =
      typeof delta.contentIndex === 'number' ? delta.contentIndex : 0
    // `text_end`/`thinking_end` carry the authoritative block content; emit a
    // completed snapshot so replay/rejoin converges on final text.
    if (delta.type === 'text_end' || delta.type === 'thinking_end') {
      const content =
        typeof delta.content === 'string' ? delta.content : ''
      if (!content) return []
      const lane = delta.type === 'text_end' ? 'text' : 'reasoning'
      const id =
        lane === 'text'
          ? this.kunTextItemId(contentIndex)
          : this.kunReasoningItemId(contentIndex)
      return [
        {
          kind: 'item_updated',
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          item:
            lane === 'text'
              ? makeAssistantTextItem({
                  id,
                  threadId: this.ctx.threadId,
                  turnId: this.ctx.turnId,
                  text: content,
                  status: 'completed'
                })
              : makeAssistantReasoningItem({
                  id,
                  threadId: this.ctx.threadId,
                  turnId: this.ctx.turnId,
                  text: content,
                  status: 'completed'
                })
        }
      ]
    }
    const text = typeof delta.delta === 'string' ? delta.delta : ''
    if (!text) return []
    if (delta.type === 'text_delta') {
      return this.delta('assistant_text_delta', contentIndex, text, 'text')
    }
    if (delta.type === 'thinking_delta') {
      return this.delta(
        'assistant_reasoning_delta',
        contentIndex,
        text,
        'reasoning'
      )
    }
    return []
  }

  private delta(
    kind: 'assistant_text_delta' | 'assistant_reasoning_delta',
    contentIndex: number,
    text: string,
    lane: 'text' | 'reasoning'
  ): RuntimeEventDraft[] {
    const offsets = lane === 'text' ? this.textOffsets : this.reasoningOffsets
    const deltaOffset = offsets.get(contentIndex) ?? 0
    offsets.set(contentIndex, deltaOffset + text.length)
    const id =
      lane === 'text'
        ? this.kunTextItemId(contentIndex)
        : this.kunReasoningItemId(contentIndex)
    const item =
      lane === 'text'
        ? makeAssistantTextItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text,
            status: 'running'
          })
        : makeAssistantReasoningItem({
            id,
            threadId: this.ctx.threadId,
            turnId: this.ctx.turnId,
            text,
            status: 'running'
          })
    return [
      {
        kind,
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        item,
        deltaOffset
      }
    ]
  }

  /** Full assistant message: usage snapshot + final text + error surface. */
  private messageEnd(event: PiEvent): RuntimeEventDraft[] {
    const message = event.message as ItemRecord | undefined
    if (!message || message.role !== 'assistant') return []
    const drafts: RuntimeEventDraft[] = []
    const usage = message.usage as
      | {
          input?: number
          output?: number
          cacheRead?: number
          cacheWrite?: number
          totalTokens?: number
        }
      | undefined
    if (usage) {
      const prompt = Math.max(0, Math.trunc(usage.input ?? 0))
      const completion = Math.max(0, Math.trunc(usage.output ?? 0))
      if (prompt + completion > 0) {
        drafts.push({
          kind: 'usage',
          threadId: this.ctx.threadId,
          turnId: this.ctx.turnId,
          model:
            typeof message.model === 'string' ? message.model : this.ctx.model,
          usage: {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: Math.max(
              0,
              Math.trunc(usage.totalTokens ?? prompt + completion)
            ),
            cacheHitRate: null,
            turns: 0,
            ...(usage.cacheRead
              ? {
                  cachedTokens: Math.trunc(usage.cacheRead),
                  cacheHitTokens: Math.trunc(usage.cacheRead)
                }
              : {})
          }
        })
      }
    }
    return drafts
  }

  // -- tool calls ---------------------------------------------------------------

  private toolStarted(event: PiEvent): RuntimeEventDraft[] {
    const callId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!callId) return []
    const toolName =
      typeof event.toolName === 'string' && event.toolName ? event.toolName : 'tool'
    this.toolNamesByCallId.set(callId, toolName)
    const args = (event.args ?? event.input ?? {}) as Record<string, unknown>
    return [
      {
        kind: 'tool_call_started',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        item: makeToolCallItem({
          id: `pi_tool_${callId}`,
          turnId: this.ctx.turnId,
          threadId: this.ctx.threadId,
          callId,
          toolName,
          toolKind: this.toolKind(toolName),
          arguments: args,
          status: 'running'
        })
      }
    ]
  }

  private toolEnded(event: PiEvent): RuntimeEventDraft[] {
    const callId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    if (!callId) return []
    const toolName =
      (typeof event.toolName === 'string' && event.toolName) ||
      this.toolNamesByCallId.get(callId) ||
      'tool'
    this.toolNamesByCallId.delete(callId)
    const isError = event.isError === true
    return [
      {
        kind: 'tool_call_finished',
        threadId: this.ctx.threadId,
        turnId: this.ctx.turnId,
        item: makeToolResultItem({
          id: `pi_tool_${callId}_result`,
          turnId: this.ctx.turnId,
          threadId: this.ctx.threadId,
          callId,
          toolName,
          toolKind: this.toolKind(toolName),
          output: event.result ?? null,
          isError,
          status: isError ? 'failed' : 'completed'
        })
      }
    ]
  }

  private toolKind(
    toolName: string
  ): 'tool_call' | 'command_execution' | 'file_change' {
    if (toolName === 'bash') return 'command_execution'
    if (toolName === 'edit' || toolName === 'write') return 'file_change'
    return 'tool_call'
  }

  /** Latest usage drafts (test/inspection aid). */
  get collectedUsage(): readonly RuntimeEventDraft[] {
    return this.usageDrafts
  }
}
