/**
 * Applies AcpEventMapper drafts to the durable timeline (docs/ade/03 §6):
 * deltas go through `applyAssistantDelta` with a cumulative running item (the
 * mapper's draft item carries only the chunk), `item_created` persists the
 * item (which emits its own event), started/finished milestones persist the
 * item AND record the milestone event, `item_updated` goes through
 * `updateItem` (which emits its own event), and everything else is a plain
 * recorded event.
 */
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem
} from '../../domain/item.js'

export type AcpDraftEmitterDeps = {
  turns: Pick<
    TurnService,
    'applyItem' | 'applyAssistantDelta' | 'updateItem'
  >
  events: Pick<RuntimeEventRecorder, 'record'>
}

export class AcpDraftEmitter {
  private textAccum = ''
  private reasoningAccum = ''
  private readonly materializedItems = new Set<string>()

  constructor(
    private readonly deps: AcpDraftEmitterDeps,
    private readonly threadId: string,
    private readonly turnId: string
  ) {}

  async emitAll(drafts: readonly RuntimeEventDraft[]): Promise<void> {
    for (const draft of drafts) await this.emit(draft)
  }

  async emit(draft: RuntimeEventDraft): Promise<void> {
    const item = 'item' in draft ? (draft.item as TurnItem | undefined) : undefined
    switch (draft.kind) {
      case 'assistant_text_delta':
      case 'assistant_reasoning_delta': {
        if (!item || !('text' in item) || typeof item.text !== 'string') {
          await this.deps.events.record(draft)
          return
        }
        const textKind = draft.kind === 'assistant_text_delta'
        const acc = textKind ? this.textAccum : this.reasoningAccum
        if (draft.deltaOffset !== acc.length) {
          // Offsets are cumulative; a mismatch means a chunk was dropped or
          // replayed — surface it instead of corrupting the stored text.
          throw new Error(
            `ACP assistant delta offset mismatch: expected ${acc.length}, ` +
              `got ${String(draft.deltaOffset)}`
          )
        }
        const next = acc + item.text
        if (textKind) this.textAccum = next
        else this.reasoningAccum = next
        const running =
          item.kind === 'assistant_reasoning' || !textKind
            ? makeAssistantReasoningItem({
                id: item.id,
                threadId: this.threadId,
                turnId: this.turnId,
                text: next,
                status: 'running'
              })
            : makeAssistantTextItem({
                id: item.id,
                threadId: this.threadId,
                turnId: this.turnId,
                text: next,
                status: 'running'
              })
        await this.deps.turns.applyAssistantDelta(
          this.threadId,
          running,
          item.text,
          draft.deltaOffset
        )
        return
      }
      case 'item_created':
        if (item) {
          await this.deps.turns.applyItem(this.threadId, item)
          this.materializedItems.add(item.id)
          return
        }
        await this.deps.events.record(draft)
        return
      case 'tool_call_started':
      case 'tool_call_finished':
        if (item) {
          await this.deps.turns.applyItem(this.threadId, item)
          this.materializedItems.add(item.id)
        }
        await this.deps.events.record(draft)
        return
      case 'item_updated':
        if (item) {
          const updated = await this.deps.turns.updateItem(this.threadId, item.id, item)
          if (!updated) {
            // Placeholder not yet persisted (out-of-order arrival raced the
            // create): append it so the timeline never loses the call.
            await this.deps.turns.applyItem(this.threadId, item)
          }
          return
        }
        await this.deps.events.record(draft)
        return
      default:
        await this.deps.events.record(draft)
    }
  }
}
