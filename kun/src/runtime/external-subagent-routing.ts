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

/** Routing when the runtime has durable stores; test doubles without them get none. */
export function maybeExternalSubagentRouting(deps: {
  threadStore?: ThreadStore
  sessionStore?: SessionStore
  events?: { record(draft: RuntimeEventDraft): Promise<unknown> }
}): ExternalSubagentRouting | undefined {
  const { threadStore, sessionStore, events } = deps
  if (!threadStore || typeof threadStore !== 'object' || !sessionStore || !events) return undefined
  return externalSubagentRouting({ threadStore, sessionStore, events })
}

type FinishingTurns = {
  applyItem(threadId: string, item: TurnItem): Promise<void>
  finishTurn(input: { threadId: string; turnId: string }): Promise<unknown>
}

/**
 * The same turn service, except that finishing a turn first settles its
 * subagents that never reported back. Every harness ends turns through
 * `finishTurn`, so no individual exit path can leave a card spinning.
 */
export function withExternalSubagentSettlement<T extends FinishingTurns>(turns: T, routing: ExternalSubagentRouting): T {
  return new Proxy(turns, {
    get(target, property) {
      if (property === 'finishTurn') {
        return async (input: Parameters<T['finishTurn']>[0]) => {
          await routing.settleTurn(input.threadId, input.turnId, (threadId, item) => target.applyItem(threadId, item))
            .catch((error: unknown) => {
              console.warn(`[kun] external subagent settlement failed turn=${input.turnId}: ${error instanceof Error ? error.message : String(error)}`)
            })
          return target.finishTurn(input)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}
