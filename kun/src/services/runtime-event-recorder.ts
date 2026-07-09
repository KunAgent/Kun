import {
  RuntimeEvent as RuntimeEventSchema,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'

type RuntimeEventWithoutStamp<Event extends RuntimeEvent> = Omit<Event, 'seq' | 'timestamp'> &
  Partial<Pick<Event, 'seq' | 'timestamp'>>

export type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? RuntimeEventWithoutStamp<Event>
    : never
  : never

export type RuntimeEventRecorderOptions = {
  eventBus: EventBus
  sessionStore: SessionStore
  allocateSeq: (threadId: string) => number
  nowIso: () => string
  observers?: RuntimeEventObserver[]
}

export type RuntimeEventObserver = {
  record(event: RuntimeEvent): Promise<void> | void
  clearThread?(threadId: string): void
}

/**
 * Application-level event boundary.
 *
 * Services and loops produce semantic event drafts; this recorder
 * stamps ordering/time, validates the public contract, persists the
 * event for SSE replay, and then fans out to live subscribers.
 *
 * Persist-before-publish is load-bearing: the SSE route replays the
 * persisted log before relaying live bus events, so an event that is
 * published first and persisted later can fall between a subscriber's
 * backlog read and its bus subscription and be lost forever.
 */
export class RuntimeEventRecorder {
  private readonly options: RuntimeEventRecorderOptions
  private readonly lastIssuedSeq = new Map<string, number>()

  constructor(options: RuntimeEventRecorderOptions) {
    this.options = options
  }

  async record(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    const seq = draft.seq ?? (await this.nextSeq(draft.threadId))
    this.noteIssuedSeq(draft.threadId, seq)
    const event = RuntimeEventSchema.parse({
      ...draft,
      seq,
      timestamp: draft.timestamp ?? this.options.nowIso()
    })
    await this.options.sessionStore.appendEvent(event.threadId, event)
    this.options.eventBus.publish(event)
    await this.notifyObservers(event)
    return event
  }

  /**
   * Issues the next per-thread seq. The persisted high-water mark is
   * read once per thread and cached; afterwards issuance is synchronous,
   * so concurrent record() calls can no longer race the store read and
   * stamp the same seq twice (which made since_seq replay skip events).
   */
  private async nextSeq(threadId: string): Promise<number> {
    let floor = this.lastIssuedSeq.get(threadId)
    if (floor === undefined) {
      const persisted = await this.options.sessionStore.highestSeq(threadId).catch(() => 0)
      // A concurrent first record() may have populated the cache while
      // we awaited the store; never move the floor backwards.
      floor = Math.max(persisted, this.lastIssuedSeq.get(threadId) ?? 0)
    }
    const allocated = this.options.allocateSeq(threadId)
    const seq = Math.max(allocated, floor + 1)
    this.noteIssuedSeq(threadId, seq)
    return seq
  }

  private noteIssuedSeq(threadId: string, seq: number): void {
    const current = this.lastIssuedSeq.get(threadId) ?? 0
    if (seq > current) this.lastIssuedSeq.set(threadId, seq)
  }

  clearThread(threadId: string): void {
    this.lastIssuedSeq.delete(threadId)
    for (const observer of this.options.observers ?? []) {
      observer.clearThread?.(threadId)
    }
  }

  private async notifyObservers(event: RuntimeEvent): Promise<void> {
    for (const observer of this.options.observers ?? []) {
      try {
        await observer.record(event)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] runtime event observer failed: ${message}`)
      }
    }
  }
}
