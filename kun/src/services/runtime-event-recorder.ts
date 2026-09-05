import {
  RuntimeEvent as RuntimeEventSchema,
  type RuntimeEvent
} from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadLifecycleFence, ThreadLifecycleLease } from './thread-lifecycle-fence.js'
import {
  currentTurnMutationFence,
  runWithTurnMutationFence
} from '../manager/turn-mutation-context.js'

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
  allocateSeq: (threadId: string) => number | Promise<number>
  nowIso: () => string
  observers?: RuntimeEventObserver[]
  /** Optional per-thread deletion fence used by serve persistence. */
  lifecycleFence?: ThreadLifecycleFence
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
  private readonly commitQueues = new Map<string, Promise<unknown>>()
  private readonly graphEvents = new Map<string, Map<string, RuntimeEvent>>()
  private readonly graphEventsLoaded = new Set<string>()

  constructor(options: RuntimeEventRecorderOptions) {
    this.options = options
  }

  async record(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    // Capture a generation lease before queueing. A record already waiting
    // behind another event must stay stale even if the same id is later
    // recreated after deletion.
    const lease = this.options.lifecycleFence?.acquire(draft.threadId) ?? undefined
    const turnFence = currentTurnMutationFence()
    if (this.options.lifecycleFence && !lease) {
      return this.makeEvent(draft)
    }
    try {
      return await this.enqueue(draft.threadId, () => turnFence
        ? runWithTurnMutationFence(turnFence, () => this.recordCommitted(draft, lease))
        : this.recordCommitted(draft, lease))
    } finally {
      lease?.release()
    }
  }

  /**
   * Publish best-effort live state without adding it to durable replay.
   *
   * A small private checkpoint consumes the sequence durably before the full
   * live payload is published. Without it a crash can reuse a sequence already
   * acknowledged by clients, causing the next durable event to be deduplicated.
   */
  async publishTransient(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    const lease = this.options.lifecycleFence?.acquire(draft.threadId) ?? undefined
    const turnFence = currentTurnMutationFence()
    if (this.options.lifecycleFence && !lease) {
      return this.makeEvent(draft)
    }
    try {
      return await this.enqueue(draft.threadId, () => {
        const publish = async () => {
        const event = await this.makeEvent(draft)
        if (lease && !lease.isCurrent()) return event
        await this.options.sessionStore.appendEvent(event.threadId, {
          kind: 'cursor_checkpoint',
          seq: event.seq,
          timestamp: event.timestamp,
          threadId: event.threadId,
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(event.itemId ? { itemId: event.itemId } : {}),
          transientKind: event.kind
        })
        if (lease && !lease.isCurrent()) return event
        this.options.eventBus.publish(event)
        return event
        }
        return turnFence ? runWithTurnMutationFence(turnFence, publish) : publish()
      })
    } finally {
      lease?.release()
    }
  }

  private async recordCommitted(
    draft: RuntimeEventDraft,
    lease?: ThreadLifecycleLease
  ): Promise<RuntimeEvent> {
    const graphEventId = draft.kind === 'graph_event' ? draft.graph.eventId : undefined
    if (graphEventId) await this.loadRecentGraphEvents(draft.threadId)
    const duplicate = graphEventId
      ? this.graphEvents.get(draft.threadId)?.get(graphEventId)
      : undefined
    if (duplicate) return duplicate
    const event = await this.makeEvent(draft)
    // Do not persist (or publish) a draft from an expired generation. It is
    // still returned for caller compatibility; lifecycle events are commands,
    // not a durable acknowledgement.
    if (lease && !lease.isCurrent()) return event
    await this.options.sessionStore.appendEvent(event.threadId, event)
    if (graphEventId) this.rememberGraphEvent(event.threadId, graphEventId, event)
    // `appendEvent` can have started before a close. The deletion path drains
    // that write before unlinking files; this second check is what prevents an
    // already-committed old event from escaping through live SSE afterwards.
    if (lease && !lease.isCurrent()) return event
    this.options.eventBus.publish(event)
    await this.notifyObservers(event, lease)
    return event
  }

  private async makeEvent(draft: RuntimeEventDraft): Promise<RuntimeEvent> {
    const seq = draft.seq ?? (await this.nextSeq(draft.threadId))
    this.noteIssuedSeq(draft.threadId, seq)
    return RuntimeEventSchema.parse({
      ...draft,
      seq,
      timestamp: draft.timestamp ?? this.options.nowIso()
    })
  }

  private async enqueue<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.commitQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(operation)
    const guard = run.then(() => undefined, () => undefined)
    this.commitQueues.set(threadId, guard)
    try {
      return await run
    } finally {
      if (this.commitQueues.get(threadId) === guard) this.commitQueues.delete(threadId)
    }
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
    const allocated = await this.options.allocateSeq(threadId)
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
    this.graphEvents.delete(threadId)
    this.graphEventsLoaded.delete(threadId)
    for (const observer of this.options.observers ?? []) {
      observer.clearThread?.(threadId)
    }
  }

  private rememberGraphEvent(threadId: string, eventId: string, event: RuntimeEvent): void {
    const events = this.graphEvents.get(threadId) ?? new Map<string, RuntimeEvent>()
    events.set(eventId, event)
    while (events.size > 4_096) events.delete(events.keys().next().value!)
    this.graphEvents.set(threadId, events)
  }

  private async loadRecentGraphEvents(threadId: string): Promise<void> {
    if (this.graphEventsLoaded.has(threadId)) return
    const highWater = await this.options.sessionStore.highestSeq(threadId).catch(() => 0)
    const sinceSeq = Math.max(0, highWater - 4_096)
    try {
      if (this.options.sessionStore.iterateEventsSince) {
        for await (const event of this.options.sessionStore.iterateEventsSince(threadId, sinceSeq)) {
          if (event.kind === 'graph_event') {
            this.rememberGraphEvent(threadId, event.graph.eventId, event)
          }
        }
      } else {
        const recent = await this.options.sessionStore.loadEventsSince(threadId, sinceSeq)
        for (const event of recent) {
          if (event.kind === 'graph_event') {
            this.rememberGraphEvent(threadId, event.graph.eventId, event)
          }
        }
      }
    } catch {
      // Best-effort hydration for graph-event idempotency; a missing or
      // unreadable log must not block recording a new graph event.
    }
    this.graphEventsLoaded.add(threadId)
  }

  private async notifyObservers(event: RuntimeEvent, lease?: ThreadLifecycleLease): Promise<void> {
    for (const observer of this.options.observers ?? []) {
      if (lease && !lease.isCurrent()) return
      try {
        await observer.record(event)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[kun] runtime event observer failed: ${message}`)
      }
    }
  }
}
