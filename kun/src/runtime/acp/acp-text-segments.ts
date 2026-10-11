import { makeAssistantReasoningItem, makeAssistantTextItem } from '../../domain/item.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'

/** One item per contiguous text/thought segment, preserving tool boundaries. */
export class AcpTextSegments {
  private active?: { id: string; channel: 'text' | 'reasoning'; text: string; createdAt: string; messageId?: string }

  constructor(private readonly ctx: {
    threadId: string
    turnId: string
    nextId(prefix: string): string
    nowIso?: () => string
  }) {}

  append(channel: 'text' | 'reasoning', text: string, messageId?: string): RuntimeEventDraft[] {
    if (!text) return []
    const drafts: RuntimeEventDraft[] = []
    if (this.active && (this.active.channel !== channel ||
      (messageId && this.active.messageId && this.active.messageId !== messageId))) {
      drafts.push(...this.flush())
    }
    this.active ??= {
      id: this.ctx.nextId(channel === 'text' ? 'item_text' : 'item_reasoning'),
      channel, text: '', createdAt: this.ctx.nowIso?.() ?? new Date().toISOString(), messageId
    }
    const segment = this.active
    segment.messageId ??= messageId
    const offset = segment.text.length
    segment.text += text
    const make = channel === 'text' ? makeAssistantTextItem : makeAssistantReasoningItem
    drafts.push({
      kind: channel === 'text' ? 'assistant_text_delta' : 'assistant_reasoning_delta',
      threadId: this.ctx.threadId, turnId: this.ctx.turnId, itemId: segment.id, deltaOffset: offset,
      item: { ...make({ id: segment.id, threadId: this.ctx.threadId, turnId: this.ctx.turnId,
        text, status: 'running' }), createdAt: segment.createdAt }
    })
    return drafts
  }

  flush(): RuntimeEventDraft[] {
    const segment = this.active
    if (!segment) return []
    this.active = undefined
    const make = segment.channel === 'text' ? makeAssistantTextItem : makeAssistantReasoningItem
    return [{
      kind: 'item_created', threadId: this.ctx.threadId, turnId: this.ctx.turnId, itemId: segment.id,
      item: { ...make({ id: segment.id, threadId: this.ctx.threadId, turnId: this.ctx.turnId,
        text: segment.text, status: 'completed' }), createdAt: segment.createdAt }
    }]
  }
}
