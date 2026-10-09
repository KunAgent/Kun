import { isExternalSubagentThreadId } from '../contracts/external-subagent.js'
import type { TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import {
  externalSubagentStoreFor,
  type ExternalSubagentStore
} from '../services/external-subagent-store.js'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'

export type ExternalSubagentRouting = {
  readonly store: ExternalSubagentStore
  /** Divert a child-thread event; parent events go to `parent`. */
  recordEvent(draft: RuntimeEventDraft, parent: (draft: RuntimeEventDraft) => Promise<void>): Promise<void>
  /** Divert a child-thread item; parent items are applied, then mirrored into their child. */
  applyItem(
    threadId: string,
    item: TurnItem,
    parent: (threadId: string, item: TurnItem) => Promise<void>
  ): Promise<void>
  /** Settle subagents of a finished parent turn that never reported a result. */
  settleTurn(
    threadId: string,
    turnId: string,
    parent: (threadId: string, item: TurnItem) => Promise<void>
  ): Promise<void>
}

/**
 * The one seam harness runtimes share: drafts whose thread is an external
 * subagent's side thread are persisted by the {@link ExternalSubagentStore};
 * everything else keeps its normal parent path.
 */
export function externalSubagentRouting(deps: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: { record(draft: RuntimeEventDraft): Promise<unknown> }
  nowIso?: () => string
}): ExternalSubagentRouting {
  const store = externalSubagentStoreFor(deps)
  return {
    store,
    async recordEvent(draft, parent) {
      if (isExternalSubagentThreadId(draft.threadId)) {
        await store.record(draft)
        return
      }
      await parent(draft)
    },
    async applyItem(threadId, item, parent) {
      if (isExternalSubagentThreadId(item.threadId)) {
        await store.apply({ kind: 'item_created', threadId: item.threadId, turnId: item.turnId, itemId: item.id, item })
        return
      }
      await parent(threadId, item)
      await store.syncParentItem(item)
    },
    async settleTurn(threadId, turnId, parent) {
      for (const item of store.settleOpenChildren(threadId, turnId)) {
        await parent(threadId, item)
        await store.syncParentItem(item)
      }
    }
  }
}
