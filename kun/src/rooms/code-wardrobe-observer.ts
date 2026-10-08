import type { RuntimeEvent } from '../contracts/events.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RuntimeEventObserver } from '../services/runtime-event-recorder.js'
import type { RoomStore } from './room-store.js'
import { countRoomWardrobeTurn } from './room-wardrobe-service.js'

/** Only the user's own Code tasks count: no Agent conversations, children, workers, bots or extensions. */
export function codeWardrobeThread(thread: ThreadRecord | null | undefined): thread is ThreadRecord {
  return Boolean(thread) && !thread!.roomContext && !thread!.workbenchOrigin && !thread!.parentThreadId &&
    !thread!.executionUnit && !thread!.ownerExtensionId && !thread!.historyRefId && !thread!.designProfile &&
    thread!.workspaceMode !== 'ade' && (thread!.agentSurface === undefined || thread!.agentSurface === 'code')
}

/**
 * Rolls a wardrobe bottle when a Code task turn the user started finishes
 * normally. Agent conversation turns are counted by the room run recorder.
 */
export class CodeWardrobeObserver implements RuntimeEventObserver {
  constructor(private readonly deps: {
    threadStore: Pick<ThreadStore, 'get'>
    turns: { getTurn(threadId: string, turnId: string): Promise<Turn | null> }
    store: RoomStore
    now?: () => Date
  }) {}

  record(event: RuntimeEvent): void {
    if (event.kind !== 'turn_completed' || !event.turnId) return
    // Never hold up the event pipeline; a missed bottle is harmless.
    void this.count(event.threadId, event.turnId).catch((error) => {
      console.warn('[kun] code wardrobe drop skipped:', error instanceof Error ? error.message : String(error))
    })
  }

  async count(threadId: string, turnId: string): Promise<void> {
    const thread = await this.deps.threadStore.get(threadId)
    if (!codeWardrobeThread(thread)) return
    const turn = await this.deps.turns.getTurn(threadId, turnId)
    // Background continuations (subagent results, shells, graph runs) are not the user's turns.
    if (!turn || turn.status !== 'completed' || turn.messageSource) return
    await countRoomWardrobeTurn(this.deps.store, { source: 'code', threadId, runId: 'code-' + turnId,
      sourceLabel: thread.title, finishedAt: turn.finishedAt, now: this.deps.now?.() })
  }
}
